/**
 * 举一反三刷新 sojourn-maps：
 * 1) 本地景点图
 * 2) 空 highlights/itinerary 从 waypoints 写回（禁止运行时套异地样例）
 * 3) 注入行政区边界后重生 SVG（不嵌光栅底图）
 *
 * Run: node scripts/enrich-sojourn-maps-spot-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichWaypointsFromDashboardKb } from '../src/skills/travel_route/dashboard-spot-kb.js';
import { generateSvg, fetchDistrictBoundary } from '../src/admin/mapstudio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPS = path.join(ROOT, 'data', 'sojourn-maps');

function buildContentFromWaypoints(waypoints = []) {
  const list = Array.isArray(waypoints) ? waypoints.filter((wp) => wp && (wp.name || wp.plan)) : [];
  if (!list.length) return { highlights: [], itinerary: [] };
  const highlights = [];
  const seen = new Set();
  for (const wp of list) {
    const name = String(wp.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const plan = String(wp.plan || '').trim();
    highlights.push(plan ? `${name}·${plan}` : name);
    if (highlights.length >= 5) break;
  }
  const itinerary = list.map((wp, i) => {
    const dayRaw = String(wp.day || '').trim();
    const day = dayRaw
      ? (/^D\d+/i.test(dayRaw) ? dayRaw.replace(/^day/i, 'D') : dayRaw.replace(/^Day\s*/i, 'D'))
      : `D${i + 1}`;
    return {
      day,
      wp_name: String(wp.name || '').trim(),
      plan: String(wp.plan || '').trim() || `${wp.name || '途经点'}体验`,
    };
  });
  return { highlights, itinerary };
}

let updated = 0;
let svgOk = 0;
let boundaryOk = 0;

for (const dir of fs.readdirSync(MAPS)) {
  const pkgDir = path.join(MAPS, dir);
  if (!fs.statSync(pkgDir).isDirectory()) continue;
  const routePath = path.join(pkgDir, 'route_data.json');
  if (!fs.existsSync(routePath)) continue;

  const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));
  const wps = Array.isArray(route.waypoints) ? route.waypoints : [];
  if (!wps.length) continue;

  const enriched = enrichWaypointsFromDashboardKb(wps);
  const before = wps.filter((w) => (w.spot_images || []).length).length;
  const after = enriched.filter((w) => (w.spot_images || []).length).length;

  route.waypoints = enriched;
  route.spot_images_source = 'dashboard_local_kb';

  // 空亮点/行程：从途经点写回，避免运行时回落巴马样例
  const fromWp = buildContentFromWaypoints(enriched);
  if (!(Array.isArray(route.highlights) && route.highlights.length) && fromWp.highlights.length) {
    route.highlights = fromWp.highlights;
  }
  if (!(Array.isArray(route.itinerary) && route.itinerary.length) && fromWp.itinerary.length) {
    route.itinerary = fromWp.itinerary;
  }

  const dest = Array.isArray(route.destination) ? route.destination[0] : route.destination;
  const routeName = route.route_name || route.title || dir;
  const boundary = await fetchDistrictBoundary(dest || '', routeName);
  route.boundary_source = boundary.source;
  route.boundary_name = boundary.name || '';
  route.boundary_polygon_count = boundary.polygons?.length || 0;
  if (boundary.source !== 'none') boundaryOk += 1;

  route.updated_at = new Date().toISOString();
  try {
    fs.writeFileSync(routePath, JSON.stringify(route, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[write-fail] ${dir} route_data:`, e.message);
    continue;
  }
  updated += 1;

  const routeId = route.route_id || dir;
  try {
    const polys = boundary.polygons || [];
    const svgStd = generateSvg(enriched, routeId, routeName, 'standard', '', polys);
    const svgElder = generateSvg(enriched, routeId, routeName, 'elder', '', polys);
    fs.writeFileSync(path.join(pkgDir, 'map_standard.svg'), svgStd, 'utf8');
    fs.writeFileSync(path.join(pkgDir, 'map_elder.svg'), svgElder, 'utf8');
    try {
      fs.writeFileSync(path.join(MAPS, `${routeId}_standard.svg`), svgStd, 'utf8');
      fs.writeFileSync(path.join(MAPS, `${routeId}_elder.svg`), svgElder, 'utf8');
    } catch (e) {
      console.warn(`[flat-svg-fail] ${routeId}:`, e.message);
    }
    svgOk += 1;
    const hasBd = svgStd.includes('district-boundary');
    console.log(
      `[ok] ${routeId} images ${before}->${after} boundary=${boundary.source}/${polys.length} svgBoundary=${hasBd}`
    );
  } catch (e) {
    console.warn(`[svg-fail] ${routeId}:`, e.message);
  }
}

console.log(`[done] packages=${updated} svg=${svgOk} withBoundary=${boundaryOk}`);
