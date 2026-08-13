// 诊断 fillTemplateSlots 完整返回值
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

const { fillTemplateSlots } = await import('../src/core/model-service.js');

// 测试1: 传 template_id='sojourn_route'
console.log('=== 测试1: template_id=sojourn_route ===');
const r1 = fillTemplateSlots({
  message: '推荐广西巴马三日康养旅居路线',
  template_id: 'sojourn_route',
  business_data: { primary_city: '广西巴马' },
});
console.log('完整返回:', JSON.stringify(r1, null, 2).slice(0, 800));

// 测试2: 传 template_id='route_card'
console.log('\n=== 测试2: template_id=route_card ===');
const r2 = fillTemplateSlots({
  message: '推荐广西巴马三日康养旅居路线',
  template_id: 'route_card',
  business_data: { primary_city: '广西巴马' },
});
console.log('template_id:', r2.template_id);
console.log('data 字段数:', Object.keys(r2.data || {}).length);

// 测试3: 不传 template_id，只传 template_library
console.log('\n=== 测试3: template_library 方式 ===');
const r3 = fillTemplateSlots({
  message: '推荐广西巴马三日康养旅居路线',
  template_library: [{ id: 'sojourn_route', match: '旅居 路线 康养' }],
  business_data: { primary_city: '广西巴马' },
});
console.log('template_id:', r3.template_id);
console.log('data 字段数:', Object.keys(r3.data || {}).length);
