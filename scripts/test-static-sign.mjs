// 调试静态图签名
import crypto from 'node:crypto';
import fs from 'node:fs';

const envRaw = fs.readFileSync(new URL('../.env', import.meta.url), 'utf-8');
for (const line of envRaw.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const wsKey = process.env.TENCENT_MAP_KEY;
const sk = process.env.TENCENT_MAP_SK;

// 测试1: 无markers，最简单
const params1 = { center: '21.527905,108.166816', zoom: '11', size: '600*420', key: wsKey };
const sq1 = Object.keys(params1).sort().map(k => `${k}=${params1[k]}`).join('&');
const raw1 = `/ws/staticmap/v2?${sq1}${sk}`;
const sig1 = crypto.createHash('md5').update(raw1, 'utf8').digest('hex');
const url1 = `https://apis.map.qq.com/ws/staticmap/v2?${sq1}&sig=${sig1}`;

console.log('--- Test 1: no markers ---');
console.log('Sign raw:', raw1.slice(0, 120));
console.log('URL:', url1);

const https = (await import('node:https')).default;
function test(url, label) {
  return new Promise(resolve => {
    https.get(url, r => {
      let d = [];
      r.on('data', c => d.push(c));
      r.on('end', () => {
        const buf = Buffer.concat(d);
        const ct = r.headers['content-type'] || '';
        if (r.statusCode === 200 && ct.includes('image')) {
          console.log(`✅ ${label}: ${buf.length} bytes image`);
        } else {
          console.log(`❌ ${label}: ${r.statusCode} ${buf.toString('utf8').slice(0, 150)}`);
        }
        resolve();
      });
    }).on('error', e => { console.log(`❌ ${label}: ${e.message}`); resolve(); });
  });
}

await test(url1, 'Test1-no-markers');

// 测试2: 带markers但用英文标题
const params2 = { center: '21.527905,108.166816', zoom: '11', size: '600*420', markers: 'coord:21.531,108.172;title:Test1', key: wsKey };
const sq2 = Object.keys(params2).sort().map(k => `${k}=${params2[k]}`).join('&');
const raw2 = `/ws/staticmap/v2?${sq2}${sk}`;
const sig2 = crypto.createHash('md5').update(raw2, 'utf8').digest('hex');
const url2 = `https://apis.map.qq.com/ws/staticmap/v2?${sq2}&sig=${sig2}`;
console.log('\n--- Test 2: english marker ---');
await test(url2, 'Test2-english');

// 测试3: 带中文markers
const params3 = { center: '21.527905,108.166816', zoom: '11', size: '600*420', markers: 'coord:21.531,108.172;title:民宿', key: wsKey };
const sq3 = Object.keys(params3).sort().map(k => `${k}=${params3[k]}`).join('&');
const raw3 = `/ws/staticmap/v2?${sq3}${sk}`;
const sig3 = crypto.createHash('md5').update(raw3, 'utf8').digest('hex');
const url3 = `https://apis.map.qq.com/ws/staticmap/v2?${sq3}&sig=${sig3}`;
console.log('\n--- Test 3: chinese marker ---');
await test(url3, 'Test3-chinese');
