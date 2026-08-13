/**
 * 批量刷新 sojourn-maps SVG：
 * - 去掉「康养旅居 · 精品路线」等副标题
 * - 按新字号规则重生（缩放后 ≥10）
 * - 尽量保留已有艺术底图 data:image
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateSvg } from '../src/admin/mapstudio.js';

const ROOT = process.cwd();
const MAPS = path.join(ROOT, 'data', 'sojourn-maps');

function extractArtBg(svg = '') {
  const m = String(svg).match(/<image[^>]+(?:href|xlink:href)="(data:image[^"]+)"/i);
  return m ? m[1] : '';
}

function listPackages() {
  return fs.readdirSync(MAPS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(MAPS, name, 'route_data.json')));
}

function loadBoundary(pkgDir) {
  const fp = path.join(pkgDir, 'boundary.json');
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.polygons)) return raw.polygons;
    return [];
  } catch {
    return [];
  }
}

let ok = 0;
let fail = 0;
for (const routeId of listPackages()) {
  const pkgDir = path.join(MAPS, routeId);
  try {
    const route = JSON.parse(fs.readFileSync(path.join(pkgDir, 'route_data.json'), 'utf8'));
    const waypoints = Array.isArray(route.waypoints) ? route.waypoints : [];
    if (!waypoints.length) {
      console.log(`[skip] ${routeId} no waypoints`);
      continue;
    }
    const routeName = route.route_name || routeId;
    const boundary = loadBoundary(pkgDir);

    const prevStd = fs.existsSync(path.join(pkgDir, 'map_standard.svg'))
      ? fs.readFileSync(path.join(pkgDir, 'map_standard.svg'), 'utf8')
      : '';
    const prevElder = fs.existsSync(path.join(pkgDir, 'map_elder.svg'))
      ? fs.readFileSync(path.join(pkgDir, 'map_elder.svg'), 'utf8')
      : '';
    const bg = extractArtBg(prevStd) || extractArtBg(prevElder);

    const svgStd = generateSvg(waypoints, routeId, routeName, 'standard', bg, boundary);
    const svgElder = generateSvg(waypoints, routeId, routeName, 'elder', bg, boundary);

    fs.writeFileSync(path.join(pkgDir, 'map_standard.svg'), svgStd, 'utf8');
    fs.writeFileSync(path.join(pkgDir, 'map_elder.svg'), svgElder, 'utf8');
    // 兼容扁平副本
    const flatStd = path.join(MAPS, `${routeId}_standard.svg`);
    const flatElder = path.join(MAPS, `${routeId}_elder.svg`);
    if (fs.existsSync(flatStd) || prevStd) fs.writeFileSync(flatStd, svgStd, 'utf8');
    if (fs.existsSync(flatElder) || prevElder) fs.writeFileSync(flatElder, svgElder, 'utf8');

    const hasSub = /康养旅居\s*[·•]\s*精品路线/.test(svgStd);
    const minFs = Math.min(
      ...[...svgStd.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]))
    );
    console.log(`[ok] ${routeId} art=${bg ? 'yes' : 'no'} minFont=${minFs} hasSlogan=${hasSub}`);
    ok += 1;
  } catch (e) {
    fail += 1;
    console.error(`[fail] ${routeId}`, e.message);
  }
}
console.log(`done ok=${ok} fail=${fail}`);
