// 用不同城市和参数搜索金跳动产品
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

// 尝试不同搜索参数
const searches = [
  { tenantId: '042788', productDomain: 'sojourn_route', pageSize: 10 },
  { tenantId: '042788', productDomain: 'sojourn_base', pageSize: 10 },
  { tenantId: '042788', productDomain: 'sojourn_route', destinationCity: '广西', pageSize: 10 },
  { tenantId: '042788', productDomain: 'sojourn_route', destinationCity: '巴马', pageSize: 10 },
  { tenantId: '042788', productDomain: 'sojourn_route', keyword: '康养', pageSize: 10 },
];

for (const q of searches) {
  console.log(`\n--- 搜索: ${JSON.stringify(q)} ---`);
  const r = await client.searchProducts(q);
  console.log('ok:', r.ok, 'source:', r.source_status);
  if (!r.ok) {
    console.log('error:', r.error, 'msg:', r.message);
    continue;
  }
  const data = r.response?.data;
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : Array.isArray(data?.result) ? data.result : [];
  console.log('items count:', items.length);
  if (items.length > 0) {
    const first = items[0];
    console.log('first product:', JSON.stringify(first, null, 2).slice(0, 3000));
    break;
  } else {
    console.log('data keys:', Object.keys(data || {}));
    console.log('data preview:', JSON.stringify(data).slice(0, 500));
  }
}
