// map-kit 三模式统一测试：验证 buildRouteMapData / buildBaseMapData / buildPoiMapData
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envText = readFileSync(resolve(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { buildRouteMapData, buildBaseMapData, buildPoiMapData, sanitizePoints } = await import('../src/core/map/map-kit.js');
const { mapCanvasHtml, routeLegendHtml, poiLegendHtml } = await import('../src/core/map/map-helpers.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// ========== 模式1: route 走线 ==========
console.log('=== 模式1: route 走线 ===');
const routeData = buildRouteMapData({
  destination: '广西巴马',
  waypoints: [
    { name: '南宁', lat: 22.817, lng: 108.3669, day: 'Day1', type: 'arrival', spots: [] },
    { name: '巴马', lat: 24.0544, lng: 107.2583, day: 'Day2', type: 'stay', spots: [
      { name: '百魔洞', desc: '长寿景点', lat: 24.058, lng: 107.262, source: 'tavily' },
    ], spot_images: [] },
    { name: '北海', lat: 21.4812, lng: 109.1228, day: 'Day3', type: 'departure', spots: [] },
  ],
});

check('map_mode=route', routeData.map_mode === 'route');
check('centerLat 有效', Number.isFinite(routeData.centerLat));
check('centerLat≈24.0487', Math.abs(routeData.centerLat - 24.0487) < 0.01, `(got ${routeData.centerLat})`);
check('waypoints_json 有值', routeData.waypoints_json.length > 10);
check('polyline_path_json 有值', routeData.polyline_path_json.length > 10);
check('fit_bounds 有值', routeData.fit_bounds != null);
check('spots 提取成功', routeData.spots.length === 1, `(got ${routeData.spots.length})`);
check('spots source 脱敏', !routeData.spots[0]?.source, `(got source=${routeData.spots[0]?.source})`);
check('waypoints 内 spots 脱敏', !JSON.parse(routeData.waypoints_json).find(w=>w.spots&&w.spots[0]?.source));
check('hasSpots=true', routeData.hasSpots === true);
check('map_key 有值', routeData.map_key.length > 10);

// ========== 模式2: base 基地中心 ==========
console.log('\n=== 模式2: base 基地中心 ===');
const baseData = buildBaseMapData({
  destination: '防城港',
  bases: [
    { name: '防城港滨海康养中心', location: '防城港' },
    { name: '北海银滩康养基地', location: '北海' },
  ],
});

check('map_mode=base', baseData.map_mode === 'base');
check('centerLat 有效', Number.isFinite(baseData.centerLat));
check('centerLat≈21.6146', Math.abs(baseData.centerLat - 21.6146) < 0.01, `(got ${baseData.centerLat})`);
check('markers_json 有值', baseData.markers_json.length > 10);
check('markers 数量=2', JSON.parse(baseData.markers_json).length === 2);
check('fit_bounds 有值', baseData.fit_bounds != null);
check('map_key 有值', baseData.map_key.length > 10);

// ========== 模式3: poi POI中心 ==========
console.log('\n=== 模式3: poi POI中心 ===');
const poiData = buildPoiMapData({
  center: { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' },
  pois: [
    { name: '社区医院', lat: 21.528, lng: 108.168, cat: 'medical', distance: 0.5 },
    { name: '康养馆', lat: 21.530, lng: 108.170, cat: 'wellness', distance: 1.2 },
    { name: '海鲜餐馆', lat: 21.525, lng: 108.165, cat: 'food', distance: 0.8 },
  ],
  radiusKm: 15,
});

check('map_mode=poi', poiData.map_mode === 'poi');
check('centerLat 有效', Number.isFinite(poiData.centerLat));
check('centerLat≈21.5279', Math.abs(poiData.centerLat - 21.5279) < 0.01, `(got ${poiData.centerLat})`);
check('markers_json 有值', poiData.markers_json.length > 10);
check('pois 数量=3', JSON.parse(poiData.markers_json).length === 3);
check('radius_km=15', poiData.radius_km === 15);
check('fit_bounds 有值', poiData.fit_bounds != null);
check('map_key 有值', poiData.map_key.length > 10);

// ========== HTML 生成器 ==========
console.log('\n=== HTML 生成器 ===');
const routeCanvas = mapCanvasHtml({ canvasId: 'testRoute', mapData: routeData, legend: routeLegendHtml() });
check('mapCanvasHtml 含 data-map-mode', routeCanvas.includes('data-map-mode="route"'));
check('mapCanvasHtml 含 data-waypoints', routeCanvas.includes('data-waypoints='));
check('mapCanvasHtml 含 data-spots', routeCanvas.includes('data-spots='));
check('mapCanvasHtml 含 legend', routeCanvas.includes('mk-map-legend'));
check('mapCanvasHtml 含 canvas id', routeCanvas.includes('id="testRoute"'));

const poiCanvas = mapCanvasHtml({ canvasId: 'testPoi', mapData: poiData, legend: poiLegendHtml() });
check('poiCanvas 含 data-map-mode=poi', poiCanvas.includes('data-map-mode="poi"'));
check('poiCanvas 含 data-radius-km', poiCanvas.includes('data-radius-km="15"'));

const baseCanvas = mapCanvasHtml({ canvasId: 'testBase', mapData: baseData });
check('baseCanvas 含 data-map-mode=base', baseCanvas.includes('data-map-mode="base"'));

// ========== sanitizePoints ==========
console.log('\n=== sanitizePoints 脱敏 ===');
const cleaned = sanitizePoints([
  { name: 'A', source: 'tavily' },
  { name: 'B', source: 'tavily', spots: [{ name: 's1', source: 'tavily' }] },
]);
check('顶层 source 移除', cleaned[0].source === undefined);
check('嵌套 spots source 移除', cleaned[1].spots[0].source === undefined);

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
