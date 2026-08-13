import https from 'node:https';

// 测试不同路径
const urls = [
  'https://geo.datav.aliyun.com/areas_v3/bound/451227.json',
  'https://geo.datav.aliyun.com/areas_v3/bound/451200.json', // 河池市
  'https://geo.datav.aliyun.com/areas_v3/bound/450000.json', // 广西
];

for (const url of urls) {
  console.log('\n=== Testing:', url);
  https.get(url, res => {
    console.log('Status:', res.statusCode);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        try {
          const json = JSON.parse(data);
          console.log('Type:', json.type);
          console.log('Features:', json.features?.length || 0);
        } catch (e) {
          console.log('Parse error, first 200:', data.slice(0, 200));
        }
      } else {
        console.log('Error:', data.slice(0, 200));
      }
    });
  }).on('error', e => console.error('Error:', e.message));
}