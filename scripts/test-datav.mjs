import https from 'node:https';

// 测试阿里云 DataV GeoJSON
const url = 'https://geo.datav.aliyun.com/areas_v3/bound/451227_full.json';

https.get(url, res => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
  
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Data (first 500 chars):', data.slice(0, 500));
  });
}).on('error', e => console.error('Error:', e.message));