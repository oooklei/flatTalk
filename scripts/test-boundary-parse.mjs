// 排查巴马行政区边界解析：模拟 fetchDistrictBoundary 的本地GeoJSON解析逻辑
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/GuiCare/flatTalk';
const geoDir = path.join(ROOT, 'geographicSVG');
const destination = '巴马';

const files = fs.readdirSync(geoDir).filter((f) => f.endsWith('.geojson'));
console.log('=== geographicSVG 下的 geojson 文件 ===');
files.forEach((f) => console.log('  -', f));

// 模拟文件匹配逻辑
const searchKeys = [destination];
const DESTINATION_GEOJSON_MAP = {
  '巴马': ['bama', 'bama_boundary'],
  '防城港': ['fcg', 'fcg_boundary', 'fangchenggang'],
};
const mapped = DESTINATION_GEOJSON_MAP[destination];
if (mapped) searchKeys.push(...mapped);

console.log('\n=== 搜索关键词 ===', searchKeys);

const matchedFiles = [];
for (const file of files) {
  const lower = file.toLowerCase();
  const matched = searchKeys.some((k) => {
    const lk = k.toLowerCase().replace(/边界|县|市/g, '');
    return lower.includes(lk) || lk.includes(lower.replace('.geojson', '').replace(/边界|县|市/g, ''));
  });
  if (matched) matchedFiles.push(file);
}
console.log('\n=== 匹配到的文件 ===', matchedFiles);

// 对匹配的文件做解析，模拟现有解析逻辑
for (const file of matchedFiles) {
  console.log('\n=== 解析文件:', file, '===');
  const geojson = JSON.parse(fs.readFileSync(path.join(geoDir, file), 'utf8'));
  const features = geojson.features || [];
  if (features.length === 0) { console.log('  无 features'); continue; }
  const f = features[0];
  const gtype = f.geometry?.type;
  const coords = f.geometry?.coordinates || [];
  console.log('  geometry.type:', gtype);
  console.log('  coordinates 顶层 length:', coords.length);

  // 现有解析逻辑
  const polygons = coords
    .filter((ring) => Array.isArray(ring) && ring.length > 2)
    .map((ring) => {
      if (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) {
        return ring[0].map(([lng, lat]) => ({ lat, lng }));
      }
      return ring.map(([lng, lat]) => ({ lat, lng }));
    })
    .filter((poly) => poly.length > 2);

  console.log('  现有逻辑解析出的 polygons 数量:', polygons.length);
  polygons.forEach((p, i) => console.log(`    polygon[${i}] 点数:`, p.length));

  // 详细看每个 ring 的结构
  console.log('  --- 每个 ring 的结构 ---');
  coords.forEach((ring, i) => {
    const isArray = Array.isArray(ring);
    const len = isArray ? ring.length : 'N/A';
    const innerIsArray = isArray && Array.isArray(ring[0]);
    const innerInnerIsArray = innerIsArray && Array.isArray(ring[0][0]);
    console.log(`    coords[${i}]: isArray=${isArray}, length=${len}, ring[0]isArray=${innerIsArray}, ring[0][0]isArray=${innerInnerIsArray}`);
  });

  // 修正逻辑：兼容 Polygon 和 MultiPolygon
  let fixedPolygons = [];
  if (gtype === 'Polygon') {
    // coords = [ring1, ring2, ...]  ring = [[lng,lat],...]
    if (coords.length > 0) {
      fixedPolygons.push(coords[0].map(([lng, lat]) => ({ lat, lng })));
    }
  } else if (gtype === 'MultiPolygon') {
    // coords = [poly1, poly2, ...]  poly = [ring1, ring2, ...]  ring = [[lng,lat],...]
    for (const poly of coords) {
      if (Array.isArray(poly) && poly.length > 0 && Array.isArray(poly[0])) {
        fixedPolygons.push(poly[0].map(([lng, lat]) => ({ lat, lng })));
      }
    }
  }
  console.log('  修正逻辑解析出的 polygons 数量:', fixedPolygons.length);
  fixedPolygons.forEach((p, i) => console.log(`    fixed polygon[${i}] 点数:`, p.length));
}
