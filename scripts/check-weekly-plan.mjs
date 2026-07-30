// 常驻校验：一周膳食计划是否真的生成 7 天数据（而非退化成单日 diet_card / 占位串）。
// 用法：npm run check:weekly
import { fillTemplateSlots } from '../src/core/model-service.js';

const library = [
  { id: 'diet_card', match: 'diet meal 膳食 饮食 早餐 午餐 晚餐' },
  { id: 'weekly_plan', match: 'weekly 一周 周计划 膳食' },
  { id: 'route_card', match: 'travel 路线 行程' },
];

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    console.error('  ✗ ' + msg);
    failed += 1;
  }
}

// 1) 含"一周"字样的请求必须命中 weekly_plan 且 7 天
const r1 = await fillTemplateSlots({ message: '帮我做一份一周控糖膳食计划', template_library: library });
assert(r1.template_id === 'weekly_plan', '含"一周"的请求命中 weekly_plan（而非 diet_card）');
const items1 = r1.data?.weekly_plan?.items || [];
assert(Array.isArray(items1) && items1.length === 7, 'weekly_plan 含 7 天（数组）');
assert(items1.every((d) => Array.isArray(d.meals) && d.meals.length === 3), '每天含早/午/晚 3 餐');
assert(items1.every((d) => typeof d.meals[0].foods === 'string' && d.meals[0].foods.length > 0), '餐食为真实文本（非占位串）');

// 2) 直接粘贴"周一…周二…周三"结构化数据也必须命中 weekly_plan，且内容来自用户
const structured = `🗓️
周一
约1200kcal
控糖低盐
🌅
早餐
燕麦粥一碗、水煮蛋一个、凉拌黄瓜少许
约350千卡
☀️
午餐
杂粮饭半碗、清蒸鲈鱼、清炒时蔬、冬瓜汤
约500千卡
🌙
晚餐
小米粥一碗、蒸蛋羹、清炒丝瓜
约400千卡
🗓️
周二
全麦馒头一个、无糖豆浆一杯、煮鸡蛋一个
🗓️
周三
增加豆制品`;
const r2 = await fillTemplateSlots({ message: structured, template_library: library });
assert(r2.template_id === 'weekly_plan', '结构化"周一…周三"粘贴数据命中 weekly_plan（不依赖"一周"二字）');
const mon = (r2.data?.weekly_plan?.items || []).find((d) => d.dayName === '周一');
assert(!!mon && mon.meals.some((m) => m.foods.includes('燕麦粥')), '周一数据来自用户真实输入（燕麦粥）');

if (failed) {
  console.error(`\n一周膳食计划校验未通过（${failed} 项）✗`);
  process.exit(1);
}
console.log('\n一周膳食计划校验通过 ✓');
