/**
 * 批量生成全部 sojourn-maps 资源包的艺术底图 SVG
 * 用法: node scripts/batch-generate-route-map-art.mjs
 * 环境: FLATTALK_ROUTE_MAP_AI=1（默认）; =0 仅地理底图
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { generateSvg, fetchDistrictBoundary } from '../src/admin/mapstudio.js';
import { buildRouteMapArtBackground } from '../src/core/map/route-map-art.js';
import { TencentMapAdapter } from '../src/services/map/tencent-map-adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAPS_DIR = path.join(ROOT, 'data', 'sojourn-maps');
const REPORT = path.join(ROOT, 'data', 'sojourn-map-art-batch-report.json');

function downloadImageAsBase64(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    try {
      const client = String(url || '').startsWith('https') ? https : http;
      const req = client.get(url, { timeout: timeoutMs }, (resp) => {
        if (resp.statusCode !== 200) { resolve(null); return; }
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const buf = Buffer.concat(chunks);
          const mime = resp.headers['content-type'] || 'image/png';
          if (String(mime).includes('json') || buf.slice(0, 1).toString() === '{') {
            resolve(null);
            return;
          }
          resolve(`data:${mime};base64,${buf.toString('base64')}`);
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch {
      resolve(null);
    }
  });
}

function listPackages() {
  return fs.readdirSync(MAPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(MAPS_DIR, name, 'route_data.json')))
    .sort();
}

function calcZoom(waypoints) {
  const lats = waypoints.map((w) => Number(w.lat)).filter(Number.isFinite);
  const lngs = waypoints.map((w) => Number(w.lng)).filter(Number.isFinite);
  if (!lats.length || !lngs.length) return { zoom: 10, centerLat: 23.5, centerLng: 109 };
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
  let zoom = 11;
  if (span > 1.5) zoom = 8;
  else if (span > 0.8) zoom = 9;
  else if (span > 0.4) zoom = 10;
  else if (span > 0.15) zoom = 11;
  else if (span > 0.06) zoom = 12;
  else zoom = 13;
  return { zoom, centerLat, centerLng };
}

async function processOne(routeId, mapAdapter) {
  const pkgDir = path.join(MAPS_DIR, routeId);
  const routeData = JSON.parse(fs.readFileSync(path.join(pkgDir, 'route_data.json'), 'utf8'));
  const waypoints = Array.isArray(routeData.waypoints) ? routeData.waypoints : [];
  const routeName = routeData.route_name || routeId;
  const destination = routeData.destination || '';

  if (!waypoints.length) {
    return { routeId, ok: false, error: 'no_waypoints' };
  }

  const { zoom, centerLat, centerLng } = calcZoom(waypoints);
  const t0 = Date.now();

  // 边界：本地 GeoJSON 优先，失败再走 mapstudio 双源
  let boundary = [];
  try {
    // loadBoundaryFromLocal 未 export，直接用 fetchDistrictBoundary
    const bd = await fetchDistrictBoundary(destination, routeName);
    boundary = bd?.polygons || [];
  } catch {
    boundary = [];
  }

  const art = await buildRouteMapArtBackground({
    routeId,
    routeName,
    destination,
    waypoints,
    centerLat,
    centerLng,
    zoom,
    size: '800*840',
    enableAi: String(process.env.FLATTALK_ROUTE_MAP_AI || '1') !== '0',
    downloadImageAsBase64,
    buildStaticMapUrl: (c, m, o) => mapAdapter.buildStaticMapUrl(c, m, o),
  });

  const bg = art?.data_uri || '';
  const svgStd = generateSvg(waypoints, routeId, routeName, 'standard', bg, boundary);
  const svgElder = generateSvg(waypoints, routeId, routeName, 'elder', bg, boundary);

  fs.writeFileSync(path.join(pkgDir, 'map_standard.svg'), svgStd, 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'map_elder.svg'), svgElder, 'utf8');

  // 同步扁平文件（若存在）
  const flatStd = path.join(MAPS_DIR, `${routeId}_standard.svg`);
  const flatElder = path.join(MAPS_DIR, `${routeId}_elder.svg`);
  if (fs.existsSync(flatStd) || true) fs.writeFileSync(flatStd, svgStd, 'utf8');
  if (fs.existsSync(flatElder) || true) fs.writeFileSync(flatElder, svgElder, 'utf8');

  // 记录 art meta
  const meta = {
    route_id: routeId,
    art_source: art?.source || 'none',
    maptype: art?.maptype || '',
    model: art?.model || '',
    cached: !!art?.cached,
    features: art?.features?.topLabels || [],
    error: art?.error || '',
    elapsed_ms: Date.now() - t0,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pkgDir, 'art_meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  return { routeId, ok: true, ...meta, hasBg: !!bg, svgBytes: svgStd.length };
}

async function main() {
  const packages = listPackages();
  console.log(`[batch-art] packages=${packages.length}`);
  console.log(`[batch-art] AI=${process.env.FLATTALK_ROUTE_MAP_AI || '1'}`);
  const mapAdapter = new TencentMapAdapter();
  const report = { started_at: new Date().toISOString(), items: [] };

  for (let i = 0; i < packages.length; i++) {
    const id = packages[i];
    process.stdout.write(`[${i + 1}/${packages.length}] ${id} ... `);
    try {
      const r = await processOne(id, mapAdapter);
      report.items.push(r);
      console.log(r.ok
        ? `ok source=${r.art_source} cached=${r.cached} ${r.elapsed_ms}ms`
        : `fail ${r.error}`);
    } catch (e) {
      const item = { routeId: id, ok: false, error: e?.message || String(e) };
      report.items.push(item);
      console.log(`error ${item.error}`);
    }
    // 轻微限速，避免 Seedream / 腾讯连打
    await new Promise((r) => setTimeout(r, 800));
  }

  report.finished_at = new Date().toISOString();
  report.ok = report.items.filter((x) => x.ok).length;
  report.fail = report.items.filter((x) => !x.ok).length;
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[batch-art] done ok=${report.ok} fail=${report.fail}`);
  console.log(`[batch-art] report ${REPORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
