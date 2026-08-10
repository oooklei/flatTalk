// 其余 admin 模块处理器：模板工作台 / 资源校验 / 运行日志 / 对话运行 / 注册表 CRUD
import fs from 'node:fs';
import path from 'node:path';
import { json } from './util.js';
import { readReg, handleRegistryApi } from './store.js';
import { callModelChat } from './models.js';
import { discoverTemplates, renderTemplate, renderCard, collectNames, collectTopLevelNames } from '../template-card/index.js';
import { makeTemplateFromHtml, parseMultipart, toTemplateId } from '../template-card/make-template.js';
import { loadIntegrations } from './integrations.js';
import { getTraceLogger } from '../core/observability/trace-logger.js';

const ROOT = process.cwd();
const REG_ALLOW = ['permissions', 'knowledge', 'config'];

// 模型注册表是 { models: [...] } 结构，需直读（readReg 会包成 { items }）
function readModels() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'model-registry.json'), 'utf8')).models || []; }
  catch { return []; }
}

// ---- 模板工作台 ----
// 递归扫描所有「.html + 同名 .manifest.json」对：仅技能目录(src/skills/<skill>/templates/html)
function scanTemplatePairs() {
  const SKILLS_DIR = path.join(ROOT, 'src', 'skills');
  const out = [];
  const walk = (dir, skill) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp, skill);
      else if (e.name.endsWith('.html')) {
        const man = fp.replace(/\.html$/, '.manifest.json');
        if (fs.existsSync(man)) out.push({ htmlFile: fp, manifestFile: man, skill });
      }
    }
  };
  if (fs.existsSync(SKILLS_DIR)) {
    for (const e of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('_')) walk(path.join(SKILLS_DIR, e.name, 'templates', 'html'), e.name);
    }
  }
  return out;
}

function listSkillKeys() {
  const SKILLS_DIR = path.join(ROOT, 'src', 'skills');
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name);
}

function parseEmbeddedJson(html) {
  const re = /<script([^>]*)type=["']application\/json["']([^>]*)>([\s\S]*?)<\/script>/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = `${m[1] || ''}${m[2] || ''}`;
    const body = String(m[3] || '').trim();
    if (!body || body.startsWith('{{{') || body.startsWith('{{')) continue;
    // 跳过带 id 的数据槽（如 waypointSpotsData），优先取模板默认值块
    if (/\sid\s*=/.test(attrs)) {
      candidates.push({ body, prefer: 0 });
      continue;
    }
    candidates.push({ body, prefer: 1 });
  }
  candidates.sort((a, b) => b.prefer - a.prefer);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.body);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch { /* next */ }
  }
  return {};
}

