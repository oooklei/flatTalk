// 生成真实H5嵌入卡片测试页面（用金跳动真实接口数据）
import { readFileSync, writeFileSync } from 'node:fs';
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

// 1. 搜索真实产品
const searchR = await client.searchProducts({ tenantId: '042788', productDomain: 'sojourn_route', pageSize: 10 });
const items = searchR.response?.data?.list || searchR.response?.data?.items || [];
if (!items.length) { console.log('无产品'); process.exit(1); }
const product = items[0];
const productId = product.productId;

// 2. 可订校验
const availR = await client.checkAvailability({
  productId, checkIn: '2025-03-15', checkOut: '2025-03-20', quantity: 2, productDomain: 'sojourn_route',
});
const avail = availR.response?.data || {};

// 3. 构造H5 URL
const h5Base = 'https://lvjutest.jtdcn.cn/h5';
const h5ProductUrl = `${h5Base}/pages/product/detail?productId=${productId}`;
const h5OrderUrl = `${h5Base}/pages/order/index?productId=${productId}&checkIn=2025-03-15&checkOut=2025-03-20`;

// 4. 填充模板
const { fillTravelH5EmbedCard } = await import('../src/core/model-service.js');
const modelResult = fillTravelH5EmbedCard({
  business_data: {
    jtd: {
      selected_product: {
        product_id: productId,
        product_name: product.productName,
        destination: product.routeProduct?.arrival || '广西',
        price_label: `${product.minPrice}元起`,
        handoff_urls: { h5_product_url: h5ProductUrl, h5_order_url: h5OrderUrl },
      },
      availability: { normalized: { available: avail.available, h5_order_url: h5OrderUrl, h5_product_url: h5ProductUrl } },
      handoff_enabled: true,
    },
  },
});

// 5. 渲染
const { renderCard } = await import('../src/template-card/index.js');
const templateDir = resolve(root, 'src/skills/travel_route/templates/html');
const renderResult = renderCard(templateDir, { templateId: 'travel_h5_embed_card', data: modelResult.data });

// 6. 写文件
const outDir = resolve(root, 'scripts/test-output');
const outFile = resolve(outDir, 'h5-embed-real-test.html');
writeFileSync(outFile, renderResult.pages[0], 'utf8');

console.log('=== 真实H5嵌入卡片测试页面生成完毕 ===');
console.log('productId:', productId);
console.log('productName:', product.productName);
console.log('available:', avail.available, 'stock:', avail.availableStockCount);
console.log('h5ProductUrl:', h5ProductUrl);
console.log('h5OrderUrl:', h5OrderUrl);
console.log('output:', outFile);
console.log('\n打开 http://localhost:8088/h5-embed-real-test.html 查看');
