// 验证「1 意图 1 模板」拆分落地效果，含锚点收紧的副作用检查。
import fs from 'node:fs';

const out = [];
let seq = 0;
const cid = () => `t-${process.pid}-${Date.now()}-${seq++}`;

async function followup(prompt, actionKey, skill, prevTpl) {
  const r = await fetch('http://127.0.0.1:5298/api/chat/followup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      conversation_id: cid(),
      role: 'elder',
      skill_key: skill,
      context: { followup_source: 'card', action_key: actionKey, previous_template: prevTpl },
    }),
  });
  const j = await r.json().catch(() => null);
  return { tpl: j?.template_id, intent: j?.intent };
}

async function ask(message) {
  const r = await fetch('http://127.0.0.1:5298/api/chat/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversation_id: cid(), role: 'elder' }),
  });
  const j = await r.json().catch(() => null);
  return { tpl: j?.template_id, intent: j?.intent };
}

// ── 1. 拆分后的追问按钮 ──
out.push('=== 1. 拆分后的追问（同卡两按钮必须出不同卡）===');
const CASES = [
  ['请结合老人的健康状况调整这份膳食建议', 'meal_plan.adjust_for_disease', 'meal_plan', 'diet_breakfast_card', 'diet_condition_card'],
  ['请把这份膳食建议调整为软烂易咀嚼版本', 'meal_plan.adjust_for_texture', 'meal_plan', 'diet_breakfast_card', 'diet_texture_card'],
  ['请按当前预算档测算这条旅居路线费用', 'travel_route.calculate_budget', 'travel_route', 'route_svg', 'travel_budget_card'],
  ['请按经济型预算重新规划这条旅居路线', 'travel_route.replan_by_budget', 'travel_route', 'route_svg', 'route_svg'],
];
let pass = 0;
for (const [p, ak, sk, prev, want] of CASES) {
  const r = await followup(p, ak, sk, prev);
  const ok = r.tpl === want;
  if (ok) pass += 1;
  out.push(`  ${ok ? 'OK ' : '!! '}${ak}`);
  out.push(`      -> ${r.tpl} (want ${want})  intent=${r.intent}`);
}
out.push(`  小结: ${pass}/${CASES.length}`);

// ── 2. 纯话语也要能命中新意图 ──
out.push('');
out.push('=== 2. 纯话语命中质地卡（不依赖 action_key）===');
const UTTS = [
  ['牙口不好吃什么', 'diet_texture_card'],
  ['老人咬不动怎么办', 'diet_texture_card'],
  ['吃饭老呛咳吃什么好', 'diet_texture_card'],
  ['要软烂一点的饭菜', 'diet_texture_card'],
];
let pass2 = 0;
for (const [u, want] of UTTS) {
  const r = await ask(u);
  const ok = r.tpl === want;
  if (ok) pass2 += 1;
  out.push(`  ${ok ? 'OK ' : '!! '}「${u}」-> ${r.tpl} (want ${want})  intent=${r.intent}`);
}
out.push(`  小结: ${pass2}/${UTTS.length}`);

// ── 3. 锚点收紧的副作用：慢病/通用膳食是否还准 ──
out.push('');
out.push('=== 3. 收紧「膳食建议」锚点后的回归 ===');
const REG = [
  ['糖尿病老人吃什么', 'diet_condition_card'],
  ['高血压吃什么好', 'diet_condition_card'],
  ['老人吃什么好', 'diet_card'],
  ['帮我做个食谱', 'diet_card'],
  ['早餐吃什么好', 'diet_breakfast_card'],
  ['午餐吃什么', 'diet_lunch_card'],
  ['晚餐吃什么', 'diet_dinner_card'],
  ['一周三餐计划', 'weekly_plan'],
];
let pass3 = 0;
for (const [u, want] of REG) {
  const r = await ask(u);
  const ok = r.tpl === want;
  if (ok) pass3 += 1;
  out.push(`  ${ok ? 'OK ' : '!! '}「${u}」-> ${r.tpl} (want ${want})`);
}
out.push(`  小结: ${pass3}/${REG.length}`);

out.push('');
out.push(`总计: ${pass + pass2 + pass3}/${CASES.length + UTTS.length + REG.length}`);

fs.writeFileSync('build/split-verify.txt', out.join('\n'), 'utf8');
console.log('done');
