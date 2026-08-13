// 测试 getJialuFacilities 是否返回数据
process.env.TENCENT_MAP_JS_KEY = process.env.TENCENT_MAP_JS_KEY || '';
import('./src/data/jialu_kangyang_center/index.js').then(m => {
  const facilities = m.getJialuFacilities({ type: '', maxDistance: 0, limit: 0 });
  console.log('Facilities count:', facilities.length);
  if (facilities.length > 0) {
    console.log('First 3:', JSON.stringify(facilities.slice(0, 3), null, 2));
  }
  const center = m.getJialuCenter();
  console.log('Center:', JSON.stringify(center));
}).catch(e => console.error('Error:', e.message));
