// 精确诊断：直接检查渲染后的页面 HTML（不经 buildHtmlFallback 包裹）
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const envText = readFileSync(resolve(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const spots = [
  { name: '百魔洞景区', desc: '巴马著名长寿景点', lat: 24.058, lng: 107.262, source: 'tavily', parent_waypoint: '巴马', parent_day: 'Day2' },
  { name: '水晶宫', desc: '喀斯特溶洞奇观', lat: 24.061, lng: 107.255, source: 'tavily', parent_waypoint: '巴马', parent_day: 'Day2' },
];
const waypoints = [
  { name: '南宁', lat: 22.8170, lng: 108.3669, day: 'Day1', type: 'arrival' },
  { name: '巴马', lat: 24.0544, lng: 107.2583, day: 'Day2', type: 'stay' },
  { name: '北海', lat: 21.4812, lng: 109.1228, day: 'Day3', type: 'departure' },
];

const modelResult = {
  template_id: 'sojourn_route',
  answer_text: '推荐广西巴马三日康养之旅',
  data: {
    routeTitle: '广西巴马三日康养之旅',
    destination: '广西巴马',
    days: '3天2晚',
    season: '四季皆宜',
    budgetLevel: '经济',
    priceLabel: '约1680元/人',
    suitable: '康养老人',
    bookingStatus: '可订',
    summary: '巴马长寿之乡康养体验',
    highlights: ['长寿文化', '天然氧吧'],
    itinerary: [
      { day: 'Day1', plan: '抵达南宁', wp_name: '南宁' },
      { day: 'Day2', plan: '巴马康养', wp_name: '巴马' },
      { day: 'Day3', plan: '返程', wp_name: '北海' },
    ],
    healthNotice: '建议出行前确认身体状况',
    centerLat: 24.0544,
    centerLng: 107.2583,
    centerName: '广西巴马',
    center_json: JSON.stringify({ lat: 24.0544, lng: 107.2583, name: '广西巴马' }),
    map_key: process.env.TENCENT_MAP_JS_KEY || '',
    static_map_url: '',
    markers_json: JSON.stringify(waypoints),
    map_markers: waypoints,
    waypoints_json: JSON.stringify(waypoints),
    waypoints,
    polyline_path: waypoints.map(w => ({ lat: w.lat, lng: w.lng })),
    polyline_path_json: JSON.stringify(waypoints.map(w => ({ lat: w.lat, lng: w.lng }))),
    fit_bounds: { minLat: 21.48, minLng: 107.25, maxLat: 24.05, maxLng: 109.12 },
    fit_bounds_json: JSON.stringify({ minLat: 21.48, minLng: 107.25, maxLat: 24.05, maxLng: 109.12 }),
    route_planning_url: '',
    spots_json: JSON.stringify(spots),
    spots,
    spot_images: [],
    spot_images_json: '[]',
    spot_status: 'real_data',
    hasSpots: true,
  },
};

// 用 renderCard 直接渲染（不走 buildHtmlFallback），拿到原始页面 HTML
const { renderCard } = await import('../src/template-card/index.js');
const templateDir = resolve(root, 'src/skills/travel_route/templates/html');

const card = renderCard(templateDir, {
  template_id: 'sojourn_route',
  data: modelResult.data,
});

const pageHtml = card.pages[0] || '';

console.log('=== renderCard 直接输出 ===');
console.log('templateId:', card.templateId);
console.log('pageHtml 长度:', pageHtml.length);

// 检查关键 JS 变量
const vars = ['var CENTER', 'var _c', 'var WAYPOINTS', 'var SPOTS', 'var POLYLINE_PATH', 'var FIT_BOUNDS'];
for (const v of vars) {
  const found = pageHtml.includes(v);
  console.log(`  ${v}: ${found ? '存在' : '缺失'}`);
}

// 提取 SPOTS 赋值行
const spotsLine = pageHtml.match(/var SPOTS\s*=\s*([^;]+);/);
if (spotsLine) {
  console.log('\nSPOTS 赋值:', spotsLine[0].slice(0, 200));
} else {
  console.log('\n!! SPOTS 赋值行未找到');
}

// 检查 application/json script 标签是否还在
const jsonScripts = pageHtml.match(/<script[^>]*type=["']application\/json["'][^>]*>/gi);
console.log('\napplication/json script 标签:', jsonScripts ? jsonScripts.length + ' 个' : '0 个');

// 检查 spots-section Mustache 渲染
console.log('包含 spot-card:', pageHtml.includes('spot-card'));
console.log('包含 spot-name:', pageHtml.includes('spot-name'));

// 写入文件
const outDir = resolve(root, 'scripts', 'test-output');
const { mkdirSync } = await import('node:fs');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'spots-debug.html'), pageHtml);
console.log('\n已写入 scripts/test-output/spots-debug.html');
