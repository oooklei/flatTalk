// 完整流程测试：JtdTravelService.buildRouteProductContext + LLM 补字段
// 用法: node scripts/test-jtd-llm-inference.mjs
import 'dotenv/config';
import { createJtdTravelService } from '../src/services/travel/jtd-service.js';

const service = createJtdTravelService({
  mode: process.env.JTD_API_MODE || 'auto',
  baseUrl: process.env.JTD_BASE_URL,
  pathPrefix: process.env.JTD_PATH_PREFIX,
  appId: process.env.JTD_AI_APP_ID,
  appSecret: process.env.JTD_AI_APP_SECRET,
  timeoutMs: Number(process.env.JTD_TIMEOUT_MS || 15000),
});

console.log('=== JtdTravelService 配置 ===');
console.log('mode:', service.mode, 'configured:', service.configured);
console.log('');

// 测试场景：用产品名无法提取地名的产品，验证 LLM 补字段
const scenarios = [
  { name: '0730测试产品', message: '帮我规划0730测试旅居路线5天4日游' },
  { name: '自在港湾基地', message: '帮我预订自在港湾旅居基地' },
  { name: '健康旅居7天', message: '帮我看看健康旅居7天优品产品' },
  { name: '七洞乡线路(有地名)', message: '帮我规划七洞乡线路产品旅居路线' },
];

for (const sc of scenarios) {
  console.log(`\n========== ${sc.name} ==========`);
  console.log('message:', sc.message);
  try {
    const t0 = Date.now();
    const ctx = await service.buildRouteProductContext({ message: sc.message });
    const elapsed = Date.now() - t0;
    console.log(`elapsed=${elapsed}ms data_source=${ctx.data_source} source_status=${ctx.source_status}`);
    console.log('product_domain:', ctx.product_domain);
    console.log('products count:', ctx.products.length);
    const sp = ctx.selected_product;
    if (sp) {
      console.log('selected_product:');
      console.log('  product_id:', sp.product_id);
      console.log('  product_name:', sp.product_name);
      console.log('  destination:', sp.destination, sp.llm_inferred ? '(LLM推理)' : '(接口/兜底)');
      console.log('  price_label:', sp.price_label);
    } else {
      console.log('selected_product: null');
    }
  } catch (e) {
    console.error('EXCEPTION:', e.message);
  }
}