/** 旅居走线卡预览：内嵌 static_svg 为空时，注入 sojourn-maps 真实 SVG */
function resolvePreviewStaticSvg(templateId = '', data = {}) {
  if (data?.static_svg && String(data.static_svg).includes('<svg')) {
    return String(data.static_svg);
  }
  const id = String(templateId || '');
  const dest = String(data?.destination || '');
  const mapsDir = path.join(ROOT, 'data', 'sojourn-maps');
  const prefer = [];
  if (/coastal|滨海|防城|京族|北海/i.test(`${id}${dest}`)) prefer.push('fcg_route_001', 'fcg_route_002');
  if (/wellness|康养|巴马|sojourn_base|medical|spot/i.test(`${id}${dest}`)) prefer.push('bama_5d4n', 'fcg_route_001');
  if (/culture|文化|桂林/i.test(`${id}${dest}`)) prefer.push('gx_excel_01', 'gx_excel_03');
  if (/ecology|生态/i.test(`${id}${dest}`)) prefer.push('gx_excel_08', 'gx_excel_05');
  prefer.push('fcg_route_001', 'gx_excel_01', 'bama_5d4n');

  const tryRead = (routeId) => {
    const candidates = [
      path.join(mapsDir, routeId, 'map_standard.svg'),
      path.join(mapsDir, `${routeId}_standard.svg`),
    ];
    for (const fp of candidates) {
      try {
        if (!fs.existsSync(fp)) continue;
        const svg = fs.readFileSync(fp, 'utf8');
        if (svg.includes('<svg')) return svg;
      } catch { /* next */ }
    }
    return '';
  };

  for (const rid of prefer) {
    const svg = tryRead(rid);
    if (svg) return svg;
  }

  try {
    for (const e of fs.readdirSync(mapsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const svg = tryRead(e.name);
      if (svg) return svg;
    }
  } catch { /* ignore */ }
  return '';
}

const PREVIEW_CENTER = { lat: 21.531, lng: 108.172, name: '嘉路康养中心' };
const PREVIEW_NEARBY_POIS = [
  { poi_id: 's1', name: '海岸假日民宿', address: '港口区某路12号', lng: 108.172, lat: 21.531, distance: 0.8, distance_text: '0.8', cat: 'stay', color: '#3B82A0', emoji: '🏠', biz_status: '营业中', tel: '0770-1234567', open_time: '24小时', tags: ['近海', '适老'], tags_text: '近海·适老' },
  { poi_id: 's2', name: '渔家海鲜大排档', address: '渔洲坪', lng: 108.160, lat: 21.524, distance: 1.2, distance_text: '1.2', cat: 'food', color: '#F2994A', emoji: '🍜', biz_status: '营业中', tel: '0770-2233445', open_time: '11:00-22:00', tags: ['海鲜'], tags_text: '海鲜' },
  { poi_id: 's3', name: '西湾滨海景区', address: '西湾大道', lng: 108.150, lat: 21.540, distance: 2.5, distance_text: '2.5', cat: 'spot', color: '#2BAE8E', emoji: '🏖️', biz_status: '开放中', tags: ['海景'], tags_text: '海景' },
  { poi_id: 's4', name: '渔人码头垂钓场', address: '渔洲坪码头', lng: 108.158, lat: 21.520, distance: 3.1, distance_text: '3.1', cat: 'leisure', color: '#8E6FD8', emoji: '🎣', biz_status: '营业中', open_time: '06:00-20:00', tags: ['垂钓'], tags_text: '垂钓' },
  { poi_id: 's5', name: '港口区人民医院', address: '港口区医院路', lng: 108.168, lat: 21.535, distance: 1.0, distance_text: '1.0', cat: 'wellness', color: '#E5484D', emoji: '🏥', biz_status: '营业中', open_time: '全天', tags: ['医疗'], tags_text: '医疗' },
];

function previewMapKey() {
  return process.env.TENCENT_MAP_JS_KEY || 'KI4BZ-5GGLT-POOXY-LQK77-6XA62-YVFPH';
}

function previewMapFields(center = PREVIEW_CENTER, markers = PREVIEW_NEARBY_POIS) {
  const c = {
    lat: Number(center.lat) || PREVIEW_CENTER.lat,
    lng: Number(center.lng) || PREVIEW_CENTER.lng,
    name: center.name || PREVIEW_CENTER.name,
  };
  const list = Array.isArray(markers) && markers.length ? markers : PREVIEW_NEARBY_POIS;
  return {
    map_key: previewMapKey(),
    centerLat: c.lat,
    centerLng: c.lng,
    centerName: c.name,
    center_json: JSON.stringify(c),
    markers_json: JSON.stringify(list),
    markers: list,
    radiusKm: 15,
    static_map_url: '', // 预览优先走示意 SVG / 实时 SDK，避免依赖静态瓦片签名
  };
}

/** srcdoc 预览无法加载相对 CSS：把所有同目录 <link rel=stylesheet> 内联为 <style> */
function inlinePreviewStyles(html, skill) {
  if (!html || !skill) return html;
  const dir = path.resolve(ROOT, 'src', 'skills', skill, 'templates', 'html');
  const cssCache = new Map();
  const readCss = (href) => {
    const name = String(href || '').replace(/^\.\//, '').split('?')[0].split('#')[0];
    if (!name || /^(https?:|data:|\/\/)/i.test(name)) return '';
    if (path.isAbsolute(name) || name.includes('..')) return '';
    if (cssCache.has(name)) return cssCache.get(name);
    let css = '';
    try {
      const fp = path.resolve(dir, name);
      const safe = fp === dir || fp.startsWith(dir + path.sep);
      if (safe && fs.existsSync(fp)) css = fs.readFileSync(fp, 'utf8');
    } catch { /* ignore */ }
    cssCache.set(name, css);
    return css;
  };

  let out = String(html).replace(
    /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,
    (tag) => {
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
      if (!href || /^(https?:|data:|\/\/)/i.test(href)) return tag;
      const css = readCss(href);
      return css ? `<style data-preview-inline="${href.replace(/[^\w.\-]/g, '_')}">\n${css}\n</style>` : `<!-- preview missing css: ${href} -->`;
    },
  );

  // 片段卡（无 <html>/<link>）：注入技能目录下公共样式，避免纯白文字
  const isFragment = !/<html[\s>]/i.test(out) && !/<link\b[^>]*rel=["']stylesheet["']/i.test(html);
  if (isFragment) {
    const bundle = ['_design_tokens.css', '_card_components.css', '_base.css', '_health_warning.css']
      .map((n) => readCss(n))
      .filter(Boolean)
      .join('\n');
    if (bundle) {
      out = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>\n${bundle}\n</style></head><body>\n${out}\n</body></html>`;
    }
  }
  return out;
}

function enrichTemplatePreviewData(templateId, data = {}) {
  const id = String(templateId || '');
  const next = { ...data };

  const isRouteSvg = /^(route_svg|route_coastal|route_wellness|route_culture|route_ecology|sojourn_route)$/.test(id);
  const isCenterMap = /^(sojourn_base|travel_medical_card|travel_spot_card)$/.test(id);
  const isNearbyMap = /^(nearby_map_overview|nearby_map_category|nearby_map_route|nearby_radar|nearby_list)$/.test(id);

  if (isRouteSvg) {
    if (!next.static_svg || !String(next.static_svg).includes('<svg')) {
      const svg = resolvePreviewStaticSvg(id, next);
      if (svg) next.static_svg = svg;
    }
    if (!next.waypoint_spots_json) next.waypoint_spots_json = '[]';
    if (!next.highlights) next.highlights = ['康养氧疗', '慢节奏走线', '适老接驳'];
    if (!Array.isArray(next.itinerary)) {
      next.itinerary = [
        { day: 'D1', theme: '抵达适应', plan: '入住建档，轻松周边慢走', has_theme: true, has_slots: false, has_accommodation: false },
        { day: 'D2', theme: '深度体验', plan: '核心景点康养体验', has_theme: true, has_slots: false, has_accommodation: false },
      ];
    }
    // sojourn_route 内联 {{{center_json}}} 等，空值会炸 JS，必须给合法字面量
    const map = previewMapFields(
      { lat: 21.69, lng: 108.35, name: next.destination || next.centerName || '防城港' },
      [
        { name: '白浪滩', lat: 21.668, lng: 108.362, type: 'arrival', day: 'D1' },
        { name: '京族三岛', lat: 21.580, lng: 108.320, type: 'spot', day: 'D2' },
        { name: '东兴口岸', lat: 21.548, lng: 107.972, type: 'departure', day: 'D3' },
      ],
    );
    if (!next.center_json || String(next.center_json).includes('{{{')) next.center_json = map.center_json;
    if (!next.centerLat) next.centerLat = map.centerLat;
    if (!next.centerLng) next.centerLng = map.centerLng;
    if (!next.centerName) next.centerName = map.centerName;
    if (!next.waypoints_json || String(next.waypoints_json).includes('{{{')) next.waypoints_json = map.markers_json;
    if (!next.spots_json || String(next.spots_json).includes('{{{')) next.spots_json = '[]';
    if (!next.polyline_path_json || String(next.polyline_path_json).includes('{{{')) next.polyline_path_json = '[]';
    if (!next.fit_bounds_json || String(next.fit_bounds_json).includes('{{{')) next.fit_bounds_json = 'null';
    if (next.route_planning_url == null) next.route_planning_url = '';
    if (!next.routeTitle) next.routeTitle = next.routeTitle || '防城港滨海旅居线';
    if (!next.destination) next.destination = '防城港';
    if (!next.days) next.days = '3天2晚';
    if (!next.summary) next.summary = '滨海康养慢节奏走线示意。';
  }

  if (isCenterMap) {
    const map = previewMapFields(
      { lat: 21.6146, lng: 108.3545, name: next.centerName || '防城港康养基地' },
      PREVIEW_NEARBY_POIS.slice(0, 4),
    );
    Object.assign(next, {
      map_key: next.map_key || map.map_key,
      centerLat: next.centerLat || map.centerLat,
      centerLng: next.centerLng || map.centerLng,
      centerName: next.centerName || map.centerName,
      center_json: (next.center_json && !String(next.center_json).includes('{{{')) ? next.center_json : map.center_json,
      markers_json: (next.markers_json && !String(next.markers_json).includes('{{{')) ? next.markers_json : map.markers_json,
      static_map_url: next.static_map_url || '',
      static_map_url_json: JSON.stringify(next.static_map_url || ''),
    });
    if (id === 'travel_spot_card' && (!Array.isArray(next.spots) || !next.spots.length)) {
      next.spots = PREVIEW_NEARBY_POIS.filter((p) => p.cat === 'spot' || p.cat === 'leisure').map((p) => ({
        name: p.name,
        desc: p.address,
        play: '慢走观景，预留休息',
        meta: `${p.distance_text}km · ${p.biz_status || ''}`,
      }));
    }
  }

  if (isNearbyMap) {
    const map = previewMapFields(
      { lat: next.centerLat || PREVIEW_CENTER.lat, lng: next.centerLng || PREVIEW_CENTER.lng, name: next.centerName || PREVIEW_CENTER.name },
      Array.isArray(next.markers) && next.markers.length ? next.markers : PREVIEW_NEARBY_POIS,
    );
    Object.assign(next, {
      // 管理台 srcdoc 预览里腾讯 SDK 常空白，强制走示意 SVG
      map_key: '',
      centerLat: map.centerLat,
      centerLng: map.centerLng,
      centerName: map.centerName,
      center_json: map.center_json,
      markers_json: map.markers_json,
      markers: map.markers,
      radiusKm: next.radiusKm || 15,
      total: next.total || map.markers.length,
      category: next.category || 'all',
      walkCount: next.walkCount || map.markers.length,
      walkItems_json: next.walkItems_json && !String(next.walkItems_json).includes('{{{')
        ? next.walkItems_json
        : map.markers_json,
      routeStops_json: next.routeStops_json && !String(next.routeStops_json).includes('{{{')
        ? next.routeStops_json
        : JSON.stringify(map.markers.map((p, i) => ({ ...p, step: i + 1, title: p.name, role: p.role || `第${i + 1}站` }))),
      static_map_url: '',
      static_map_url_json: '""',
      statsLabels: next.statsLabels || [
        { label: '住', emoji: '🏠', color: '#3B82A0', count: 1 },
        { label: '吃', emoji: '🍜', color: '#F2994A', count: 1 },
        { label: '游', emoji: '🏖️', color: '#2BAE8E', count: 1 },
        { label: '养', emoji: '🏥', color: '#E5484D', count: 1 },
      ],
    });
  }

  return next;
}

/** @deprecated 使用 enrichTemplatePreviewData */
function enrichTravelPreviewData(templateId, data = {}) {
  return enrichTemplatePreviewData(templateId, data);
}

function followupsDirForSkill(skill) {
  return path.join(ROOT, 'src', 'skills', skill, 'templates', 'followups');
}

function loadFollowups(skill, id) {
  const file = path.join(followupsDirForSkill(skill), `${id}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed?.followup_suggestions) ? parsed.followup_suggestions : [];
    return list.map((f) => ({ ...f, category: f.category === 'other' ? 'other' : 'tight' }));
  } catch { return []; }
}

function findTemplatePair(id) {
  return scanTemplatePairs().find((p) => {
    const m = JSON.parse(fs.readFileSync(p.manifestFile, 'utf8'));
    return (m.id || path.basename(p.htmlFile, '.html')) === id;
  });
}

// 将默认数据写回 HTML 内嵌的 <script type="application/json">，找不到则追加到 </body> 前
// 优先写回「无 id」的默认值块，避免覆盖 waypointSpotsData 等数据槽
function setEmbeddedJson(html, obj) {
  const json = JSON.stringify(obj, null, 2);
  const re = /(<script(?![^>]*\sid\s*=)[^>]*type=["']application\/json["'][^>]*>)([\s\S]*?)(<\/script>)/i;
  if (re.test(html)) return html.replace(re, `$1\n${json}\n$3`);
  const reAny = /(<script[^>]*type=["']application\/json["'][^>]*>)([\s\S]*?)(<\/script>)/i;
  // 若仅有带 id 的槽，则在 </body> 前追加独立默认值块
  if (reAny.test(html)) {
    return html.replace(/<\/body>/i, `<script type="application/json">\n${json}\n</script>\n</body>`);
  }
  return html.replace(/<\/body>/i, `<script type="application/json">\n${json}\n</script>\n</body>`);
}

async function handleTemplates(req, res, method, parts) {
  // 制作模板：上传 HTML（单文件 / 文件夹），生成模板卡写入指定技能目录
  if (parts[0] === 'make' && method === 'POST') {
    let parsed;
    try { parsed = await parseMultipart(req); }
    catch (e) { return json(res, 400, { ok: false, error: e.code || 'bad_request', message: e.message }); }
    const { fields, files } = parsed;
    const skill = (fields.skill || 'common').trim();
    const layout = fields.layout || 'card';
    const description = fields.description || '';
    const skillDir = path.join(ROOT, 'src', 'skills', skill);
    if (!fs.existsSync(skillDir)) return json(res, 400, { ok: false, error: 'unknown_skill', message: `技能目录不存在：${skill}` });
    const htmlDir = path.join(skillDir, 'templates', 'html');
    fs.mkdirSync(htmlDir, { recursive: true });
    const htmlFiles = files.filter((f) => f.filename && /\.html?$/i.test(f.filename));
    if (!htmlFiles.length) return json(res, 400, { ok: false, error: 'no_html_files', message: '未上传任何 HTML 文件' });
    const created = [];
    const skipped = [];
    const used = new Set();
    for (const file of htmlFiles) {
      const id = toTemplateId(file.filename);
      let finalId = id;
      let i = 2;
      while (used.has(finalId) || fs.existsSync(path.join(htmlDir, finalId + '.html'))) finalId = `${id}_${i++}`;
      used.add(finalId);
      const html = file.content.toString('utf8');
      if (!html.trim()) { skipped.push({ file: file.filename, reason: '内容为空' }); continue; }
      let result;
      try { result = makeTemplateFromHtml(html, { id: finalId, layout, description }); }
      catch (e) { skipped.push({ file: file.filename, reason: e.message }); continue; }
      fs.writeFileSync(path.join(htmlDir, finalId + '.html'), result.html, 'utf8');
      fs.writeFileSync(path.join(htmlDir, finalId + '.manifest.json'), JSON.stringify(result.manifest, null, 2), 'utf8');
      created.push({ id: finalId, path: path.relative(ROOT, path.join(htmlDir, finalId + '.html')) });
    }
    return json(res, 200, { ok: true, created, skipped, skill });
  }

  // 校验（含技能目录与公共库）；支持按 skill / id 范围筛选（目录级稽核）
  if (parts[0] === 'validate' && method === 'POST') {
    const b = await (await import('./util.js')).readJsonSafe(req, res);
    if (b === undefined) return;
    const filter = b || {};
    const reports = [];
    const pairs = scanTemplatePairs().filter((p) => {
      if (filter.id) {
        const m = JSON.parse(fs.readFileSync(p.manifestFile, 'utf8'));
        return (m.id || path.basename(p.htmlFile, '.html')) === filter.id;
      }
      if (filter.skill) return p.skill === filter.skill;
      return true;
    });
    for (const { htmlFile, manifestFile, skill } of pairs) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const id = manifest.id || path.basename(htmlFile, '.html');
      const html = fs.readFileSync(htmlFile, 'utf8');
      const names = collectTopLevelNames(html);
      const missing = names.filter((n) => !(n in (parseEmbeddedJson(html) || {})));
      if (missing.length) reports.push({ level: 'warn', module: 'template:' + id, message: `(${skill}) 字段未提供默认值：${missing.join(', ')}` });
      else reports.push({ level: 'ok', module: 'template:' + id, message: `(${skill}) 字段齐全（${names.length} 个）` });
    }
    return json(res, 200, { ok: true, reports });
  }

  // 预览：与生产同路径 renderCard（collectCss 内联样式），避免 srcdoc 相对 CSS 白板
  if (parts[0] === 'preview' && parts[1] && method === 'GET') {
    const id = decodeURIComponent(parts[1]);
    const pair = scanTemplatePairs().find((p) => {
      const m = JSON.parse(fs.readFileSync(p.manifestFile, 'utf8'));
      return (m.id || path.basename(p.htmlFile, '.html')) === id;
    });
    if (!pair) return json(res, 404, { ok: false, error: 'template_not_found' });
    const html = fs.readFileSync(pair.htmlFile, 'utf8');
    const embedded = parseEmbeddedJson(html) || {};
    const data = enrichTemplatePreviewData(id, embedded);
    const htmlDir = path.dirname(pair.htmlFile);
    let out = '';
    try {
      const card = renderCard(htmlDir, { template_id: id, data });
      out = card.pages[0] || '';
    } catch {
      out = renderTemplate(html, data);
    }
    out = inlinePreviewStyles(out, pair.skill);
    const layout = JSON.parse(fs.readFileSync(pair.manifestFile, 'utf8')).layout || 'card';
    return json(res, 200, {
      ok: true,
      id,
      html: out,
      layout,
      preview_meta: {
        static_svg_injected: !!(data.static_svg && String(data.static_svg).includes('<svg')),
        static_svg_bytes: data.static_svg ? String(data.static_svg).length : 0,
        map_key: !!(data.map_key),
        markers: Array.isArray(data.markers) ? data.markers.length : 0,
        center: data.centerName || '',
        css_inlined: /<style[\s>]/i.test(out) && !/<link\b[^>]*rel=["']stylesheet["']/i.test(out),
      },
    });
  }

  // 追问读写：/templates/:id/followups（admin 挂载的紧密/其他追问）
  if (parts[0] && parts[1] === 'followups') {
    const id = decodeURIComponent(parts[0]);
    const pair = findTemplatePair(id);
    if (!pair) return json(res, 404, { ok: false, error: 'template_not_found' });
    const skill = pair.skill;
    const file = path.join(followupsDirForSkill(skill), `${id}.json`);
    if (method === 'GET') {
      return json(res, 200, { ok: true, template_id: id, followup_suggestions: loadFollowups(skill, id) });
    }
    if (method === 'PUT') {
      const b = await (await import('./util.js')).readJsonSafe(req, res);
      if (b === undefined) return;
      if (!Array.isArray(b.followup_suggestions)) return json(res, 400, { ok: false, error: 'followup_suggestions_required' });
      const normalized = b.followup_suggestions
        .filter((f) => f && f.label && f.user_prompt)
        .map((f) => ({
          label: String(f.label),
          user_prompt: String(f.user_prompt),
          ...(f.action_key ? { action_key: String(f.action_key) } : {}),
          category: f.category === 'other' ? 'other' : 'tight',
          ...(f.intent ? { intent: String(f.intent) } : {}),
        }));
      fs.mkdirSync(followupsDirForSkill(skill), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ template_id: id, followup_suggestions: normalized }, null, 2), 'utf8');
      return json(res, 200, { ok: true, template_id: id, followup_suggestions: normalized });
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  // 模板源码读写：/templates/:id/source（HTML 源码 + manifest + 内嵌默认数据）
  if (parts[0] && parts[1] === 'source') {
    const id = decodeURIComponent(parts[0]);
    const pair = findTemplatePair(id);
    if (!pair) return json(res, 404, { ok: false, error: 'template_not_found' });
    if (method === 'GET') {
      const html = fs.readFileSync(pair.htmlFile, 'utf8');
      const manifest = fs.readFileSync(pair.manifestFile, 'utf8');
      return json(res, 200, { ok: true, template_id: id, html, manifest, defaultData: parseEmbeddedJson(html) });
    }
    if (method === 'PUT') {
      const b = await (await import('./util.js')).readJsonSafe(req, res);
      if (b === undefined) return;
      if (typeof b.manifest !== 'string') return json(res, 400, { ok: false, error: 'manifest_required' });
      try {
        const parsedManifest = JSON.parse(b.manifest);
        parsedManifest.id = id;
        fs.writeFileSync(pair.manifestFile, JSON.stringify(parsedManifest, null, 2), 'utf8');
      } catch { return json(res, 400, { ok: false, error: 'invalid_manifest_json' }); }
      let html = typeof b.html === 'string' ? b.html : fs.readFileSync(pair.htmlFile, 'utf8');
      if (b.defaultData !== undefined) {
        try { html = setEmbeddedJson(html, typeof b.defaultData === 'string' ? JSON.parse(b.defaultData) : b.defaultData); }
        catch { return json(res, 400, { ok: false, error: 'invalid_defaultdata_json' }); }
      }
      fs.writeFileSync(pair.htmlFile, html, 'utf8');
      return json(res, 200, { ok: true, template_id: id, saved: true });
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  // 列表（技能目录），并携带技能列与可选技能清单
  const items = scanTemplatePairs().map(({ htmlFile, manifestFile, skill }) => {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const id = manifest.id || path.basename(htmlFile, '.html');
    const html = fs.readFileSync(htmlFile, 'utf8');
    const defaultData = parseEmbeddedJson(html);
    const names = collectTopLevelNames(html);
    const missing = names.filter((n) => !(n in (defaultData || {})));
    return {
      id,
      skill,
      layout: manifest.layout || 'card',
      description: manifest.match || manifest.description || '',
      fields: names.length,
      hasDefault: missing.length === 0,
      dir: path.relative(ROOT, htmlFile),
      followups: loadFollowups(skill, id),
    };
  });
  return json(res, 200, { ok: true, items, skills: listSkillKeys(), dir: 'aggregated' });
}

// ---- 资源校验 ----
async function handleValidate(req, res) {
  let filter = {};
  if (req.method === 'POST') {
    const b = await (await import('./util.js')).readJsonSafe(req, res);
    if (b === undefined) return; // 400 已返回
    filter = b || {};
  }
  const reports = [];
  const push = (level, module, message) => reports.push({ level, module, message });

  // 模型注册表（全局环境检查：仅在全量稽核时执行）
  if (!filter.id && !filter.skill) {
    const models = readModels();
    const defaults = models.filter((m) => m.is_default);
    if (defaults.length === 0) push('warn', 'model-registry', '未设置默认模型');
    else if (defaults.length > 1) push('error', 'model-registry', `存在 ${defaults.length} 个默认模型，应仅 1 个`);
    else push('ok', 'model-registry', `默认模型：${defaults[0].name}`);
    const inactive = models.filter((m) => !m.is_active);
    if (inactive.length) push('warn', 'model-registry', `${inactive.length} 个模型处于停用`);
  }

  // 模板（聚合：技能目录 + 公共库）
  try {
    const pairs = scanTemplatePairs().filter((p) => {
      if (filter.id) {
        const m = JSON.parse(fs.readFileSync(p.manifestFile, 'utf8'));
        return (m.id || path.basename(p.htmlFile, '.html')) === filter.id;
      }
      if (filter.skill) return p.skill === filter.skill;
      return true;
    });
    for (const { htmlFile, manifestFile, skill } of pairs) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const id = manifest.id || path.basename(htmlFile, '.html');
      const names = collectTopLevelNames(fs.readFileSync(htmlFile, 'utf8'));
      const missing = names.filter((n) => !(n in (parseEmbeddedJson(fs.readFileSync(htmlFile, 'utf8')) || {})));
      if (missing.length) push('warn', 'template:' + id, `(${skill}) 缺省字段：${missing.join(', ')}`);
    }
    push('ok', 'templates', `模板总数 ${pairs.length}`);
  } catch (e) { push('error', 'templates', e.message); }

  // 权限矩阵（全局环境检查：仅在全量稽核时执行）
  if (!filter.id && !filter.skill) {
    let permRoles = [];
    try { permRoles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'permissions.json'), 'utf8')).roles || []; } catch { /* ignore */ }
    if (!permRoles.length) push('warn', 'permissions', '权限矩阵未配置角色');
    else push('ok', 'permissions', `角色数 ${permRoles.length}`);
  }

  // 第三方API（含原「外部服务」登记，已合并；全局环境检查：仅在全量稽核时执行）
  if (!filter.id && !filter.skill) {
    try {
      const integ = loadIntegrations();
      const active = integ.items.filter((i) => i.status === 'active').length;
      if (!integ.items.length) push('warn', 'integrations', '未登记第三方API');
      else push('ok', 'integrations', `第三方API ${integ.items.length} 个（启用 ${active}）`);
    } catch (e) { push('error', 'integrations', e.message); }
  }

  const levelRank = { error: 0, warn: 1, ok: 2 };
  reports.sort((a, b) => levelRank[a.level] - levelRank[b.level]);
  return json(res, 200, { ok: true, reports });
}

// ---- 运行日志 ----
function handleLogs(req, res, parts) {
  const f = path.join(ROOT, 'data', 'runtime.log');
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  if (parts[0] === 'clear') {
    try { if (fs.existsSync(f)) fs.writeFileSync(f, ''); } catch {}
    try { getTraceLogger().clear(); } catch {}
    return json(res, 200, { ok: true, cleared: true });
  }
  const raw = lines.slice(-200).reverse().map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  const traces = getTraceLogger().list({ limit: 300 });
  return json(res, 200, { ok: true, lines: raw, total: lines.length, traces, total_traces: traces.length });
}

// ---- 对话运行 ----
async function handleDialogue(req, res) {
  const b = await (await import('./util.js')).readJsonSafe(req, res);
  if (b === undefined) return;
  if (!b.message) return json(res, 400, { ok: false, error: 'message_required' });
  const models = readModels();
  const model = (b.modelId && models.find((m) => m.id === Number(b.modelId)))
    || models.find((m) => m.is_default && m.is_active)
    || models.find((m) => m.is_active);
  if (!model) return json(res, 400, { ok: false, error: 'no_available_model' });
  const r = await callModelChat(model, b.message, { max_tokens: 512, temperature: 0.7 });
  return json(res, 200, { ok: true, model: model.name, ...r });
}

// ---- 权限矩阵：角色 × 技能 矩阵（权限矩阵）----
function scanSkills() {
  const SKILLS_DIR = path.join(ROOT, 'src', 'skills');
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name);
}
function defaultRoleSkillMatrix() {
  const skills = scanSkills();
  const keep = (arr) => arr.filter((s) => skills.includes(s));
  const defs = [
    // 长者
    { key: 'elder', cn_name: '老人', skills: keep(['common', 'meal_plan', 'travel_route']) },
    { key: 'elder_family', cn_name: '家属', skills: keep(['common', 'meal_plan', 'travel_route']) },
    // 医护
    { key: 'village_doctor', cn_name: '村医', skills: keep(['common', 'health_risk_warning', 'dispatch_manage']) },
    { key: 'community_doctor', cn_name: '社区居家-医生', skills: keep(['common', 'health_risk_warning', 'dispatch_manage']) },
    // 护理
    { key: 'care_worker', cn_name: '护理员', skills: keep(['common', 'meal_plan', 'health_risk_warning', 'dispatch_manage']) },
    { key: 'community_helper', cn_name: '社区居家-助老员', skills: keep(['common', 'find_service']) },
    // 机构管理
    { key: 'institution_admin', cn_name: '机构端-管理员', skills: keep(['common', 'meal_plan', 'find_service', 'dispatch_manage']) },
    // 服务方
    { key: 'provider_staff', cn_name: '服务商', skills: keep(['common', 'find_service']) },
    { key: 'community_support', cn_name: '社区居家-后勤', skills: keep(['common']) },
    { key: 'community_canteen', cn_name: '社区居家-食堂', skills: keep(['common', 'meal_plan']) },
    { key: 'community_kitchen', cn_name: '社区居家-厨房', skills: keep(['common', 'meal_plan']) },
    { key: 'community_guard', cn_name: '社区居家-门卫', skills: keep(['common']) },
    { key: 'community_maintenance', cn_name: '社区居家-维修', skills: keep(['common']) },
    // 政府/管理
    { key: 'senior_official', cn_name: '厅级干部', skills: keep(['common']), wildcard: true },
    { key: 'system_admin', cn_name: '超级管理员', skills: [], wildcard: true },
    { key: 'admin', cn_name: '配置管理员', skills: [], wildcard: true },
    { key: 'civil_affairs_staff', cn_name: '民政局科员', skills: keep(['common', 'elder_policy', 'find_service']) },
    { key: 'grid_worker', cn_name: '社区网格员', skills: keep(['common', 'find_service', 'dispatch_manage']) },
  ];
  return defs.map((d) => ({ key: d.key, cn_name: d.cn_name, wildcard: Boolean(d.wildcard), skills: d.skills || [] }));
}
function normalizeRoles(roles, skills) {
  return (roles || []).map((r) => ({
    key: r.key,
    cn_name: r.cn_name || r.key,
    wildcard: Boolean(r.wildcard),
    skills: skills.filter((s) => (r.skills || []).includes(s)),
  }));
}
async function handlePermissions(req, res, method, parts) {
  const f = path.join(ROOT, 'data', 'permissions.json');
  const load = () => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { roles: [] });
  const skills = scanSkills();
  const sub = parts[1];

  // 从代码同步默认矩阵
  if (sub === 'sync' && method === 'POST') {
    const roles = defaultRoleSkillMatrix();
    fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
    return json(res, 200, { ok: true, roles, skills });
  }

  // 角色管理：/api/admin/permissions/roles[/:key]
  if (sub === 'roles') {
    const roles = load().roles || [];
    if (method === 'POST') {
      const b = await (await import('./util.js')).readJsonSafe(req, res);
      if (b === undefined) return;
      if (!b.key) return json(res, 400, { ok: false, error: 'key_required' });
      if (roles.some((r) => r.key === b.key)) return json(res, 409, { ok: false, error: 'role_exists' });
      const role = { key: b.key, cn_name: b.cn_name || b.key, wildcard: Boolean(b.wildcard), skills: Array.isArray(b.skills) ? b.skills.filter((s) => skills.includes(s)) : [] };
      roles.push(role);
      fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
      return json(res, 200, { ok: true, role });
    }
    const key = parts[2];
    if (key) {
      const role = roles.find((r) => r.key === key);
      if (!role) return json(res, 404, { ok: false, error: 'role_not_found' });
      if (method === 'PUT') {
        const b = await (await import('./util.js')).readJsonSafe(req, res);
        if (b === undefined) return;
        if (b.cn_name !== undefined) role.cn_name = b.cn_name;
        if (b.wildcard !== undefined) role.wildcard = Boolean(b.wildcard);
        if (Array.isArray(b.skills)) role.skills = b.skills.filter((s) => skills.includes(s));
        fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
        return json(res, 200, { ok: true, role });
      }
      if (method === 'DELETE') {
        const idx = roles.findIndex((r) => r.key === key);
        roles.splice(idx, 1);
        fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
        return json(res, 200, { ok: true });
      }
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  // 矩阵读写（角色 + 技能清单）
  if (method === 'GET') {
    let obj = load();
    const legacy = (obj.roles || []).some((r) => !('key' in r) || !('skills' in r));
    if (!obj.roles || !obj.roles.length || legacy) {
      obj = { roles: defaultRoleSkillMatrix() };
      fs.writeFileSync(f, JSON.stringify(obj, null, 2));
    }
    return json(res, 200, { ok: true, roles: obj.roles, skills });
  }
  if (method === 'PUT') {
    const b = await (await import('./util.js')).readJsonSafe(req, res);
    if (b === undefined) return;
    if (!Array.isArray(b.roles)) return json(res, 400, { ok: false, error: 'roles_required' });
    const roles = normalizeRoles(b.roles, skills);
    fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
    return json(res, 200, { ok: true, roles });
  }
  return json(res, 405, { ok: false, error: 'method_not_allowed' });
}

// 分发
export async function handleModuleApi(req, res, method, parts) {
  const name = parts[0];
  if (name === 'templates') return handleTemplates(req, res, method, parts.slice(1));
  if (name === 'validate' && method === 'GET') return handleValidate(req, res);
  if (name === 'logs') return handleLogs(req, res, parts.slice(1));
  if (name === 'dialogue' && method === 'POST') return handleDialogue(req, res);
  if (name === 'permissions') return handlePermissions(req, res, method, parts);
  if (name === 'registries') {
    const r = await handleRegistryApi(req, res, method, parts.slice(2), parts[1], REG_ALLOW);
    if (r) return json(res, r.status, r.body);
    return; // readJsonSafe 已写 400
  }
  return json(res, 404, { ok: false, error: 'module_not_found', name });
}
