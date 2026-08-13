/**
 * 为所有技能模板补齐内嵌 defaultData，消除「缺省字段」启动校验警告。
 * 优先：同名 .sample.json → HTML 中 {{field|默认}} → 启发式占位。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTopLevelNames } from '../src/template-card/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, 'src', 'skills');

function parseEmbeddedJson(html) {
  const re = /<script([^>]*)type=["']application\/json["']([^>]*)>([\s\S]*?)<\/script>/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = `${m[1] || ''}${m[2] || ''}`;
    const body = String(m[3] || '').trim();
    if (!body || body.startsWith('{{{') || body.startsWith('{{')) continue;
    candidates.push({ body, prefer: /\sid\s*=/.test(attrs) ? 0 : 1 });
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

function setEmbeddedJson(html, obj) {
  const json = JSON.stringify(obj, null, 2);
  const re = /(<script(?![^>]*\sid\s*=)[^>]*type=["']application\/json["'][^>]*>)([\s\S]*?)(<\/script>)/i;
  if (re.test(html)) return html.replace(re, `$1\n${json}\n$3`);
  const reAny = /(<script[^>]*type=["']application\/json["'][^>]*>)([\s\S]*?)(<\/script>)/i;
  if (reAny.test(html)) {
    return html.replace(/<\/body>/i, `<script type="application/json">\n${json}\n</script>\n</body>`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `<script type="application/json">\n${json}\n</script>\n</body>`);
  }
  return `${html}\n<script type="application/json">\n${json}\n</script>\n`;
}

function hasKey(obj, name) {
  if (!obj || typeof obj !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(obj, name)) return true;
  if (!name.includes('.')) return false;
  let cur = obj;
  for (const p of name.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return false;
    cur = cur[p];
  }
  return true;
}

function setNested(obj, name, value) {
  if (!name.includes('.')) {
    if (!(name in obj)) obj[name] = value;
    return;
  }
  const parts = name.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object' || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (!(last in cur)) cur[last] = value;
}

/** 从 HTML 抽取顶层 {{name|const}} 的 const 默认（跳过 map:） */
function extractPipeDefaults(html) {
  const out = {};
  let depth = 0;
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('{{', i);
    if (open === -1) break;
    const triple = html.startsWith('{{{', open);
    const closeSeq = triple ? '}}}' : '}}';
    const close = html.indexOf(closeSeq, open + (triple ? 3 : 2));
    if (close === -1) break;
    let inner = html.slice(open + (triple ? 3 : 2), close).trim();
    let sigil = '';
    if ('#^/&>!'.includes(inner[0])) {
      sigil = inner[0];
      inner = inner.slice(1).trim();
    }
    if (triple && !sigil) sigil = '&';
    i = close + (triple ? 3 : 2);
    if (sigil === '#' || sigil === '^') { depth++; continue; }
    if (sigil === '/') { if (depth > 0) depth--; continue; }
    if (sigil === '>' || sigil === '!' || sigil === '&') continue;
    if (depth !== 0) continue;
    const bar = inner.indexOf('|');
    if (bar === -1) continue;
    const name = inner.slice(0, bar).trim();
    const def = inner.slice(bar + 1);
    if (!name || def.startsWith('map:') || name in out) continue;
    out[name] = def;
  }
  return out;
}

