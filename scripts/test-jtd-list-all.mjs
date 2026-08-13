// 直接调用金跳动真实接口，列出所有旅居产品
// 用法: node scripts/test-jtd-list-all.mjs
import 'dotenv/config';
import { createJtdClient } from '../src/services/travel/jtd-client.js';

const client = createJtdClient({
  baseUrl: process.env.JTD_BASE_URL,
  pathPrefix: process.env.JTD_PATH_PREFIX,
  appId: process.env.JTD_AI_APP_ID,
  appSecret: process.env.JTD_AI_APP_SECRET,
  timeoutMs: Number(process.env.JTD_TIMEOUT_MS || 15000),
});

if (!client.isConfigured()) {
  console.error('[FATAL] JTD client not configured. Check .env: JTD_AI_APP_SECRET=' + (process.env.JTD_AI_APP_SECRET ? '<set>' : '<empty>'));
  process.exit(1);
}

console.log('=== 金跳动接口配置 ===');
console.log('baseUrl:', process.env.JTD_BASE_URL);
console.log('pathPrefix:', process.env.JTD_PATH_PREFIX);
console.log('appId:', process.env.JTD_AI_APP_ID);
console.log('tenantId:', process.env.JTD_TENANT_ID || '042788');
console.log('timeoutMs:', process.env.JTD_TIMEOUT_MS || 15000);
console.log('isConfigured:', client.isConfigured());
console.log('');

// 多种 productDomain / productType 组合试探，找到能返回最多产品的查询方式
const scenarios = [
  { name: 'sojourn_route 旅居线路 pageSize=50', query: { tenantId: process.env.JTD_TENANT_ID || '042788', productDomain: 'sojourn_route', product_type: '旅居线路', pageNum: 1, pageSize: 50 } },
  { name: 'sojourn_base 旅居基地 pageSize=50', query: { tenantId: process.env.JTD_TENANT_ID || '042788', productDomain: 'sojourn_base', product_type: '旅居基地', pageNum: 1, pageSize: 50 } },
  { name: '不限 domain pageSize=100', query: { tenantId: process.env.JTD_TENANT_ID || '042788', pageNum: 1, pageSize: 100 } },
  { name: '空查询 pageSize=100', query: { tenantId: process.env.JTD_TENANT_ID || '042788', pageNum: 1, pageSize: 100, productDomain: '' } },
];

for (const sc of scenarios) {
  console.log(`\n========== ${sc.name} ==========`);
  console.log('request body:', JSON.stringify(sc.query));
  try {
    const t0 = Date.now();
    const res = await client.searchProducts(sc.query);
    const elapsed = Date.now() - t0;
    console.log(`elapsed=${elapsed}ms ok=${res.ok} http=${res.httpStatus} source=${res.source_status} error=${res.error || '-'} business_code=${res.business_code} msg=${res.message || '-'}`);

    // 兼容多种返回结构
    const data = res.response?.data ?? res.response?.result ?? res.response ?? {};
    const records = Array.isArray(data) ? data
      : Array.isArray(data.records) ? data.records
      : Array.isArray(data.list) ? data.list
      : Array.isArray(data.items) ? data.items
      : Array.isArray(data.products) ? data.products
      : [];

    console.log(`返回产品数: ${records.length}`);
    console.log(`total/count 字段:`, {
      total: data.total ?? data.totalCount ?? data.total_count ?? '-',
      count: data.count ?? '-',
      pageNum: data.pageNum ?? data.page ?? '-',
      pageSize: data.pageSize ?? data.size ?? '-',
      pages: data.pages ?? data.totalPages ?? '-',
    });

    if (records.length === 0) {
      console.log('raw response (前 800 字符):', JSON.stringify(res.response).slice(0, 800));
    } else {
      records.forEach((p, i) => {
        const pid = p.product_id || p.productId || p.outProductId || p.id || '-';
        const name = p.product_name || p.productName || p.routeName || p.name || '-';
        const dest = p.destination || p.destinationCity || p.city || p.routeCity || '-';
        const price = p.price_amount ?? p.priceAmount ?? p.price?.amount ?? p.salePrice ?? p.minPrice ?? '-';
        const stock = p.stock ?? p.inventory ?? p.inventoryStock ?? '-';
        console.log(`  [${i + 1}] id=${pid} | name=${name} | dest=${dest} | price=${price} | stock=${stock}`);
      });
    }
  } catch (e) {
    console.error('EXCEPTION:', e.message);
  }
}
