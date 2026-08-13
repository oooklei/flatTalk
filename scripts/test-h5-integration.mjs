// 旅居主流程整合验证：H5嵌入 + 友好降级
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

const { fillTravelH5EmbedCard } = await import('../src/core/model-service.js');
const { createJtdTravelService } = await import('../src/services/travel/jtd-service.js');
const { createJtdClient } = await import('../src/services/travel/jtd-client.js');
const { renderCard } = await import('../src/template-card/index.js');

// ========== 测试1：真实金跳动产品 → H5嵌入卡片 ==========
console.log('=== 测试1: 真实产品 H5 嵌入 ===');
const client = createJtdClient();
const searchR = await client.searchProducts({ tenantId: '042788', productDomain: 'sojourn_route', pageSize: 10 });
const items = searchR.response?.data?.list || searchR.response?.data?.items || [];

if (items.length > 0) {
  const realProduct = items[0];
  const productId = realProduct.productId;

  // 可订校验
  const availR = await client.checkAvailability({
    productId, checkIn: '2025-03-15', checkOut: '2025-03-20', quantity: 2, productDomain: 'sojourn_route',
  });
  const avail = availR.response?.data || {};

  // 用 normalizeProduct 处理
  const svc = createJtdTravelService({});
  const ctx = await svc.buildRouteProductContext({
    message: `推荐${realProduct.productName}`,
    context: { action_key: 'travel_route.check_availability', check_in: '2025-03-15', check_out: '2025-03-20', people_count: 2 },
  });

  // 如果命中了本地线路，用 mock jtd 测试
  const testJtd = ctx.data_source === 'local_routes' ? {
    data_source: 'real_api',
    selected_product: {
      product_id: productId,
      product_name: realProduct.productName,
      destination: '广西',
      price_label: `${realProduct.minPrice}元起`,
      handoff_urls: {
        h5_product_url: `https://lvjutest.jtdcn.cn/h5/pages/product/detail?productId=${productId}`,
        h5_order_url: avail.available ? `https://lvjutest.jtdcn.cn/h5/pages/order/index?productId=${productId}&checkIn=2025-03-15&checkOut=2025-03-20` : '',
      },
    },
    availability: { normalized: { available: avail.available, h5_order_url: avail.available ? `https://lvjutest.jtdcn.cn/h5/pages/order/index?productId=${productId}` : '', h5_product_url: `https://lvjutest.jtdcn.cn/h5/pages/product/detail?productId=${productId}` } },
    handoff_enabled: avail.available,
  } : ctx;

  const result1 = fillTravelH5EmbedCard({ business_data: { jtd: testJtd } });
  check('template_id 正确', result1.template_id === 'travel_h5_embed_card');
  check('hasH5Url=true', result1.data.hasH5Url === true);
  check('h5Url 非空', !!result1.data.h5Url);
  check('h5Url 含 lvjutest.jtdcn.cn', result1.data.h5Url.includes('lvjutest.jtdcn.cn'), `(${result1.data.h5Url})`);
  check('answer_text 含"加载"', result1.answer_text.includes('加载'));

  // 渲染验证
  const templateDir = resolve(root, 'src/skills/travel_route/templates/html');
  const renderR = renderCard(templateDir, { templateId: 'travel_h5_embed_card', data: result1.data });
  const html = renderR.pages?.[0] || '';
  check('HTML 含 iframe', html.includes('<iframe'));
  check('HTML 含真实 productId', html.includes(productId));
  check('HTML 含产品名', html.includes(realProduct.productName.slice(0, 4)));
  console.log(`  ℹ 真实产品: ${realProduct.productName}, productId=${productId}, available=${avail.available}`);
} else {
  console.log('  ⚠ 无真实产品，跳过');
}

// ========== 测试2：本地线路（防城港5条）→ 友好降级 ==========
console.log('\n=== 测试2: 本地线路降级提示 ===');
const result2 = fillTravelH5EmbedCard({
  business_data: {
    jtd: {
      data_source: 'local_routes',
      selected_product: {
        product_id: 'fcg_route_001',
        product_name: '京族滨海文化线',
        destination: '防城港',
        handoff_urls: {},
      },
    },
  },
});
check('hasH5Url=false', result2.data.hasH5Url === false);
check('isLocalRoute=true', result2.data.isLocalRoute === true);
check('reasonText=官方认证线路', result2.data.reasonText === '官方认证线路');
check('answer_text 含"官方推荐"', result2.answer_text.includes('官方推荐'));
check('answer_text 含"尚未接入"', result2.answer_text.includes('尚未接入在线预订'));

// 渲染降级
const templateDir2 = resolve(root, 'src/skills/travel_route/templates/html');
const renderR2 = renderCard(templateDir2, { templateId: 'travel_h5_embed_card', data: result2.data });
const html2 = renderR2.pages?.[0] || '';
check('HTML 不含 iframe', !html2.includes('<iframe'));
check('HTML 含 no-h5-block', html2.includes('no-h5-block'));
check('HTML 含"官方认证线路"标签', html2.includes('官方认证线路'));
check('HTML 含产品名', html2.includes('京族'));

// ========== 测试3：可订校验未通过 → 降级 ==========
console.log('\n=== 测试3: 不可订降级提示 ===');
const result3 = fillTravelH5EmbedCard({
  business_data: {
    jtd: {
      data_source: 'real_api',
      selected_product: {
        product_id: 'jtd_002',
        product_name: '广西巴马康养三日',
        destination: '广西巴马',
        handoff_urls: {},
      },
      availability: { normalized: { available: false } },
    },
  },
});
check('hasH5Url=false', result3.data.hasH5Url === false);
check('isUnavailable=true', result3.data.isUnavailable === true);
check('reasonText=当前日期不可订', result3.data.reasonText === '当前日期不可订');
check('answer_text 含"更换入住日期"', result3.answer_text.includes('更换入住日期'));

// ========== 测试4：普通产品无URL → 通用降级 ==========
console.log('\n=== 测试4: 通用降级提示 ===');
const result4 = fillTravelH5EmbedCard({
  business_data: {
    jtd: {
      selected_product: {
        product_id: 'jtd_unknown',
        product_name: '某旅居产品',
        destination: '某地',
        handoff_urls: {},
      },
    },
  },
});
check('hasH5Url=false', result4.data.hasH5Url === false);
check('reasonText=暂未开放在线预订', result4.data.reasonText === '暂未开放在线预订');
check('answer_text 含"联系旅居顾问"', result4.answer_text.includes('联系旅居顾问'));

// ========== 测试5：buildRouteProductContext 真实接口 H5 URL ==========
console.log('\n=== 测试5: buildRouteProductContext 真实接口构造 H5 ===');
const svc5 = createJtdTravelService({});
const ctx5 = await svc5.buildRouteProductContext({ message: '推荐旅居线路' });
if (ctx5.data_source === 'real_data' || ctx5.data_source === 'local_kb_cache') {
  const product5 = ctx5.selected_product || {};
  const handoff5 = product5.handoff_urls || {};
  check('product_id 非空', !!product5.product_id);
  check('handoff_urls.h5_product_url 非空', !!handoff5.h5_product_url, `(${handoff5.h5_product_url})`);
  check('h5_product_url 含 lvjutest.jtdcn.cn', handoff5.h5_product_url?.includes('lvjutest.jtdcn.cn'));
  console.log(`  ℹ 产品: ${product5.product_name}, H5: ${handoff5.h5_product_url}`);
} else {
  console.log(`  ℹ data_source=${ctx5.data_source}（本地线路或mock）`);
  check('buildRouteProductContext 正常返回', !!ctx5.selected_product);
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
