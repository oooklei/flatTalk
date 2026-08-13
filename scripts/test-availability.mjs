// 测试：点"检查可订状态"按钮时，金跳动 checkAvailability 接口被调用
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

const { createJtdTravelService } = await import('../src/services/travel/jtd-service.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// ========== 测试1：普通查询 → 本地线路命中，不调 checkAvailability ==========
console.log('=== 测试1: 普通查询不调可订接口 ===');
const svc1 = createJtdTravelService({});
const ctx1 = await svc1.buildRouteProductContext({
  message: '推荐防城港京族滨海文化线',
});
check('命中本地线路', ctx1.data_source === 'local_routes');
check('selected_product 非空', !!ctx1.selected_product);
check('availability 为 null（未触发可订查询）', !ctx1.availability || ctx1.availability === null || Object.keys(ctx1.availability || {}).length === 0, `(got ${JSON.stringify(ctx1.availability?.normalized || 'null').slice(0, 60)})`);

// ========== 测试2：点"检查可订状态"按钮 → 触发 checkAvailability ==========
console.log('\n=== 测试2: check_availability 动作触发金跳动接口 ===');
const svc2 = createJtdTravelService({});
const ctx2 = await svc2.buildRouteProductContext({
  message: '推荐防城港京族滨海文化线',
  context: {
    action_key: 'travel_route.check_availability',
    check_in: '2025-03-01',
    check_out: '2025-03-05',
    people_count: 2,
  },
});
check('命中本地线路', ctx2.data_source === 'local_routes');
check('product_id 非空（传给 checkAvailability）', !!ctx2.selected_product?.product_id, `(got ${ctx2.selected_product?.product_id})`);
check('availability 已填充', !!ctx2.availability, `(availability=${JSON.stringify(ctx2.availability?.normalized || {}).slice(0, 80)})`);
check('calls 包含 checkAvailability', Array.isArray(ctx2.calls) && ctx2.calls.some((c) => c.endpoint === 'checkAvailability' || c.endpoint?.includes('vailability')), `(calls=${JSON.stringify(ctx2.calls).slice(0, 100)})`);

// 如果金跳动配置完整，availability.normalized 应该有值
const normalized = ctx2.availability?.normalized;
if (normalized) {
  check('normalized.available 是布尔', typeof normalized.available === 'boolean');
  check('normalized.source_status 有值', !!normalized.source_status);
  console.log(`  ℹ 可订校验结果: available=${normalized.available}, stock=${normalized.stock ?? 'null'}, status=${normalized.source_status}`);
} else {
  console.log('  ℹ 金跳动未配置或不可达，availability 为接口返回的 unavailable');
}

// ========== 测试3：用户消息含"可订"关键词 → 也触发 ==========
console.log('\n=== 测试3: 消息含"可订"关键词自动触发 ===');
const svc3 = createJtdTravelService({});
const ctx3 = await svc3.buildRouteProductContext({
  message: '京族滨海文化线最近可订吗？还有余量吗？',
});
check('命中本地线路', ctx3.data_source === 'local_routes');
check('availability 已填充', !!ctx3.availability);

// ========== 测试4：fillTravelAvailabilityCard 使用带 availability 的 jtd ==========
console.log('\n=== 测试4: fillTravelAvailabilityCard 消费 availability ===');
const { fillTemplateSlots } = await import('../src/core/model-service.js');
const result4 = await fillTemplateSlots({
  message: '京族滨海文化线是否可订',
  template_id: 'travel_availability_card',
  business_data: {
    primary_city: '防城港',
    jtd: ctx2,  // 用上面带 availability 的 context
  },
});
const d4 = result4.data || {};
check('template_id=travel_availability_card', result4.template_id === 'travel_availability_card');
check('availabilityStatus 非空', !!d4.availabilityStatus, `(got "${d4.availabilityStatus}")`);
check('availabilityLevel 非空', !!d4.availabilityLevel, `(got "${d4.availabilityLevel}")`);
check('productName 包含线路名', d4.productName?.includes('京族') || d4.destination?.includes('防城港'));
check('productId 有值', !!d4.productId);

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
