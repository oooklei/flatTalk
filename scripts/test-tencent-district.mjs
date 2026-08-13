/**
 * 测试腾讯地图行政区划 API
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import https from 'node:https';

const KEY = process.env.TENCENT_MAP_KEY || '';
const SK = process.env.TENCENT_MAP_SK || '';

function sign(endpoint, params) {
  if (!SK) return '';
  const signParams = { ...params, key: KEY };
  delete signParams.sig;
  
  const sortedQuery = Object.keys(signParams)
    .sort()
    .map(k => `${k}=${signParams[k]}`)
    .join('&');
  
  const raw = `/ws${endpoint}?${sortedQuery}${SK}`;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
}

function get(endpoint, params) {
  return new Promise((resolve, reject) => {
    const sig = sign(endpoint, params);
    const qs = new URLSearchParams({ ...params, key: KEY, sig }).toString();
    const url = `https://apis.map.qq.com/ws${endpoint}?${qs}`;
    console.log('URL:', url);
    
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

async function test() {
  console.log('KEY:', KEY ? 'SET' : 'NOT SET');
  console.log('SK:', SK ? 'SET' : 'NOT SET');
  
  // 测试 1：获取广西壮族自治区的区县列表
  console.log('\n=== 测试 1: 获取广西区县列表 ===');
  const result1 = await get('/district/v1/list', {
    id: '450000',
    sub_district: 3,
  });
  console.log('Status:', result1.status);
  if (result1.result?.[0]?.[0]?.districts) {
    const districts = result1.result[0][0].districts;
    console.log('找到区县:', districts.length);
    const bama = districts.find(d => d.name.includes('巴马'));
    if (bama) {
      console.log('巴马:', bama.name, 'adcode:', bama.adcode);
    }
  }
  
  // 测试 2：直接搜索巴马县
  console.log('\n=== 测试 2: 搜索巴马瑶族自治县 ===');
  const result2 = await get('/district/v1/list', {
    keywords: '巴马瑶族自治县',
  });
  console.log('Status:', result2.status);
  console.log('Result:', JSON.stringify(result2, null, 2).slice(0, 500));
}

test().catch(console.error);