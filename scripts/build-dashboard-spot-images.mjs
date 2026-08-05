/**
 * 从 flatTalk-dashboard 本地知识库 + 既有 geographicSVG/sojourn 实拍图
 * 构建 49 端点补图索引（不调用 Tavily，零日额度消耗）
 *
 * Run: node scripts/build-dashboard-spot-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KNOW = path.join(ROOT, 'src/skills/travel_route/knowledge');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function norm(s) {
  return String(s || '')
    .replace(/[（(].*/, '')
    .replace(/\s+/g, '')
    .replace(/景区|风景区|公园|古镇|口岸|基地|旅居/g, '')
    .trim();
}

function nameMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function localPoster(name, city = '') {
  const title = String(name || '景点').slice(0, 12);
  const sub = String(city || '广西旅居').slice(0, 10);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="#1FA97E"/><stop offset="100%" stop-color="#0E7C86"/>',
    '</linearGradient></defs>',
    '<rect width="640" height="360" fill="url(#g)"/>',
    `<text x="320" y="165" text-anchor="middle" fill="#fff" font-size="42" font-family="Microsoft YaHei,sans-serif" font-weight="700">${title}</text>`,
    `<text x="320" y="220" text-anchor="middle" fill="rgba(255,255,255,.9)" font-size="22" font-family="Microsoft YaHei,sans-serif">${sub} · 本地知识库</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const geo = readJson(path.join(KNOW, 'dashboard-travelRouteGeo.json'));
const nearby = readJson(path.join(KNOW, 'dashboard-route-nearby-cache.json'));

const imagePool = [];
function addImgs(name, images, desc = '') {
  const imgs = (images || []).filter(Boolean);
  if (!name || !imgs.length) return;
  imagePool.push({ name, images: imgs.slice(0, 5), desc: String(desc || '').slice(0, 220) });
}

for (const f of ['geographicSVG/bama-spots-data.json', 'geographicSVG/fangchenggang-spots-data.json']) {
  const j = readJson(path.join(ROOT, f));
  for (const s of j.spots || j || []) {
    addImgs(s.name, s.spot_images || s.images, s.spot_desc || s.description);
  }
}

for (const dir of fs.readdirSync(path.join(ROOT, 'data/sojourn-maps'))) {
  const p = path.join(ROOT, 'data/sojourn-maps', dir, 'route_data.json');
  if (!fs.existsSync(p)) continue;
  const rd = readJson(p);
  for (const wp of rd.waypoints || []) addImgs(wp.name, wp.spot_images, wp.spot_desc);
}

const sampleDir = path.join(ROOT, 'src/skills/travel_route/templates/data');
for (const f of fs.readdirSync(sampleDir).filter((x) => x.endsWith('.json'))) {
  const j = readJson(path.join(sampleDir, f));
  for (const wp of j.waypoints || []) addImgs(wp.name, wp.spot_images, wp.spot_desc);
}

const ALIAS = {
  巴马百魔洞: '百魔洞',
  巴马长寿村: '长寿村',
  盘阳河: '命河',
  东兴京族三岛: '东兴京族三岛',
  金滩: '金滩',
  白浪滩: '白浪滩',
  德天跨国瀑布: '德天瀑布',
  大新德天瀑布: '德天瀑布',
  明仕田园: '明仕田园',
  嘉路滨海旅居基地: '嘉路滨海旅居基地',
  京族三岛: '东兴京族三岛',
};

function findImages(endpointName) {
  const alias = ALIAS[endpointName] || endpointName;
  return imagePool.find((s) => nameMatch(s.name, endpointName) || nameMatch(s.name, alias)) || null;
}

const endpoints = [];
const seen = new Set();
for (const route of geo) {
  for (const p of route.points || []) {
    if (!p?.name || seen.has(p.name)) continue;
    seen.add(p.name);
    const cache = nearby[p.name] || {};
    const related = ((cache.categories?.spot?.items) || []).slice(0, 4).map((it) => ({
      name: it.name,
      address: it.address || '',
      distance: it.distance,
      category: it.category || '',
    }));
    const hit = findImages(p.name);
    const images = hit?.images?.length ? hit.images.slice(0, 4) : [localPoster(p.name, p.city)];
    endpoints.push({
      name: p.name,
      city: p.city || '',
      lat: Array.isArray(p.coord) ? p.coord[1] : null,
      lng: Array.isArray(p.coord) ? p.coord[0] : null,
      spot_images: images,
      spot_desc: hit?.desc || (related[0] ? `周边精选：${related.map((r) => r.name).slice(0, 3).join('、')}` : ''),
      related_spots: related,
      image_source: hit ? 'local_photo' : 'local_poster',
    });
  }
}

const out = {
  generated_at: new Date().toISOString(),
  source: 'flatTalk-dashboard local KB (travelRouteGeo + route-nearby-cache + geographicSVG)',
  endpoint_count: endpoints.length,
  photo_count: endpoints.filter((e) => e.image_source === 'local_photo').length,
  poster_count: endpoints.filter((e) => e.image_source === 'local_poster').length,
  endpoints,
};

fs.writeFileSync(path.join(KNOW, 'dashboard-spot-images.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(`[build-dashboard-spot-images] endpoints=${out.endpoint_count} photos=${out.photo_count} posters=${out.poster_count}`);
