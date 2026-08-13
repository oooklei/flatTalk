// 验证两处修复：
//   1. followup 短路时按 action_key 选对模板（点「生成一周计划」出 weekly_plan）
//   2. LIS 次意图按钮 label 不再泄漏内部 description
import fs from 'node:fs';
import { humanizeIntentLabel } from '../src/core/lis/matcher.js';

const out = [];

// ── 1. label 清洗单元验证 ──
out.push('=== 1. intent_desc → 按钮文案 清洗 ===');
const SAMPLES = [
  'meal_plan / weekly_plan：一周、七天、周计划、本周',
  'meal_plan / overview：总览、概览',
  'dispatch_manage / dispatch_accept：接单、接、确认接',
  '查看派单列表与工单',
  '养老政策补贴适老化咨询',
  'common / elder_policy_benefit：补贴、津贴、长护险、养老金',
  '',
];
for (const s of SAMPLES) {
  const r = humanizeIntentLabel(s);
  out.push(`  ${JSON.stringify(s).padEnd(52)} -> ${JSON.stringify(r)}`);
}

// ── 2. followup 短路选模板 ──
out.push('');
out.push('=== 2. followup 点击 → 模板 ===');

async function post(path, body) {
  const r = await fetch(`http://127.0.0.1:5298${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try { return { status: r.status, j: JSON.parse(t) }; } catch { return { status: r.status, j: null, t }; }
}

const CASES = [
  ['meal_plan.generate_weekly_plan', '请基于这份膳食建议生成一周三餐计划', 'weekly_plan'],
  ['meal_plan.adjust_for_condition', '请结合老人的健康状况调整这份膳食建议', null],
];

for (const [actionKey, prompt, wantTpl] of CASES) {
  const { status, j } = await post('/api/chat/followup', {
    message: prompt,
    conversation_id: `v-${Date.now()}-${Math.random()}`,
    role: 'elder',
    skill_key: 'meal_plan',
    context: { followup_source: 'card', action_key: actionKey },
  });
  const html = j?.rendered_html || j?.data?.rendered_html || '';
  const weekDays = (html.match(/周[一二三四五六日]/g) || []).length;
  const items = j?.data?.weekly_plan?.items?.length ?? 0;
  const ok = wantTpl ? j?.template_id === wantTpl : true;
  out.push(
    `  ${ok ? 'OK ' : '!! '}${actionKey}`
    + `\n      template_id=${j?.template_id} (want ${wantTpl || '任意'})`
    + `\n      weekly items=${items}  HTML"周X"=${weekDays} 次  http=${status}`,
  );
}

fs.writeFileSync('build/fix-verify.txt', out.join('\n'), 'utf8');
console.log('done');
