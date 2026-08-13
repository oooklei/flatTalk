// 验证修改后的 map-kit.js 和 model-service.js 能正常 import + findPrebuiltPackageByDestination 工作
import { findPrebuiltPackageByDestination } from '../src/core/map/map-kit.js';
import fs from 'node:fs';

console.log('=== 测试 findPrebuiltPackageByDestination ===');
const cases = [
  { dest: '巴马', expect: true },
  { dest: '广西巴马瑶族自治县', expect: true },
  { dest: '防城港', expect: true },
  { dest: '东兴', expect: false }, // 东兴无独立资源包
  { dest: '北海', expect: false }, // 北海无资源包
];
let pass = 0, fail = 0;
for (const c of cases) {
  const pkg = findPrebuiltPackageByDestination(c.dest, 'standard');
  const ok = !!pkg?.svg === c.expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  dest="${c.dest}" found=${!!pkg?.svg} (expect ${c.expect})${pkg?.routeId ? ' routeId=' + pkg.routeId : ''}`);
  if (ok) pass++; else fail++;
  // 验证找到的SVG含真实边界
  if (pkg?.svg && c.expect) {
    const hasBoundary = pkg.svg.includes('district-boundary');
    const hasRealPoly = (pkg.svg.match(/district-boundary[\s\S]*?<path d="([^"]*)"/) || [])[1]?.split(' ').length > 20;
    console.log(`       含行政区边界:${hasBoundary} 非矩形:${!!hasRealPoly}`);
  }
}

// 验证 model-service.js 语法正常（能 import 即可）
console.log('\n=== 验证 model-service.js 可 import ===');
try {
  await import('../src/core/model-service.js');
  console.log('PASS  model-service.js import OK');
  pass++;
} catch (e) {
  console.log('FAIL  model-service.js import error:', e.message);
  fail++;
}

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail > 0 ? 1 : 0);
