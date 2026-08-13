// 诊断 Tavily 景点图层：分步检查数据流
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 加载 .env
const envText = readFileSync(resolve(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// Step 1: 直接测 searchCategory
console.log('=== Step 1: 测试 Tavily searchCategory ===');
const { searchCategory } = await import('../src/services/nearby-resource/tavily-nearby-adapter.js');
try {
  const r = await searchCategory('spot', { name: '广西巴马 巴马', lat: 24.0544, lng: 107.2583 }, 5000);
  console.log('source_status:', r?.source_status);
  console.log('source_results 数量:', (r?.source_results || []).length);
  console.log('images 数量:', (r?.images || []).length);
  if (r?.source_results?.[0]) {
    console.log('第一条景点:', JSON.stringify(r.source_results[0]).slice(0, 200));
  }
} catch (e) {
  console.log('Tavily 调用失败:', e.message);
}

// Step 2: 测 enrichWaypointsWithSpots
console.log('\n=== Step 2: 测试 enrichWaypointsWithSpots ===');
const jtdServiceModule = await import('../src/services/travel/jtd-service.js');
// enrichWaypointsWithSpots 不是 export 的，测 buildWaypointsForProduct 也不是
// 直接构造 waypoints 模拟
const testWaypoints = [
  { name: '巴马', lat: 24.0544, lng: 107.2583, day: 'Day1', type: 'stay', plan: '康养体验' },
  { name: '百魔洞', lat: 24.0900, lng: 107.2700, day: 'Day2', type: 'visit', plan: '景点游览' },
];
// 手动调用 Tavily 模拟 enrich
const enriched = await Promise.all(testWaypoints.map(async (wp) => {
  try {
    const center = { name: `广西巴马 ${wp.name}`, lat: wp.lat, lng: wp.lng };
    const result = await searchCategory('spot', center, 5000);
    const spots = (result?.source_results || []).slice(0, 3).map((item, i) => ({
      name: item.title || `景点${i + 1}`,
      desc: String(item.content || '').slice(0, 100),
      lat: Number((wp.lat + (Math.random() - 0.5) * 0.015).toFixed(6)),
      lng: Number((wp.lng + (Math.random() - 0.5) * 0.015).toFixed(6)),
      source: 'tavily',
    }));
    return { ...wp, spots };
  } catch (e) { return { ...wp, spots: [], error: e.message }; }
}));
const allSpots = enriched.flatMap(wp => wp.spots.map(s => ({ ...s, parent_waypoint: wp.name, parent_day: wp.day })));
console.log('enriched waypoints:', enriched.length);
console.log('allSpots 数量:', allSpots.length);
console.log('allSpots 样例:', JSON.stringify(allSpots[0] || '无').slice(0, 200));

// Step 3: 检查模板中的 spots_json 注入
console.log('\n=== Step 3: 模拟模板注入 ===');
const spotsJson = JSON.stringify(allSpots);
console.log('spots_json 长度:', spotsJson.length);
console.log('spots_json 前100字符:', spotsJson.slice(0, 100));

// Step 4: 检查模板文件中 spots 相关标签
console.log('\n=== Step 4: 检查模板 Mustache 标签 ===');
const tpl = readFileSync(resolve(root, 'src/skills/travel_route/templates/html/sojourn_route.html'), 'utf8');
const tags = ['spots_json', '{{#spots}}', '{{/spots}}', '{{#hasSpots}}', '{{/hasSpots}}', 'route-spots'];
for (const t of tags) {
  const found = tpl.includes(t);
  console.log(`  ${t}: ${found ? '存在' : '缺失'}`);
}

console.log('\n=== 诊断完成 ===');
