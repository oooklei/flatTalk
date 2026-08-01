// 测试脚本：验证 nearby-augmentor 富化
import fs from 'node:fs';

// 手动加载 .env（模拟 server.js 启动时的 dotenv.config()）
const envRaw = fs.readFileSync(new URL('../.env', import.meta.url), 'utf-8');
for (const line of envRaw.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const { enrich, clearCache } = await import('../src/services/nearby-resource/nearby-augmentor.js');
const { getJialuFacilities, getJialuCenter } = await import('../src/data/jialu_kangyang_center/index.js');

clearCache(); // 清除上次缓存

const f = getJialuFacilities({ type: '', maxDistance: 0, limit: 0 });
const c = getJialuCenter();
console.log('Input:', f.length, 'POIs');
console.log('TENCENT_MAP_KEY:', process.env.TENCENT_MAP_KEY);

const r = await enrich(f, c, 'all');
console.log('Output:', r.facilities.length, 'POIs');
console.log('Stats:', JSON.stringify(r.stats));

const enriched = r.facilities.filter(x => x.enriched_description);
console.log('Enriched POIs:', enriched.length);
if (enriched[0]) {
  console.log('Sample:', enriched[0].name, '|', (enriched[0].enriched_description || '').slice(0, 80));
}

// 检查腾讯补充的POI
const tencent = r.facilities.filter(x => x._source === 'tencent');
if (tencent.length) {
  console.log('\nTencent supplemented:');
  tencent.slice(0, 3).forEach(t => console.log(' ', t.name, '|', t.address));
}
