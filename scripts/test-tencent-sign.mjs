// 测试腾讯地图签名修复
import TencentMapAdapter from '../src/services/map/tencent-map-adapter.js';
import crypto from 'node:crypto';

// 手动加载 .env
import fs from 'node:fs';
const envRaw = fs.readFileSync(new URL('../.env', import.meta.url), 'utf-8');
for (const line of envRaw.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

console.log('TENCENT_MAP_KEY:', process.env.TENCENT_MAP_KEY);
console.log('TENCENT_MAP_SK:', process.env.TENCENT_MAP_SK?.slice(0, 8) + '...');

const adapter = new TencentMapAdapter();

// 测试1: 地理编码
try {
  console.log('\n--- Test 1: Geocode "防城港" ---');
  const result = await adapter.geocode('防城港');
  console.log('✅ Geocode OK:', result);
} catch (err) {
  console.log('❌ Geocode failed:', err.message);
}

// 测试2: 周边搜索（wellness 补充场景）
try {
  console.log('\n--- Test 2: searchNearby "医院 药店" ---');
  const pois = await adapter.searchNearby('医院 药店', 21.527905, 108.166816, 15000, 5);
  console.log('✅ searchNearby OK:', pois.length, 'POIs');
  if (pois[0]) console.log('  Sample:', pois[0].title, '|', pois[0].address);
} catch (err) {
  console.log('❌ searchNearby failed:', err.message);
}
