// 容器内测试：验证旅居模板渲染输出
import { fillTemplateSlots } from './src/core/model-service.js';

// 模拟 LLM 返回 template_id='travel_base_card' 的场景
const result = await fillTemplateSlots({
  template_id: 'travel_base_card',
  message: '推荐防城港康养基地',
  business_data: {},
});

console.log('=== fillTemplateSlots 返回结果 ===');
console.log('template_id:', result.template_id);
console.log('data keys:', Object.keys(result.data || {}));
console.log('map_key:', result.data?.map_key ? 'YES (' + String(result.data.map_key).slice(0, 15) + '...)' : 'NO');
console.log('centerLat:', result.data?.centerLat);
console.log('centerLng:', result.data?.centerLng);
console.log('centerName:', result.data?.centerName);
console.log('static_map_url:', result.data?.static_map_url ? 'YES (' + String(result.data.static_map_url).slice(0, 60) + '...)' : 'NO (empty)');
console.log('markers count:', result.data?.map_markers?.length || 0);

// 检查 static_map_url 可达性
if (result.data?.static_map_url) {
  try {
    const res = await fetch(result.data.static_map_url);
    const buf = await res.arrayBuffer();
    console.log('\n=== 静态图可达性 ===');
    console.log('HTTP status:', res.status);
    console.log('content-type:', res.headers.get('content-type'));
    console.log('image size:', buf.byteLength, 'bytes');
  } catch (e) {
    console.log('\n=== 静态图请求失败 ===');
    console.log('error:', e.message);
  }
}

// 检查 TMap SDK URL 是否可访问
const mapKey = result.data?.map_key;
if (mapKey) {
  const sdkUrl = 'https://map.qq.com/api/gljs?v=1.exp&key=' + mapKey + '&libraries=visualization';
  try {
    const res = await fetch(sdkUrl);
    console.log('\n=== TMap SDK 可达性 ===');
    console.log('HTTP status:', res.status);
    console.log('content-type:', res.headers.get('content-type'));
    const text = await res.text();
    console.log('SDK script length:', text.length, 'chars');
    console.log('SDK starts with:', text.slice(0, 50));
  } catch (e) {
    console.log('\n=== TMap SDK 请求失败 ===');
    console.log('error:', e.message);
  }
}

process.exit(0);