function loadSample(skill, id, htmlFile) {
  const candidates = [
    path.join(path.dirname(htmlFile), `${id}.sample.json`),
    path.join(SKILLS_DIR, skill, 'templates', 'data', `${id}.sample.json`),
    path.join(SKILLS_DIR, skill, 'templates', 'html', `${id}.sample.json`),
  ];
  for (const fp of candidates) {
    try {
      if (!fs.existsSync(fp)) continue;
      const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch { /* next */ }
  }
  return null;
}

function heuristicValue(name) {
  const n = String(name);
  if (n === 'compact_followups') return '';
  if (n.endsWith('_json')) {
    if (/bounds|fit/i.test(n)) return 'null';
    if (/center_json/.test(n)) return JSON.stringify({ lat: 21.531, lng: 108.172, name: '嘉路康养中心' });
    if (/path|polyline|waypoint|spot|marker|product/i.test(n)) return '[]';
    return '{}';
  }
  if (n.endsWith('_count') || /Count$/.test(n) || n === 'total' || n === 'walkCount' || n === 'staffCount') return 0;
  if (n === 'radiusKm') return 15;
  if (n === 'centerLat') return 21.531;
  if (n === 'centerLng') return 108.172;
  if (n === 'centerName') return '嘉路康养中心';
  if (n === 'city' || n === 'destination') return '防城港';
  if (n === 'routeTitle') return '防城港滨海旅居线';
  if (n === 'routeTheme') return '滨海康养';
  if (n === 'season') return '四季适宜';
  if (n === 'budgetLevel') return '经济型';
  if (n === 'days') return '3天2晚';
  if (n === 'suitable') return '适老康养';
  if (n === 'bookingStatus') return '可预约';
  if (n === 'healthNotice') return '请按医嘱安排行程强度';
  if (n === 'summary' || n === 'intro' || n === 'note') return '示例摘要';
  if (n === 'categoryLabel') return '周边配套';
  if (n === 'static_svg') return '';
  if (n === 'static_map_url' || n === 'static_map_img') return '';
  if (n === 'route_planning_url') return '';
  if (/BtnText$/i.test(n) || n === 'confirmBtnText') return '确认';
  if (n === 'modifyBtnText') return '修改';
  if (n === 'formBtnText') return '填写';
  if (n === 'footSource' || n === 'source' || n === 'sourceLabel' || n === 'sourceNote') return '桂小养示例数据';
  if (n === 'pageTitle' || n === 'cardTitle' || n === 'title' || n === 'badge' || n === 'sectionBadge') return '示例';
  if (n === 'cardEyebrow' || n === 'eyebrow' || n === 'cardSub' || n === 'heroSub' || n === 'subtitle') return '示例说明';
  return '';
}

function getByPath(obj, name) {
  if (!obj) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
  if (!name.includes('.')) return undefined;
  let cur = obj;
  for (const p of name.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function scanPairs() {
  const out = [];
  if (!fs.existsSync(SKILLS_DIR)) return out;
  for (const e of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const dir = path.join(SKILLS_DIR, e.name, 'templates', 'html');
    if (!fs.existsSync(dir)) continue;
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, f.name);
        if (f.isDirectory()) walk(fp);
        else if (f.name.endsWith('.html')) {
          const man = fp.replace(/\.html$/, '.manifest.json');
          if (fs.existsSync(man)) out.push({ htmlFile: fp, manifestFile: man, skill: e.name });
        }
      }
    };
    walk(dir);
  }
  return out;
}

const dry = process.argv.includes('--dry');
let updated = 0;
let alreadyOk = 0;
const remaining = [];

for (const { htmlFile, manifestFile, skill } of scanPairs()) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const id = manifest.id || path.basename(htmlFile, '.html');
  let html = fs.readFileSync(htmlFile, 'utf8');
  const names = collectTopLevelNames(html);
  const data = { ...(parseEmbeddedJson(html) || {}) };
  const missing = names.filter((n) => !hasKey(data, n));
  if (!missing.length) {
    alreadyOk++;
    continue;
  }

  const sample = loadSample(skill, id, htmlFile) || {};
  const pipes = extractPipeDefaults(html);

  for (const name of missing) {
    const fromSample = getByPath(sample, name);
    if (fromSample !== undefined) {
      setNested(data, name, fromSample);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(pipes, name)) {
      setNested(data, name, pipes[name]);
      continue;
    }
    // 样本可能是嵌套根：若 name 为 a.b 且 sample.a 是对象，已在 getByPath 处理
    // 若 sample 整包可浅合并缺根字段
    if (!name.includes('.') && sample[name] !== undefined) {
      data[name] = sample[name];
      continue;
    }
    setNested(data, name, heuristicValue(name));
  }

  // 浅合并样本中其它有用顶层键（不覆盖已有）
  for (const [k, v] of Object.entries(sample)) {
    if (!(k in data)) data[k] = v;
  }

  const still = names.filter((n) => !hasKey(data, n));
  if (still.length) remaining.push({ id, skill, still });

  if (!dry) {
    html = setEmbeddedJson(html, data);
    fs.writeFileSync(htmlFile, html, 'utf8');
  }
  updated++;
  console.log(`${dry ? '[dry] ' : ''}filled ${skill}/${id} (+${missing.length})`);
}

console.log(JSON.stringify({
  updated,
  alreadyOk,
  remaining: remaining.length,
  remainingSample: remaining.slice(0, 10),
  dry,
}, null, 2));
