// 用真实产品ID测试 productDetail + checkAvailability + 构造H5 URL
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

// 1. 搜索拿到产品
console.log('=== 1. searchProducts ===');
const searchR = await client.searchProducts({ tenantId: '042788', productDomain: 'sojourn_route', pageSize: 10 });
console.log('raw response:', JSON.stringify(searchR.response).slice(0, 800));
const items = searchR.response?.data?.items || searchR.response?.data?.list || [];
console.log('items:', items.length);
if (!items.length) { console.log('无产品'); process.exit(1); }

const product = items[0];
const productId = product.productId;
const productName = product.productName;
console.log('productId:', productId);
console.log('productName:', productName);

// 2. productDetail
console.log('\n=== 2. productDetail ===');
const detailR = await client.productDetail(productId, '', { productDomain: 'sojourn_route' });
console.log('ok:', detailR.ok);
if (detailR.ok) {
  const detail = detailR.response?.data;
  console.log('detail:', JSON.stringify(detail, null, 2).slice(0, 3000));
} else {
  console.log('error:', detailR.error, 'msg:', detailR.message);
  console.log('response:', JSON.stringify(detailR.response || {}).slice(0, 1000));
}

// 3. checkAvailability
console.log('\n=== 3. checkAvailability ===');
const availR = await client.checkAvailability({
  productId,
  skuId: '',
  checkIn: '2025-03-15',
  checkOut: '2025-03-20',
  quantity: 2,
  productDomain: 'sojourn_route',
});
console.log('ok:', availR.ok);
if (availR.ok) {
  console.log('availability:', JSON.stringify(availR.response?.data, null, 2).slice(0, 2000));
} else {
  console.log('error:', availR.error, 'msg:', availR.message);
  console.log('response:', JSON.stringify(availR.response || {}).slice(0, 1000));
}

// 4. 构造 H5 URL（按接口文档 handoff 模板）
console.log('\n=== 4. H5 地址构造（接口文档模板）===');
const h5Base = process.env.JTD_H5_BASE_URL || 'https://lvjutest.jtdcn.cn/h5';
const skuId = product.routeProduct?.skuId || product.skuId || '';
const h5ProductUrl = `${h5Base}/pages/product/detail?productId=${productId}${skuId ? `&skuId=${skuId}` : ''}`;
const h5OrderUrl = `${h5Base}/pages/order/index?productId=${productId}${skuId ? `&skuId=${skuId}` : ''}&checkIn=2025-03-15&checkOut=2025-03-20`;
const h5OrderListUrl = `${h5Base}/pages/order/index`;

console.log('h5Base:', h5Base);
console.log('h5ProductUrl:', h5ProductUrl);
console.log('h5OrderUrl:', h5OrderUrl);
console.log('h5OrderListUrl:', h5OrderListUrl);

// 5. 验证 H5 URL 可访问性
console.log('\n=== 5. H5 URL 可访问性验证 ===');
for (const [name, url] of [['h5ProductUrl', h5ProductUrl], ['h5OrderUrl', h5OrderUrl]]) {
  try {
    const resp = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    console.log(`${name}: HTTP ${resp.status}, Content-Type: ${resp.headers.get('content-type')}`);
    // 检查 X-Frame-Options
    const xfo = resp.headers.get('x-frame-options');
    console.log(`  X-Frame-Options: ${xfo || '未设置（可嵌入iframe）'}`);
  } catch (e) {
    console.log(`${name}: 请求失败 - ${e.message}`);
  }
}
