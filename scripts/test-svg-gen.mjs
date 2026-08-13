// 端到端测试：用真实巴马边界GeoJSON + 真实景点数据，生成完整SVG
import { generateSvg } from '../src/admin/mapstudio.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/GuiCare/flatTalk';
const geoDir = path.join(ROOT, 'geographicSVG');

// 1. 加载真实巴马行政区边界（MultiPolygon, 750点）
function loadRealBoundary() {
  const geojson = JSON.parse(fs.readFileSync(path.join(geoDir, 'bama_boundary.geojson'), 'utf8'));
  const geom = geojson.features[0].geometry;
  const polygons = [];
  if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (Array.isArray(poly) && poly.length > 0) {
        const ring = poly[0];
        const pts = ring.map(function (pt) { return { lat: pt[1], lng: pt[0] }; });
        polygons.push(pts);
      }
    }
  }
  return polygons;
}

// 2. 加载真实景点数据
function loadRealSpots() {
  const data = JSON.parse(fs.readFileSync(path.join(geoDir, 'bama-spots-data.json'), 'utf8'));
  const spots = data.spots;
  // 构造 waypoints：起点 → 景点们 → 返程
  const waypoints = [];
  // Day1 起点：巴马县城（命河附近作为县城代表）
  waypoints.push({
    name: '巴马县城', lat: 24.12, lng: 107.25, type: 'base', day: 'Day1', plan: '抵达巴马，入住康养基地',
  });
  // Day2 百魔洞
  const bm = spots.find((s) => s.name === '百魔洞');
  waypoints.push({ name: bm.name, lat: bm.coordinates[0], lng: bm.coordinates[1], type: 'spot', day: 'Day2', plan: '溶洞观光', spot_desc: bm.spot_desc, spot_images: bm.spot_images });
  // Day3 长寿村（康养）
  const cs = spots.find((s) => s.name === '长寿村');
  waypoints.push({ name: cs.name, lat: cs.coordinates[0], lng: cs.coordinates[1], type: 'wellness', day: 'Day3', plan: '康养体验', spot_desc: cs.spot_desc, spot_images: cs.spot_images });
  // Day4 水晶宫
  const sj = spots.find((s) => s.name === '水晶宫');
  waypoints.push({ name: sj.name, lat: sj.coordinates[0], lng: sj.coordinates[1], type: 'spot', day: 'Day4', plan: '溶洞奇观', spot_desc: sj.spot_desc, spot_images: sj.spot_images });
  // Day5 赐福湖
  const cf = spots.find((s) => s.name === '赐福湖');
  waypoints.push({ name: cf.name, lat: cf.coordinates[0], lng: cf.coordinates[1], type: 'spot', day: 'Day5上午', plan: '湖畔康养', spot_desc: cf.spot_desc, spot_images: cf.spot_images });
  // Day5 返程
  waypoints.push({ name: '巴马县城', lat: 24.12, lng: 107.25, type: 'departure', day: 'Day5', plan: '返程' });
  return waypoints;
}

const boundary = loadRealBoundary();
const waypoints = loadRealSpots();

console.log('真实边界 polygons 数:', boundary.length, '总点数:', boundary.reduce((a, p) => a + p.length, 0));
console.log('景点 waypoints 数:', waypoints.length);
console.log('含图片的景点数:', waypoints.filter((w) => w.spot_images && w.spot_images.length).length);

// 3. 生成标准版 + 适老版
const svgStd = generateSvg(waypoints, 'bama_5d4n', '巴马5天4晚康养旅居', 'standard', '', boundary);
const svgEld = generateSvg(waypoints, 'bama_5d4n', '巴马5天4晚康养旅居', 'elder', '', boundary);

// 4. 验证清单
const checks = {
  'viewBox 620x850': svgStd.includes('viewBox="0 0 620 850"'),
  '无光栅底图 <image>': !svgStd.includes('<image'),
  '有行政区边界(district-boundary)': svgStd.includes('district-boundary'),
  '边界path非矩形(点数多)': (svgStd.match(/district-boundary[\s\S]*?<path d="([^"]*)"/) || [])[1]?.split(' ').length > 20,
  '有河流装饰(rivers)': svgStd.includes('class="rivers"'),
  '有山脉装饰(mountains)': svgStd.includes('class="mountains"'),
  '前进段橙色#FF7826': svgStd.includes('#FF7826'),
  '返程段蓝色#1976D2': svgStd.includes('#1976D2'),
  '有route-marker交互标点': svgStd.includes('class="route-marker"'),
  '有data-spot-img景点图': svgStd.includes('data-spot-img'),
  '有data-spot-desc景点描述': svgStd.includes('data-spot-desc'),
  '无Tavily字样': !svgStd.toLowerCase().includes('tavily'),
  '无"数据来源"字样': !svgStd.includes('数据来源'),
  '有图例(起点/途经/康养/返程)': svgStd.includes('起点') && svgStd.includes('返程') && svgStd.includes('康养'),
  '有康养特色栏': svgStd.includes('康养特色'),
  '适老版字体放大': svgEld.includes('font-size="28"') || svgEld.includes('font-size="26"'),
};

let pass = 0, fail = 0;
console.log('\n=== 验证清单 ===');
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) pass++; else fail++;
}

// 5. 保存预览
const outStd = path.join(geoDir, 'test-bama-real-standard.svg');
const outEld = path.join(geoDir, 'test-bama-real-elder.svg');
fs.writeFileSync(outStd, svgStd, 'utf8');
fs.writeFileSync(outEld, svgEld, 'utf8');

console.log(`\n${pass}/${pass + fail} checks passed.`);
console.log(`标准版 SVG: ${(svgStd.length / 1024).toFixed(1)}KB -> ${outStd}`);
console.log(`适老版 SVG: ${(svgEld.length / 1024).toFixed(1)}KB -> ${outEld}`);
process.exit(fail > 0 ? 1 : 0);
