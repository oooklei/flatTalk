// 调金跳动真实接口，查看返回的H5地址
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

const { createJtdClient } = await import('../src/services/travel/jtd-client.js');
const client = createJtdClient();

console.log('=== 金跳动客户端配置 ===');
console.log('configured:', client.isConfigured());

// 1. 搜索产品
console.log('\n=== 1. searchProducts ===');
const searchResult = await client.searchProducts({ city: '防城港', days: 5 });
console.log('ok:', searchResult.ok);
console.log('source_status:', searchResult.source_status);

if (searchResult.ok) {
  const data = searchResult.response?.data;
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : Array.isArray(data?.result) ? data.result : [];
  console.log('items count:', items.length);

  if (items.length > 0) {
    const first = items[0];
    console.log('\n--- 第一条产品原始数据 ---');
    console.log(JSON.stringify(first, null, 2));

    // 找 H5 URL
    console.log('\n--- H5 地址查找 ---');
    console.log('h5_product_url:', first.h5_product_url || first.h5ProductUrl || first.h5Url || first.productUrl || '❌ 无');
    console.log('h5_order_url:', first.h5_order_url || first.h5OrderUrl || first.orderUrl || '❌ 无');
    console.log('mini_program_url:', first.mini_program_url || first.miniProgramUrl || first.miniUrl || '❌ 无');
    console.log('handoff_urls:', JSON.stringify(first.handoff_urls || first.handoffUrls || {}));

    // 2. 查产品详情
    if (first.productId || first.product_id) {
      const productId = first.productId || first.product_id;
      console.log(`\n=== 2. productDetail (productId=${productId}) ===`);
      const detailResult = await client.productDetail({ productId });
      console.log('ok:', detailResult.ok);
      if (detailResult.ok) {
        const detail = detailResult.response?.data;
        console.log('detail:', JSON.stringify(detail, null, 2).slice(0, 3000));
        console.log('\n--- 详情页 H5 地址 ---');
        console.log('h5_product_url:', detail?.h5_product_url || detail?.h5ProductUrl || '❌ 无');
        console.log('h5_order_url:', detail?.h5_order_url || detail?.h5OrderUrl || '❌ 无');
        console.log('handoff_urls:', JSON.stringify(detail?.handoff_urls || detail?.handoffUrls || {}));
      } else {
        console.log('error:', detailResult.error);
        console.log('response:', JSON.stringify(detailResult.response || {}).slice(0, 1000));
      }

      // 3. 查可订状态
      console.log(`\n=== 3. checkAvailability (productId=${productId}) ===`);
      const availResult = await client.checkAvailability({
        productId,
        checkIn: '2025-03-15',
        checkOut: '2025-03-20',
        peopleCount: 2,
      });
      console.log('ok:', availResult.ok);
      if (availResult.ok) {
        const avail = availResult.response?.data;
        console.log('availability:', JSON.stringify(avail, null, 2).slice(0, 2000));
        console.log('\n--- 可订校验 H5 地址 ---');
        console.log('h5_order_url:', avail?.h5_order_url || avail?.h5OrderUrl || avail?.orderUrl || '❌ 无');
        console.log('h5_product_url:', avail?.h5_product_url || avail?.h5ProductUrl || '❌ 无');
        console.log('handoff_urls:', JSON.stringify(avail?.handoff_urls || avail?.handoffUrls || {}));
      } else {
        console.log('error:', availResult.error);
        console.log('response:', JSON.stringify(availResult.response || {}).slice(0, 1000));
      }
    }
  }
} else {
  console.log('error:', searchResult.error);
  console.log('response:', JSON.stringify(searchResult.response || {}).slice(0, 2000));
}

// 也用 jtd-service 的完整链路试一次
console.log('\n\n=== 4. jtd-service.buildRouteProductContext 完整链路 ===');
const { createJtdTravelService } = await import('../src/services/travel/jtd-service.js');
const svc = createJtdTravelService({});
const ctx = await svc.buildRouteProductContext({
  message: '推荐防城港旅居线路',
});
const product = ctx.selected_product || {};
console.log('data_source:', ctx.data_source);
console.log('product_name:', product.product_name);
console.log('product_id:', product.product_id);
console.log('handoff_urls:', JSON.stringify(product.handoff_urls || {}));
const avail = ctx.availability?.normalized || {};
console.log('availability.available:', avail.available);
console.log('availability.h5_order_url:', avail.h5_order_url || '❌ 无');
console.log('availability.h5_product_url:', avail.h5_product_url || '❌ 无');
console.log('availability.handoff_urls:', JSON.stringify(avail.handoff_urls || {}));
