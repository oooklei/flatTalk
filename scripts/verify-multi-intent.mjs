// 验证「多意图 → 1 模板」是否已按意图差异化。
//
// 关键用例：同一个 action_key（meal_plan.adjust_for_condition）
// 承载两个不同诉求，必须出不同的卡：
//   「按健康状况调整」-> 慢病调整类
//   「换成软烂版」    -> 质地调整类
// 以及 B 方案：消歧选项是否带回原意图。
import fs from 'node:fs';

const out = [];

async function post(path, body) {
  const r = await fetch(`http://127.0.0.1:5298${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try { return { status: r.status, j: JSON.parse(t) }; } catch { return { status: r.status, j: null, t }; }
}

let seq = 0;
const cid = () => `mi-${process.pid}-${Date.now()}-${seq++}`;

// ── 1. 同 action_key、不同 user_prompt ──
out.push('=== 1. 同 action_key 不同诉求（应出不同卡）===');
const SAME_ACTION = [
  ['请结合老人的健康状况调整这份膳食建议', 'meal_plan.adjust_for_condition'],
  ['请把这份膳食建议调整为软烂易咀嚼版本', 'meal_plan.adjust_for_condition'],
];
const gotTpls = [];
for (const [prompt, ak] of SAME_ACTION) {
  const { j } = await post('/api/chat/followup', {
    message: prompt,
    conversation_id: cid(),
    role: 'elder',
    skill_key: 'meal_plan',
    context: { followup_source: 'card', action_key: ak, previous_template: 'diet_breakfast_card' },
  });
  gotTpls.push(j?.template_id || '');
  out.push(`  「${prompt.slice(0, 18)}…」-> ${j?.template_id}  intent=${j?.intent}`);
}
out.push(`  结论: ${gotTpls[0] !== gotTpls[1] ? 'OK 已差异化' : '!! 仍是同一张卡'}`);

// ── 2. travel_route 的 calculate_budget vs compare ──
out.push('');
out.push('=== 2. travel_route 同 action_key 不同诉求 ===');
const TRAVEL = [
  ['请按当前预算档测算这条旅居路线费用', 'travel_route.calculate_budget'],
  ['请按经济型预算重新规划这条旅居路线', 'travel_route.calculate_budget'],
];
const tTpls = [];
for (const [prompt, ak] of TRAVEL) {
  const { j } = await post('/api/chat/followup', {
    message: prompt,
    conversation_id: cid(),
    role: 'elder',
    skill_key: 'travel_route',
    context: { followup_source: 'card', action_key: ak, previous_template: 'route_svg' },
  });
  tTpls.push(j?.template_id || '');
  out.push(`  「${prompt.slice(0, 18)}…」-> ${j?.template_id}  intent=${j?.intent}`);
}
out.push(`  结论: ${tTpls[0] !== tTpls[1] ? 'OK 已差异化' : '!! 仍是同一张卡'}`);

// ── 3. B方案：消歧选项是否带回意图 ──
out.push('');
out.push('=== 3. 方案B 消歧选项携带意图 ===');
{
  const { j } = await post('/api/chat/message', {
    message: '巴马这条线路要多少钱',
    conversation_id: cid(),
    role: 'elder',
  });
  const opts = j?.ambiguity_options || j?.data?.publish_ambiguous || [];
  out.push(`  template_id=${j?.template_id} intent=${j?.intent} 选项数=${opts.length}`);
  if (opts.length) {
    const o = opts[0];
    out.push(`  选项[0]: route_id=${o.route_id}`);
    out.push(`           pending_intent_id=${o.pending_intent_id || '(缺)'}`);
    out.push(`           pending_template_id=${o.pending_template_id || '(缺)'}`);
    const ok = Boolean(o.pending_template_id);
    out.push(`  结论: ${ok ? 'OK 已携带' : '!! 未携带，回程会丢意图'}`);

    // ── 4. 模拟用户点选，验证回程出预算卡 ──
    out.push('');
    out.push('=== 4. 方案B 回程（点选线路后应出预算卡）===');
    const { j: j2 } = await post('/api/chat/message', {
      message: o.label || o.route_id,
      conversation_id: cid(),
      role: 'elder',
      context: {
        publish_route_id: o.route_id,
        pending_intent_id: o.pending_intent_id,
        pending_template_id: o.pending_template_id,
      },
    });
    const ok2 = j2?.template_id === 'travel_budget_card';
    out.push(`  ${ok2 ? 'OK ' : '!! '}点选后 template_id=${j2?.template_id} (want travel_budget_card)`);
    out.push(`      intent=${j2?.intent}`);
  } else {
    out.push('  (未触发消歧，无法验证回程)');
  }
}

fs.writeFileSync('build/multi-intent-verify.txt', out.join('\n'), 'utf8');
console.log('done');
