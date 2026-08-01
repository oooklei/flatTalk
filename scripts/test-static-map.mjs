// 测试静态图 URL 生成
import crypto from 'node:crypto';
import fs from 'node:fs';

// 加载 .env
const envRaw = fs.readFileSync(new URL('../.env', import.meta.url), 'utf-8');
for (const line of envRaw.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const wsKey = process.env.TENCENT_MAP_KEY || '';
const sk = process.env.TENCENT_MAP_SK || '';
console.log('WebService Key:', wsKey);
console.log('SK:', sk ? sk.slice(0,8)+'...' : '(empty)');

const center = { lat: 21.527905, lng: 108.166816 };
const markers = [
  { lat: 21.531, lng: 108.172, name: '海岸民宿' },
  { lat: 21.524, lng: 108.160, name: '海鲜排档' },
];

// 生成静态图 URL
const params = {
  center: `${center.lat},${center.lng}`,
  zoom: 11,
  size: '600*420',
  markers: markers.map(m => `coord:${m.lat},${m.lng};title:${m.name}`).join('|'),
};
const signParams = { ...params, key: wsKey };
const sortedQuery = Object.keys(signParams).sort().map(k => `${k}=${signParams[k]}`).join('&');
let url = `https://apis.map.qq.com/ws/staticmap/v2?${sortedQuery}`;
if (sk) {
  const sig = crypto.createHash('md5').update(`/ws/staticmap/v2?${sortedQuery}${sk}`, 'utf8').digest('hex');
  url += '&sig=' + sig;
}
console.log('\nStatic Map URL:');
console.log(url);
console.log('\nURL length:', url.length, 'chars');
