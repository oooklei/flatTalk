/**
 * 测试腾讯地图行政区划 API - 查看返回数据结构
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';

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
    console.log('URL:', url.slice(0, 100) + '...');
    
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse failed`));
        }
      });
    }).on('error', reject);
  });
}

async function test() {
  // 测试：获取广西河池市的区县列表
  console.log('=== 获取河池市区县列表 ===');
  const result = await get('/district/v1/list', {
    id: '451200', // 河池市 adcode
    sub_district: 2, // 只到区县
  });
  
  console.log('Status:', result.status);
  console.log('Message:', result.message);
  
  if (result.status === 0 && result.result?.[0]?.[0]?.districts) {
    const districts = result.result[0][0].districts;
    console.log('找到区县:', districts.length);
    
    // 找巴马
    const bama = districts.find(d => d.name.includes('巴马'));
    if (bama) {
      console.log('\n=== 巴马瑶族自治县 ===');
      console.log('名称:', bama.name);
      console.log('adcode:', bama.adcode);
      console.log('中心点:', bama.location);
      console.log('has polygon:', !!bama.polygon);
      if (bama.polygon) {
        console.log('polygon 长度:', bama.polygon.length);
      }
      
      // 保存完整数据
      fs.writeFileSync('geographicSVG/bama-district-data.json', JSON.stringify(bama, null, 2));
    }
  }
}

test().catch(console.error);