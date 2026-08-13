// 测试：预订跳转全链路
// 验证：可订校验通过 → "继续预订"按钮含H5 URL → action-dispatcher返回redirect类型 → 前端可识别
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envText = readFileSync(resolve(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// ========== 测试1：fillTravelAvailabilityCard 注入 handoffUrls ==========
console.log('=== 测试1: fillTravelAvailabilityCard 注入 handoffUrls ===');
const { fillTemplateSlots } = await import('../src/core/model-service.js');

// 模拟有 H5 URL 且可订的场景
const mockJtd = {
  data_source: 'real_api',
  source_status: 'real_data',
  selected_product: {
    product_id: 'jtd_real_001',
    product_name: '京族滨海文化线',
    destination: '防城港',
    handoff_urls: {
      h5_product_url: 'https://ljutest.jtdcn.cn/sojourn/product/jtd_real_001',
      h5_order_url: 'https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001',
    },
  },
  availability: {
    normalized: {
      available: true,
      stock: 10,
      source_status: 'real_data',
      h5_order_url: 'https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001',
      h5_product_url: 'https://ljutest.jtdcn.cn/sojourn/product/jtd_real_001',
    },
  },
  handoff_enabled: true,
};

const result1 = await fillTemplateSlots({
  message: '京族滨海文化线可订吗',
  template_id: 'travel_availability_card',
  business_data: { primary_city: '防城港', jtd: mockJtd },
});
const d1 = result1.data || {};
check('handoffUrls.h5_order_url 有值', !!d1.handoffUrls?.h5_order_url, `(got "${d1.handoffUrls?.h5_order_url}")`);
check('handoffUrls.h5_product_url 有值', !!d1.handoffUrls?.h5_product_url);

// 检查"继续预订"按钮 params 包含 h5_order_url
const bookingAction = (result1.actions || []).find((a) => a.action_key === 'travel_route.booking_handoff');
check('有"继续预订"按钮', !!bookingAction);
check('按钮 params.h5_order_url 有值', !!bookingAction?.params?.h5_order_url, `(got "${bookingAction?.params?.h5_order_url}")`);
check('按钮 params.h5_product_url 有值', !!bookingAction?.params?.h5_product_url);
check('按钮 params.product_id 有值', !!bookingAction?.params?.product_id);

// ========== 测试2：action-dispatcher 返回 redirect 类型 ==========
console.log('\n=== 测试2: dispatchAction 返回 redirect ===');
const { dispatchAction, classifyAction } = await import('../src/core/actions/action-dispatcher.js');

// 模拟 booking_handoff action 请求
const actionResult = await dispatchAction({
  action_key: 'travel_route.booking_handoff',
  params: {
    product_id: 'jtd_real_001',
    destination: '防城港',
    h5_order_url: 'https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001',
    h5_product_url: 'https://ljutest.jtdcn.cn/sojourn/product/jtd_real_001',
  },
}, { runSkill: async () => ({ ok: true }) });

check('classifyAction=client_redirect', classifyAction('travel_route.booking_handoff') === 'client_redirect');
check('result_type=redirect', actionResult.result_type === 'redirect', `(got "${actionResult.result_type}")`);
check('redirect_url 非空', !!actionResult.redirect_url, `(got "${actionResult.redirect_url}")`);
check('redirect_url=h5_order_url', actionResult.redirect_url === 'https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001');
check('redirect_urls 包含两个URL', !!actionResult.redirect_urls?.h5_order_url && !!actionResult.redirect_urls?.h5_product_url);

// ========== 测试3：没有H5 URL时降级为 server_skill ==========
console.log('\n=== 测试3: 无H5 URL时降级 ===');
const fallbackResult = await dispatchAction({
  action_key: 'travel_route.booking_handoff',
  params: { product_id: 'jtd_002', destination: '防城港' },
}, {
  runSkill: async (req) => ({ ok: true, template_id: 'travel_availability_card', answer: '暂无预订入口' }),
});
check('无URL降级为 skill_run', fallbackResult.result_type === 'skill_run', `(got "${fallbackResult.result_type}")`);
check('降级后有 envelope', !!fallbackResult.envelope);

// ========== 测试4：完整流程模拟 ==========
console.log('\n=== 测试4: 完整流程模拟 ===');
// 模拟前端发送的 action 请求
const frontEndPayload = {
  action_key: 'travel_route.booking_handoff',
  params: {
    product_id: 'fcg_route_001',
    destination: '防城港',
    h5_order_url: 'https://ljutest.jtdcn.cn/sojourn/order/fcg_route_001',
    h5_product_url: 'https://ljutest.jtdcn.cn/sojourn/product/fcg_route_001',
  },
};

// 模拟 dispatchAction 处理
const apiResponse = await dispatchAction(frontEndPayload, { runSkill: async () => ({}) });

// 前端判断逻辑
const shouldRedirect = apiResponse.result_type === 'redirect' && apiResponse.redirect_url;
check('前端可识别为 redirect', shouldRedirect);
check('redirect_url 正确', apiResponse.redirect_url === 'https://ljutest.jtdcn.cn/sojourn/order/fcg_route_001');

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
