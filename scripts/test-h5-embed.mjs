// 测试：H5 iframe 嵌入模板 + 天气风险按钮（综合）
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

// ========== 测试1：fillTravelH5EmbedCard 有H5 URL ==========
console.log('=== 测试1: H5嵌入模板（有URL）===');
const { fillTravelH5EmbedCard } = await import('../src/core/model-service.js');

const mockJtd = {
  selected_product: {
    product_id: 'jtd_mock_bama_001',
    product_name: '广西巴马康养旅居三日体验',
    destination: '广西巴马',
    price_label: '约1680元/人',
    handoff_urls: {
      h5_product_url: 'https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001',
    },
  },
};
const result1 = fillTravelH5EmbedCard({ business_data: { jtd: mockJtd } });
check('template_id=travel_h5_embed_card', result1.template_id === 'travel_h5_embed_card');
check('h5Url 非空', !!result1.data.h5Url, `(got ${result1.data.h5Url})`);
check('h5Url=h5_product_url', result1.data.h5Url === 'https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001');
check('productName 有值', !!result1.data.productName);
check('destination 有值', !!result1.data.destination);
check('priceLabel 有值', !!result1.data.priceLabel);
check('hasH5Url=true', result1.data.hasH5Url === true);
check('actions 含"在新页面打开"', result1.actions.some(a => a.action_key === 'travel_route.open_h5_external'));

// ========== 测试2：有 h5_order_url 时优先用下单页 ==========
console.log('\n=== 测试2: h5_order_url 优先 ===');
const mockJtd2 = {
  selected_product: {
    product_id: 'jtd_real_001',
    product_name: '京族滨海文化线',
    destination: '防城港',
    handoff_urls: {
      h5_product_url: 'https://example.com/product/001',
      h5_order_url: 'https://example.com/order/001',
    },
  },
  availability: {
    normalized: {
      available: true,
      h5_order_url: 'https://example.com/order/001?date=2025-03',
    },
  },
};
const result2 = fillTravelH5EmbedCard({ business_data: { jtd: mockJtd2 } });
check('h5Url=order_url（最高优先）', result2.data.h5Url === 'https://example.com/order/001?date=2025-03', `(got ${result2.data.h5Url})`);

// ========== 测试3：无H5 URL ==========
console.log('\n=== 测试3: 无H5 URL降级 ===');
const result3 = fillTravelH5EmbedCard({ business_data: { jtd: { selected_product: { product_name: '测试产品' } } } });
check('template_id 仍正确', result3.template_id === 'travel_h5_embed_card');
check('h5Url 为空', !result3.data.h5Url);
check('hasH5Url=false', result3.data.hasH5Url === false);
check('answer_text 含"暂无"', result3.answer_text.includes('暂无'));

// ========== 测试4：action-dispatcher booking_handoff 路由 ==========
console.log('\n=== 测试4: booking_handoff → server_skill ===');
const { dispatchAction, classifyAction } = await import('../src/core/actions/action-dispatcher.js');

check('classifyAction(booking_handoff)=server_skill', classifyAction('travel_route.booking_handoff') === 'server_skill');
check('classifyAction(open_h5_external)=client_redirect', classifyAction('travel_route.open_h5_external') === 'client_redirect');

// booking_handoff 走 server_skill 路径
const actionResult = await dispatchAction({
  action_key: 'travel_route.booking_handoff',
  params: { product_id: 'jtd_mock_bama_001', h5_product_url: 'https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001' },
}, {
  runSkill: async (req) => ({
    template_id: req.template_id,
    answer_text: 'ok',
    data: {},
  }),
});
check('result_type=skill_run', actionResult.result_type === 'skill_run', `(got ${actionResult.result_type})`);
check('runSkill 收到 template_id=travel_h5_embed_card', actionResult.envelope?.template_id === 'travel_h5_embed_card');

// open_h5_external 走 redirect 路径
const extResult = await dispatchAction({
  action_key: 'travel_route.open_h5_external',
  params: { h5_url: 'https://example.com/product/001' },
}, {});
check('open_h5_external result_type=redirect', extResult.result_type === 'redirect', `(got ${extResult.result_type})`);
check('redirect_url 正确', extResult.redirect_url === 'https://example.com/product/001');

// ========== 测试5：模板渲染检查 ==========
console.log('\n=== 测试5: 模板渲染 ===');
const { renderCard } = await import('../src/template-card/index.js');
const { join } = await import('node:path');

const templateDir = resolve(root, 'src/skills/travel_route/templates/html');
const renderResult = renderCard(templateDir, {
  templateId: 'travel_h5_embed_card',
  data: result1.data,
});
check('templateId=travel_h5_embed_card', renderResult.templateId === 'travel_h5_embed_card', `(got ${renderResult.templateId})`);
check('pages 有内容', Array.isArray(renderResult.pages) && renderResult.pages.length > 0);
const html = renderResult.pages?.[0] || '';
check('HTML 含 iframe', html.includes('<iframe'));
check('HTML 含 src=H5 URL', html.includes(result1.data.h5Url));
check('HTML 含 productName', html.includes('广西巴马'));

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
