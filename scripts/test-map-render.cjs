// 容器内测试：验证 fillTravelBaseCard 注入的 map_key 是否正确传递到模板渲染
const ms = require('./src/core/model-service.js');
const tcr = require('./src/core/render/template-card-renderer.js');

// 1. 调用 fillTravelBaseCard 获取数据
const result = ms.fillTravelBaseCard({ message: '推荐防城港康养基地', business_data: {} });
console.log('=== fillTravelBaseCard 返回的 data 字段 ===');
console.log('map_key:', result.data?.map_key ? 'YES (' + result.data.map_key.slice(0, 10) + '...)' : 'NO');
console.log('centerLat:', result.data?.centerLat);
console.log('centerLng:', result.data?.centerLng);
console.log('centerName:', result.data?.centerName);
console.log('static_map_url:', result.data?.static_map_url ? 'YES (' + result.data.static_map_url.slice(0, 60) + '...)' : 'NO (empty)');
console.log('markers_json:', result.data?.markers_json ? 'YES' : 'NO');
console.log('center_json:', result.data?.center_json ? 'YES' : 'NO');

// 2. 调用 renderTemplateCardResult 渲染模板
const renderFn = tcr.renderTemplateCardResult || tcr.renderTemplate || tcr.default;
const html = renderFn ? renderFn(result, '') : JSON.stringify(Object.keys(tcr));
console.log('\n=== 渲染后的 HTML 检查 ===');
console.log('html length:', html.length);
console.log('contains map-section:', html.includes('map-section') ? 'YES' : 'NO');
console.log('contains baseMapCanvas:', html.includes('baseMapCanvas') ? 'YES' : 'NO');
console.log('contains baseSvgFallback:', html.includes('baseSvgFallback') ? 'YES' : 'NO');

// 3. 检查 Mustache 占位符是否被替换
const literalMapKey = html.includes("'{{map_key}}'");
const replacedMapKey = html.includes("'KI4BZ-") || html.includes("'YOUR_TENCENT");
console.log('\n=== Mustache 替换检查 ===');
console.log('map_key still literal {{map_key}}:', literalMapKey ? 'YES (BUG!)' : 'NO (replaced)');
console.log('map_key replaced with actual key:', replacedMapKey ? 'YES' : 'NO');

// 4. 提取 MAP_KEY 的实际值
const match = html.match(/var MAP_KEY = '([^']*)'/);
console.log('actual MAP_KEY in HTML:', match ? match[1].slice(0, 20) + '...' : 'NOT FOUND');

// 5. 检查 static_map_url 是否被替换
const urlMatch = html.match(/var STATIC_MAP_URL = '([^']*)'/);
console.log('actual STATIC_MAP_URL in HTML:', urlMatch ? (urlMatch[1].slice(0, 60) + '...' || '(empty)') : 'NOT FOUND');

// 6. 检查 iframe sandbox
const sandboxMatch = html.match(/sandbox="([^"]*)"/);
console.log('iframe sandbox:', sandboxMatch ? sandboxMatch[1] : 'NOT FOUND');

// 7. 检查 static_map_url 是否可访问
if (result.data?.static_map_url) {
  const https = require('https');
  const url = result.data.static_map_url;
  console.log('\n=== 静态图 URL 可达性检查 ===');
  console.log('URL:', url.slice(0, 80) + '...');
  https.get(url, (res) => {
    console.log('HTTP status:', res.statusCode);
    console.log('content-type:', res.headers['content-type']);
    let size = 0;
    res.on('data', (chunk) => { size += chunk.length; });
    res.on('end', () => { console.log('image size:', size, 'bytes'); process.exit(0); });
  }).on('error', (e) => { console.log('request error:', e.message); process.exit(0); });
} else {
  console.log('\n=== 静态图 URL 为空，无法测试 ===');
  process.exit(0);
}
