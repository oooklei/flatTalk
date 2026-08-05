/**
 * Enrich sojourn-maps route_data with dashboard local spot images and regenerate SVGs.
 * Run: node scripts/enrich-sojourn-maps-spot-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichWaypointsFromDashboardKb } from '../src/skills/travel_route/dashboard-spot-kb.js';
import { generateSvg } from '../src/admin/mapstudio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPS = path.join(ROOT, 'data', 'sojourn-maps');

let updated = 0;
let svgOk = 0;

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
  route.updated_at = new Date().toISOString();
  fs.writeFileSync(routePath, JSON.stringify(route, null, 2), 'utf8');
  updated += 1;

  const routeId = route.route_id || dir;
  const routeName = route.route_name || route.title || routeId;
  try {
    const svgStd = generateSvg(enriched, routeId, routeName, 'standard');
    const svgElder = generateSvg(enriched, routeId, routeName, 'elder');
    fs.writeFileSync(path.join(pkgDir, 'map_standard.svg'), svgStd, 'utf8');
    fs.writeFileSync(path.join(pkgDir, 'map_elder.svg'), svgElder, 'utf8');
    fs.writeFileSync(path.join(MAPS, `${routeId}_standard.svg`), svgStd, 'utf8');
    fs.writeFileSync(path.join(MAPS, `${routeId}_elder.svg`), svgElder, 'utf8');
    svgOk += 1;
    console.log(`[ok] ${routeId} images ${before}->${after}`);
  } catch (e) {
    console.warn(`[svg-fail] ${routeId}:`, e.message);
  }
}

console.log(`[done] packages=${updated} svg=${svgOk}`);
