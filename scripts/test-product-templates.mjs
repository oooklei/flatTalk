// 测试产品模板库：验证4类产品匹配 + 生成HTML
import { selectProductTemplate, loadProductSample, generateRouteHtml } from '../src/core/route-svg-generator.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const outDir = path.join(ROOT, 'geographicSVG');
let pass = 0, fail = 0;

console.log('='.repeat(60));
console.log('产品模板库测试');
console.log('='.repeat(60));

// 测试用例：线路描述 → 期望匹配的产品模板ID
const testCases = [
  { name: '巴马5天4晚康养旅居', desc: '负氧离子养生，长寿村探访', expectId: 'route_wellness' },
  { name: '防城港京族滨海3天2晚', desc: '海滩度假，海鲜美食，京族文化', expectId: 'route_coastal' },
  { name: '三江侗族文化深度游', desc: '风雨桥，侗族大歌，非遗手作', expectId: 'route_culture' },
  { name: '崇左德天瀑布生态游', desc: '喀斯特山水，溶洞瀑布，漂流', expectId: 'route_ecology' },
  { name: '某线路无明确关键词', desc: '广西旅游线路', expectId: 'route_wellness' },
];

// 1. 测试模板匹配
console.log('\n--- 1. 产品模板匹配 ---');
for (const tc of testCases) {
  const matched = selectProductTemplate(tc.name, tc.desc);
  const ok = matched && matched.id === tc.expectId;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${tc.name} → ${matched ? matched.id : 'null'} (期望: ${tc.expectId})`);
  if (ok) pass++; else fail++;
}

// 2. 测试示例数据加载
console.log('\n--- 2. 示例数据完整性 ---');
const productIds = ['route_wellness', 'route_coastal', 'route_culture', 'route_ecology'];
for (const pid of productIds) {
  const sample = loadProductSample(pid);
  const checks = {
    'sample 非空': !!sample,
    '含 waypoints': !!sample && Array.isArray(sample.waypoints) && sample.waypoints.length > 0,
    '含 routeTitle': !!sample && !!sample.routeTitle,
    '含 destination': !!sample && !!sample.destination,
    '含 highlights': !!sample && Array.isArray(sample.highlights),
    '含 itinerary': !!sample && Array.isArray(sample.itinerary),
  };
  const allOk = Object.values(checks).every(Boolean);
  console.log(`  ${allOk ? 'PASS' : 'FAIL'}  ${pid} (${sample ? sample.waypoints?.length + ' waypoints' : 'null'})`);
  if (!allOk) {
    for (const [name, ok] of Object.entries(checks)) {
      if (!ok) console.log(`         FAIL: ${name}`);
    }
  }
  if (allOk) pass++; else fail++;
}

// 3. 用每类示例数据生成 HTML
console.log('\n--- 3. 示例数据→HTML生成 ---');
for (const pid of productIds) {
  const sample = loadProductSample(pid);
  if (!sample) { console.log(`  FAIL  ${pid}: 示例数据为空`); fail++; continue; }

  try {
    const result = await generateRouteHtml(sample.routeTitle, sample.summary || '', {
      waypoints: sample.waypoints,
      destination: sample.destination,
      season: sample.season,
      budgetLevel: sample.budgetLevel,
      priceLabel: sample.priceLabel,
      suitable: sample.suitable,
      highlights: sample.highlights,
      itinerary: sample.itinerary,
      healthNotice: sample.healthNotice,
    });

    const outPath = path.join(outDir, `preview-${pid}.html`);
    fs.writeFileSync(outPath, result.html, 'utf8');

    const checks = {
      'html 非空': result.html.length > 500,
      'svg 含 route-marker': result.svg.includes('route-marker'),
      'svg 含 data-spot-desc': result.svg.includes('data-spot-desc'),
      'svg 无 Tavily': !result.svg.toLowerCase().includes('tavily'),
    };
    const allOk = Object.values(checks).every(Boolean);
    console.log(`  ${allOk ? 'PASS' : 'FAIL'}  ${pid} → ${(result.html.length/1024).toFixed(1)}KB HTML, ${(result.svg.length/1024).toFixed(1)}KB SVG`);
    if (allOk) pass++; else { fail++; for (const [n,o] of Object.entries(checks)) if(!o) console.log(`         FAIL: ${n}`); }
  } catch (e) {
    console.log(`  FAIL  ${pid}: ${e.message}`);
    fail++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`总计: ${pass} PASS, ${fail} FAIL`);
console.log('='.repeat(60));
process.exit(fail > 0 ? 1 : 0);
