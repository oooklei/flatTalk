// 检查静态图 URL 返回的实际内容
import { fillTemplateSlots } from './src/core/model-service.js';

const result = await fillTemplateSlots({
  template_id: 'travel_base_card',
  message: '推荐防城港康养基地',
  business_data: {},
});

// 检查静态图 URL 返回内容
if (result.data?.static_map_url) {
  console.log('=== 静态图 URL ===');
  console.log(result.data.static_map_url);
  console.log('\n=== 静态图响应内容 ===');
  try {
    const res = await fetch(result.data.static_map_url);
    console.log('HTTP status:', res.status);
    console.log('content-type:', res.headers.get('content-type'));
    const text = await res.text();
    console.log('response body:', text);
  } catch (e) {
    console.log('error:', e.message);
  }
}

// 检查环境变量
console.log('\n=== 环境变量 ===');
console.log('TENCENT_MAP_JS_KEY:', process.env.TENCENT_MAP_JS_KEY ? process.env.TENCENT_MAP_JS_KEY.slice(0, 10) + '...' : 'NOT SET');
console.log('TENCENT_MAP_KEY:', process.env.TENCENT_MAP_KEY ? process.env.TENCENT_MAP_KEY.slice(0, 10) + '...' : 'NOT SET');
console.log('TENCENT_MAP_SK:', process.env.TENCENT_MAP_SK ? process.env.TENCENT_MAP_SK.slice(0, 10) + '...' : 'NOT SET');

process.exit(0);
