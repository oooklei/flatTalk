/**
 * flatTalk-dashboard 本地知识库补图
 * - 15 条线路 / 49 端点（travelRouteGeo + route-nearby-cache）
 * - 实拍图优先：geographicSVG / sojourn-maps / 模板 sample
 * - 缺失端点用同域 SVG 海报，绝不调用 Tavily
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOW_DIR = path.join(__dirname, 'knowledge');
const INDEX_FILE = path.join(KNOW_DIR, 'dashboard-spot-images.json');

let cache = null;

function loadIndex() {
  if (cache) return cache;
  try {
    if (!fs.existsSync(INDEX_FILE)) {
      cache = { endpoints: [] };
      return cache;
    }
    cache = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return cache;
  } catch {
    cache = { endpoints: [] };
    return cache;
  }
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

export function listDashboardSpotEndpoints() {
  return loadIndex().endpoints || [];
}

export function lookupDashboardSpotImages(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const endpoints = listDashboardSpotEndpoints();
  return endpoints.find((e) => nameMatch(e.name, n) || nameMatch(n, e.name)) || null;
}

/**
 * 为 waypoints 补 spot_images / spot_desc（本地优先，不调外部搜索）
 */
export function enrichWaypointsFromDashboardKb(waypoints = []) {
  if (!Array.isArray(waypoints) || !waypoints.length) return [];
  return waypoints.map((wp) => {
    const hit = lookupDashboardSpotImages(wp?.name);
    if (!hit) return { ...wp };
    const existing = Array.isArray(wp.spot_images) ? wp.spot_images.filter(Boolean) : [];
    const images = existing.length ? existing : (hit.spot_images || []);
    return {
      ...wp,
      spot_images: images,
      spot_desc: wp.spot_desc || hit.spot_desc || '',
      related_spots: hit.related_spots || [],
      image_source: existing.length ? 'route_data' : hit.image_source,
    };
  });
}

export function getDashboardSpotKbStats() {
  const idx = loadIndex();
  return {
    endpoint_count: idx.endpoint_count || (idx.endpoints || []).length,
    photo_count: idx.photo_count || 0,
    poster_count: idx.poster_count || 0,
    generated_at: idx.generated_at || null,
    source: idx.source || '',
  };
}

export default {
  listDashboardSpotEndpoints,
  lookupDashboardSpotImages,
  enrichWaypointsFromDashboardKb,
  getDashboardSpotKbStats,
};
