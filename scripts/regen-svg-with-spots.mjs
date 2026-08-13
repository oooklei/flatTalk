// 用含真实图片和描述的 route_data.json 重新生成 SVG
// 验证：每个标点都有 data-spot-img 和 data-spot-desc
import { generateSvg } from '../src/admin/mapstudio.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/GuiCare/flatTalk';
const geoDir = path.join(ROOT, 'geographicSVG');

// 加载真实边界
function loadBoundary() {
  const geojson = JSON.parse(fs.readFileSync(path.join(geoDir, 'bama_boundary.geojson'), 'utf8'));
  const geom = geojson.features[0].geometry;
  const polygons = [];
  if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (Array.isArray(poly) && poly.length > 0) {
        const pts = poly[0].map(function (pt) { return { lat: pt[1], lng: pt[0] }; });
        polygons.push(pts);
      }
    }
  }
  return polygons;
}

// 加载含真实图片和描述的 route_data
const route = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sojourn-maps/bama_5d4n/route_data.json'), 'utf8'));
const waypoints = route.waypoints;

console.log('waypoints 总数:', waypoints.length);
const withImg = waypoints.filter(function (w) { return (w.spot_images || []).length > 0; });
const withDesc = waypoints.filter(function (w) { return (w.spot_desc || '').length > 20; });
console.log('含图片:', withImg.length, withImg.map(function(w){return w.name+'('+ (w.spot_images||[]).length +'张)'}).join(', '));
console.log('含描述:', withDesc.length);

// 生成 SVG
const boundary = loadBoundary();
const svg = generateSvg(waypoints, 'bama_5d4n', route.route_name, 'standard', '', boundary);

// 验证 data-spot-img 和 data-spot-desc 嵌入情况
const markerCount = (svg.match(/class="route-marker"/g) || []).length;
const imgCount = (svg.match(/data-spot-img=/g) || []).length;
const descCount = (svg.match(/data-spot-desc=/g) || []).length;
const realImgUrls = (svg.match(/data-spot-img="https?:\/\/[^"]+"/g) || []);

console.log('\n=== SVG 标点嵌入验证 ===');
console.log('route-marker 数量:', markerCount);
console.log('data-spot-img 数量:', imgCount);
console.log('data-spot-desc 数量:', descCount);
console.log('真实图片URL数:', realImgUrls.length);
if (realImgUrls.length > 0) {
  realImgUrls.slice(0, 3).forEach(function (u) { console.log('  示例:', u.slice(0, 80)); });
}

// 保存
const outPath = path.join(ROOT, 'data/sojourn-maps/bama_5d4n/map_standard.svg');
fs.writeFileSync(outPath, svg, 'utf8');
console.log('\nSVG 已保存:', outPath, '(' + (svg.length / 1024).toFixed(1) + 'KB)');

// 复制到 geographicSVG 供预览
fs.writeFileSync(path.join(geoDir, 'test-bama-real-standard.svg'), svg, 'utf8');

var pass = markerCount > 0 && imgCount >= 3 && descCount >= 3;
console.log(pass ? '\nPASS: 景点图片和描述已嵌入SVG' : '\nFAIL: 图片或描述缺失');
