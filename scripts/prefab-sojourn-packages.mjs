/**
 * 批量预制 sojourn-maps 资源包（FCG + Dashboard Excel + 金跳动）
 * 同义合并：dashboard FCG ↔ fcg_route_*；巴马 excel/JTD mock → bama_5d4n
 *
 * Run: node scripts/prefab-sojourn-packages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSvg } from '../src/admin/mapstudio.js';
import { createJtdClient } from '../src/services/travel/jtd-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAPS = path.join(ROOT, 'data', 'sojourn-maps');
const DASH = path.join(ROOT, '..', 'flatTalk-dashboard', 'data');
const FCG_FILE = path.join(ROOT, 'data', 'fangchenggang-routes.json');

const CITY_COORDS = {
  桂林: [25.274, 110.29], 永福: [24.98, 109.983], 阳朔: [24.778, 110.489],
  恭城: [24.833, 110.83], 荔浦: [24.489, 110.397], 贺州: [24.414, 111.552],
  昭平: [24.17, 110.81], 钟山: [24.52, 111.3], 富川: [24.82, 111.28],
  南宁: [22.817, 108.366], 上林: [23.43, 108.6], 马山: [23.71, 108.18],
  崇左: [22.4, 107.37], 扶绥: [22.63, 107.9], 天等: [23.08, 107.14],
  大新: [22.83, 107.2], 龙州: [22.34, 106.85], 防城港: [21.69, 108.35],
  东兴: [21.54, 107.97], 北海: [21.48, 109.12], 钦州: [21.98, 108.62],
  宁明: [22.13, 107.07], 巴马: [24.12, 107.25], 南丹: [24.98, 107.54],
  三江: [25.78, 109.61], 龙胜: [25.8, 110.01], 柳州: [24.326, 109.428],
  金秀: [24.13, 110.19], 平乐: [24.63, 110.64], 来宾: [23.75, 109.23],
  七洞乡: [23.6817, 109.0512], 兴宾: [23.73, 109.22],
};

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function inferProductType(text = '') {
  const t = String(text);
  if (/滨海|海滩|银滩|京族|口岸|边境|涠洲|海滨|跨境|芒街/.test(t)) return 'coastal';
  if (/文化|非遗|古镇|侗|瑶|壮|花山|风雨桥|民俗/.test(t)) return 'culture';
  if (/生态|山水|梯田|溶洞|森林|喀斯特|德天|漂流/.test(t)) return 'ecology';
  return 'wellness';
}

function mergePublish(routeId, patch) {
  const f = path.join(MAPS, routeId, 'publish.json');
  let cur = {};
  if (fs.existsSync(f)) cur = JSON.parse(fs.readFileSync(f, 'utf8'));
  const dest = new Set([...(cur.destination || []), ...(patch.destination || [])].filter(Boolean));
  const kw = new Set([...(cur.keywords || []), ...(patch.keywords || [])].filter(Boolean));
  const out = {
    ...cur,
    ...patch,
    route_id: routeId,
    status: patch.status || cur.status || 'published',
    destination: [...dest],
    keywords: [...kw],
    product_type: patch.product_type || cur.product_type || 'wellness',
    title: patch.title || cur.title || routeId,
    updated_at: new Date().toISOString(),
    aliases: [...new Set([...(cur.aliases || []), ...(patch.aliases || [])])],
  };
  fs.writeFileSync(f, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

function writePackage({ routeId, routeData, svgStandard, svgElder, publish }) {
  const dir = path.join(MAPS, routeId);
  ensureDir(dir);
  const rd = { ...routeData, route_id: routeId, updated_at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'route_data.json'), JSON.stringify(rd, null, 2), 'utf8');
  if (svgStandard) {
    fs.writeFileSync(path.join(dir, 'map_standard.svg'), svgStandard, 'utf8');
    fs.writeFileSync(path.join(MAPS, `${routeId}_standard.svg`), svgStandard, 'utf8');
  }
  if (svgElder) {
    fs.writeFileSync(path.join(dir, 'map_elder.svg'), svgElder, 'utf8');
    fs.writeFileSync(path.join(MAPS, `${routeId}_elder.svg`), svgElder, 'utf8');
  }
  const publishOut = {
    route_id: routeId,
    status: publish.status || 'published',
    destination: [...new Set((publish.destination || []).filter(Boolean))],
    keywords: [...new Set((publish.keywords || []).filter(Boolean))],
    product_type: publish.product_type || 'wellness',
    title: publish.title || routeId,
    updated_at: new Date().toISOString(),
    aliases: [...new Set(publish.aliases || [])],
  };
  fs.writeFileSync(path.join(dir, 'publish.json'), JSON.stringify(publishOut, null, 2), 'utf8');
  console.log('[ok]', routeId, publishOut.status, publishOut.product_type, publishOut.title);
}

function buildSvg(waypoints, routeId, routeName) {
  const std = generateSvg(waypoints, routeId, routeName, 'standard');
  const elder = generateSvg(waypoints, routeId, routeName, 'elder');
  return { svgStandard: std, svgElder: elder };
}

function pointsToWaypoints(points = [], fallbackDest) {
  return points.map((p, i) => {
    let lat = Array.isArray(p.coord) ? Number(p.coord[1]) : Number(p.lat);
    let lng = Array.isArray(p.coord) ? Number(p.coord[0]) : Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const key = Object.keys(CITY_COORDS).find((k) => String(p.name || p.city || '').includes(k));
      if (key) { lat = CITY_COORDS[key][0]; lng = CITY_COORDS[key][1]; }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const fb = CITY_COORDS[fallbackDest] || CITY_COORDS['南宁'];
      lat = fb[0] + i * 0.02; lng = fb[1] + i * 0.02;
    }
    const type = i === 0 ? 'arrival' : (i === points.length - 1 ? 'departure' : 'spot');
    return {
      id: `wp${i + 1}`,
      name: p.name || p.city || `点${i + 1}`,
      type,
      day: `Day${Math.min(i + 1, 7)}`,
      plan: p.plan || p.name || '',
      lat, lng,
      spot_desc: p.spot_desc || '',
    };
  });
}

function pathTokensToWaypoints(pathStr, fallbackDest) {
  const parts = String(pathStr || '')
    .split(/→|->|－|-|—|～|,|，/)
    .map((s) => s.replace(/^线路\d+_?/g, '').trim())
    .filter(Boolean);
  const points = parts.map((name) => {
    const key = Object.keys(CITY_COORDS).find((k) => name.includes(k));
    const c = key ? CITY_COORDS[key] : null;
    return { name, lat: c?.[0], lng: c?.[1] };
  });
  return pointsToWaypoints(points, fallbackDest);
}

function inferDestFromText(text) {
  const t = String(text || '');
  // 多城线路：优先路径起点（南宁-北海-… → 南宁）
  const first = t.split(/→|->|－|-|—/)[0] || t;
  const order = ['七洞乡', '防城港', '东兴', '北海', '钦州', '巴马', '桂林', '阳朔', '贺州', '崇左', '南宁', '柳州', '来宾', '三江', '龙胜'];
  const fromFirst = order.find((c) => first.includes(c));
  if (fromFirst) return fromFirst;
  return order.find((c) => t.includes(c)) || '广西';
}

function keywordsFrom(...parts) {
  const raw = parts.flat().filter(Boolean).join(' ');
  const prefer = [];
  const patterns = [
    /京族滨海文化线|银发爱情边境线|壮村民俗康养线|森林轻氧休闲线|芒街跨境体验线/,
    /南宁-北海-钦州-防城港滨海养老旅居线|边关壮瑶|梯田温泉侗瑶|山水瑶泉|山水温泉长寿/,
    /百魔洞|长寿村|赐福湖|金滩|白浪滩|涠洲岛|德天|花山|风雨桥|银滩/,
    /七洞乡|0730测试|0724测试|5天4晚|三日游/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) prefer.push(m[0]);
  }
  const bag = new Set(prefer);
  for (const chunk of parts.flat()) {
    const s = String(chunk || '').trim();
    if (s.length >= 2 && s.length <= 14) bag.add(s);
  }
  for (const stop of ['旅居', '康养', '线路', '路线', '养老', '广西', '市区', '体验', '文化', '休闲', '七日']) {
    bag.delete(stop);
  }
  return [...bag].slice(0, 12);
}

function extractShortTags(name = '') {
  const t = String(name);
  const tags = [];
  if (/京族/.test(t)) tags.push('京族');
  if (/银发爱情|边境/.test(t)) tags.push('银发爱情', '边境线');
  if (/壮村|民俗/.test(t)) tags.push('壮村', '民俗');
  if (/森林|轻氧/.test(t)) tags.push('森林', '轻氧');
  if (/芒街|跨境/.test(t)) tags.push('芒街', '跨境');
  return tags;
}

// ---------- FCG 002-005 from local fangchenggang-routes ----------
function prefabFcg() {
  const routes = JSON.parse(fs.readFileSync(FCG_FILE, 'utf8'));
  const typeMap = {
    fcg_route_001: 'coastal',
    fcg_route_002: 'culture',
    fcg_route_003: 'culture',
    fcg_route_004: 'ecology',
    fcg_route_005: 'coastal',
  };
  for (const r of routes) {
    const routeId = r.product_id;
    const waypoints = (r.waypoints || []).map((w, i) => ({
      id: `wp${i + 1}`,
      name: w.name,
      type: w.type || 'spot',
      day: w.day || 'Day1',
      plan: w.plan || '',
      lat: Number(w.lat),
      lng: Number(w.lng),
      spot_desc: (r.highlights || [])[i] || '',
    })).filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng));
    const { svgStandard, svgElder } = buildSvg(waypoints, routeId, r.product_name);
    writePackage({
      routeId,
      routeData: {
        route_name: r.product_name,
        destination: r.destination,
        days: 1,
        summary: r.summary,
        highlights: r.highlights || [],
        suitable_for: r.suitable_for,
        tags: r.tags || [],
        waypoints,
        price_label: r.price_label,
        source: 'fangchenggang-routes',
        aliases: [`route_dash_fcg_${routeId.slice(-1)}`],
      },
      svgStandard,
      svgElder,
      publish: {
        status: 'published',
        destination: [r.destination, '东兴'].filter(Boolean),
        keywords: [
          r.product_name,
          ...(r.tags || []).slice(0, 3),
          ...extractShortTags(r.product_name),
        ].filter(Boolean),
        product_type: typeMap[routeId] || inferProductType(r.product_name + (r.tags || []).join('')),
        title: r.product_name,
        aliases: [`route_dash_fcg_${Number(routeId.slice(-1))}`],
      },
    });
  }
}

// ---------- Dashboard excel 10 (+ merge FCG aliases already handled) ----------
function prefabDashboardExcel() {
  const knowledge = JSON.parse(fs.readFileSync(path.join(DASH, 'travel-routes-knowledge.json'), 'utf8'));
  const geo = JSON.parse(fs.readFileSync(path.join(DASH, 'travelRouteGeo.json'), 'utf8'));
  const geoById = Object.fromEntries(geo.map((g) => [g.id, g]));

  for (const r of knowledge) {
    if (String(r.source || '').includes('docx_fcg') || String(r.id).includes('route_dash_fcg')) {
      // 同义：合并到已有 fcg_route_00x
      const n = String(r.id).match(/fcg_(\d)/)?.[1];
      if (n) {
        const target = `fcg_route_00${n}`;
        mergePublish(target, {
          aliases: [r.id],
          keywords: [r.name].filter(Boolean),
          destination: ['防城港'],
        });
        console.log('[merge]', r.id, '→', target);
      }
      continue;
    }

    // 巴马长寿线 → 合并进 bama_5d4n
    if (/巴马|长寿/.test(r.id + r.name) && /线路7|巴马_南丹|南丹长寿/.test(r.id + r.name)) {
      mergePublish('bama_5d4n', {
        aliases: [r.id],
        keywords: ['南丹', '南丹长寿', '巴马南丹', '长寿养老旅居线'],
        destination: ['巴马', '南丹', '河池'],
        title: '巴马5天4晚康养旅居',
        status: 'published',
        product_type: 'wellness',
      });
      console.log('[merge]', r.id, '→ bama_5d4n');
      continue;
    }

    const idx = knowledge.indexOf(r) + 1;
    const routeId = `gx_excel_${String(idx).padStart(2, '0')}`;
    const g = geoById[r.id];
    let waypoints = pointsToWaypoints(g?.points || r.points || [], inferDestFromText(r.route_path || r.name));
    // 线路10 geo 误用巴马点：按路径名重建
    if (idx === 10 || (/柳州|金秀|平乐/.test(r.id) && waypoints.some((w) => /巴马|南丹|盘阳/.test(w.name)))) {
      waypoints = pathTokensToWaypoints('柳州-金秀-荔浦-平乐', '柳州');
    }
    if (waypoints.length < 2) {
      waypoints = pathTokensToWaypoints(r.route_path || r.name, inferDestFromText(r.name));
    }

    const dest = inferDestFromText(r.route_path || r.name || waypoints[0]?.name);
    const title = (r.route_path || r.name || routeId).replace(/^线路\d+_?/, '').slice(0, 40);
    const itinerary = Array.isArray(r.itinerary) ? r.itinerary : [];
    const highlights = (r.highlights && r.highlights.length)
      ? r.highlights
      : itinerary.map((it) => it.theme || it.day).filter(Boolean).slice(0, 6);
    // 把行程主题写进 waypoint.spot_desc，便于 SVG/卡片展示
    waypoints = waypoints.map((wp, i) => {
      const it = itinerary[i] || itinerary.find((x) => String(x.day || '').includes(wp.name)) || null;
      const desc = [it?.theme, it?.plan, wp.spot_desc].filter(Boolean).join(' · ').slice(0, 120);
      return { ...wp, spot_desc: desc || wp.spot_desc || '' };
    });
    const { svgStandard, svgElder } = buildSvg(waypoints, routeId, title);
    writePackage({
      routeId,
      routeData: {
        route_name: title,
        destination: dest,
        days: r.days || 7,
        summary: r.description || r.summary || '',
        highlights,
        suitable_for: r.suitable_for || '',
        medical_support: r.medical_support || '',
        accommodation_standard: r.accommodation_standard || '',
        meal_standard: r.meal_standard || '',
        transport: r.transport || '',
        waypoints,
        itinerary,
        source: 'flatTalk-dashboard',
        dashboard_id: r.id,
      },
      svgStandard,
      svgElder,
      publish: {
        status: 'published',
        destination: [dest],
        keywords: [
          title,
          ...String(r.route_path || title).split(/→|->|－|-|—/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 12).slice(0, 6),
        ],
        product_type: inferProductType(title + (r.description || '')),
        title,
        aliases: [r.id],
      },
    });
  }
}

// ---------- 金跳动 3 条真实接口产品 ----------
async function prefabJtd() {
  const client = createJtdClient();
  const search = await client.searchProducts({
    tenantId: '042788',
    productDomain: 'sojourn_route',
    pageNum: 1,
    pageSize: 50,
  });
  const records = search?.response?.data?.records
    || search?.response?.data?.list
    || search?.response?.records
    || search?.data?.records
    || [];
  console.log('[jtd] records', records.length, 'ok', search.ok);

  const QIDONG = {
    name: '七洞乡政府', lat: 23.6817, lng: 109.0512,
  };

  const presets = {
    '2070305000000000240': {
      title: '七洞乡线路产品',
      destination: '七洞乡',
      product_type: 'wellness',
      waypoints: [
        { name: '七洞乡政府', lat: 23.6817, lng: 109.0512, type: 'arrival', day: 'Day1', plan: '抵达办理入住' },
        { name: '七洞乡康养基地', lat: 23.6852, lng: 109.0491, type: 'wellness', day: 'Day2', plan: '康养体验' },
        { name: '七洞乡生态园', lat: 23.6781, lng: 109.0568, type: 'spot', day: 'Day3', plan: '生态游憩' },
        { name: '七洞乡政府', lat: 23.6817, lng: 109.0512, type: 'departure', day: 'Day3', plan: '返程' },
      ],
    },
    '2070305000000000271': {
      title: '0730测试旅居路线5天4日游',
      destination: '七洞乡',
      product_type: 'wellness',
      waypoints: [
        { name: '七洞乡抵达点', lat: 23.6817, lng: 109.0512, type: 'arrival', day: 'Day1', plan: '抵达入住' },
        { name: '七洞乡Day2体验点', lat: 23.7197, lng: 109.0388, type: 'spot', day: 'Day2', plan: '康养体验' },
        { name: '七洞乡Day3体验点', lat: 23.7052, lng: 109.0836, type: 'spot', day: 'Day3', plan: '康养体验' },
        { name: '七洞乡Day4体验点', lat: 23.6582, lng: 109.0836, type: 'spot', day: 'Day4', plan: '康养体验' },
        { name: '七洞乡返程点', lat: 23.6817, lng: 109.0512, type: 'departure', day: 'Day5', plan: '返程' },
      ],
    },
    '2070305000000000266': {
      title: '0724测试旅居路线',
      destination: '巴马',
      product_type: 'wellness',
      // 同义巴马：不单独抢流量，仍建包但 keywords 偏产品名；并把别名合并进 bama_5d4n
      waypoints: [
        { name: '巴马县城', lat: 24.12, lng: 107.25, type: 'arrival', day: 'Day1', plan: '抵达' },
        { name: '百魔洞', lat: 24.15, lng: 107.05, type: 'spot', day: 'Day2', plan: '负氧磁疗' },
        { name: '长寿村', lat: 24.10, lng: 107.15, type: 'wellness', day: 'Day3', plan: '长寿文化' },
        { name: '巴马县城', lat: 24.12, lng: 107.25, type: 'departure', day: 'Day3', plan: '返程' },
      ],
      mergeInto: 'bama_5d4n',
    },
  };

  const list = records.length ? records : Object.keys(presets).map((id) => ({ productId: id, productName: presets[id].title }));

  for (const raw of list.slice(0, 3)) {
    const id = String(raw.productId || raw.product_id || raw.id || '');
    const name = raw.productName || raw.product_name || raw.name || presets[id]?.title || id;
    const preset = presets[id] || {
      title: name,
      destination: inferDestFromText(name),
      product_type: inferProductType(name),
      waypoints: pathTokensToWaypoints(name, inferDestFromText(name)),
    };
    const routeId = `jtd_${id}`;
    const waypoints = (preset.waypoints || []).map((w, i) => ({
      id: `wp${i + 1}`,
      ...w,
      lat: Number(w.lat),
      lng: Number(w.lng),
    }));
    const { svgStandard, svgElder } = buildSvg(waypoints, routeId, preset.title || name);

    // 巴马同义：主流量归 bama_5d4n；JTD 包仍 published 但 keywords 带产品 ID，避免完全丢包
    if (preset.mergeInto) {
      mergePublish(preset.mergeInto, {
        aliases: [routeId, id, 'jtd_mock_bama_001'],
        keywords: keywordsFrom(name, '0724', '测试旅居', '金跳动'),
        destination: ['巴马'],
      });
      console.log('[merge]', routeId, '→', preset.mergeInto);
    }

    writePackage({
      routeId,
      routeData: {
        route_name: preset.title || name,
        destination: preset.destination,
        days: waypoints.length,
        summary: `金跳动产品 ${name}`,
        highlights: [],
        waypoints,
        source: 'jintiaodong',
        jtd_product_id: id,
        price_label: raw.price != null ? `约${raw.price}元/人` : undefined,
      },
      svgStandard,
      svgElder,
      publish: {
        status: 'published',
        destination: [preset.destination],
        keywords: keywordsFrom(name, preset.title, preset.destination, id.slice(-4), '金跳动', '旅居'),
        product_type: preset.product_type,
        title: preset.title || name,
        aliases: [id],
      },
    });
  }

  // mock 巴马保持 draft，避免与 published 抢命中
  if (fs.existsSync(path.join(MAPS, 'jtd_mock_bama_001', 'route_data.json'))) {
    mergePublish('jtd_mock_bama_001', {
      status: 'draft',
      aliases: ['jtd_mock_bama_001'],
      keywords: ['草稿勿命中'],
    });
  }
  // mock 北海若无包则补一个 published（接口仅 3 条真实产品；mock 北海作为补充不强制）
}

function updateIndex() {
  const dirs = fs.readdirSync(MAPS, { withFileTypes: true }).filter((d) => d.isDirectory());
  const index = [];
  for (const d of dirs) {
    const rdFile = path.join(MAPS, d.name, 'route_data.json');
    const pubFile = path.join(MAPS, d.name, 'publish.json');
    if (!fs.existsSync(rdFile)) continue;
    const rd = JSON.parse(fs.readFileSync(rdFile, 'utf8'));
    let pub = null;
    try { pub = JSON.parse(fs.readFileSync(pubFile, 'utf8')); } catch {}
    index.push({
      route_id: d.name,
      route_name: rd.route_name,
      destination: rd.destination,
      status: pub?.status || 'draft',
      product_type: pub?.product_type || null,
      updated_at: pub?.updated_at || rd.updated_at,
    });
  }
  fs.writeFileSync(path.join(MAPS, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log('[index]', index.length, 'packages');
}

async function main() {
  ensureDir(MAPS);
  console.log('=== FCG ===');
  prefabFcg();
  console.log('=== Dashboard Excel ===');
  prefabDashboardExcel();
  console.log('=== JTD ===');
  await prefabJtd();
  updateIndex();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
