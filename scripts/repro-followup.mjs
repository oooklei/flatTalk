// 复现「点生成一周计划仍出一日三餐」
// 前端点 followup 按钮有两种可能：走 /api/chat/action（带 action_key）
// 或走 /api/chat/message（把 user_prompt 当新话语）。分别测。
import fs from 'node:fs';

const out = [];

async function post(path, body) {
  const r = await fetch(`http://127.0.0.1:5298${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch {}
  return { status: r.status, j, t };
}

function summarize(tag, status, j) {
  if (!j) return `${tag}: http=${status} (非JSON)`;
  const html = j.rendered_html || j?.data?.rendered_html || '';
  const days = (html.match(/周[一二三四五六日]/g) || []).length;
  const meals = Array.isArray(j?.data?.meals) ? j.data.meals.map((m) => m.mealName).join('/') : '(无meals)';
  const items = Array.isArray(j?.data?.weekly_plan?.items) ? j.data.weekly_plan.items.length : 0;
  return [
    `${tag}`,
    `    http=${status} template_id=${j.template_id} intent=${j.intent}`,
    `    data.meals=${meals}`,
    `    weekly_plan.items=${items}  HTML里"周X"出现=${days} 次`,
  ].join('\n');
}

// 路径 A：走 message，把 user_prompt 当新话语（followups 的标准用法）
{
  const { status, j } = await post('/api/chat/message', {
    message: '请基于这份膳食建议生成一周三餐计划',
    conversation_id: `a-${Date.now()}`,
    role: 'elder',
  });
  out.push(summarize('A. /api/chat/message + user_prompt', status, j));
}

// 路径 B：走 action，带 action_key（dispatcher 直接锁模板）
{
  const { status, j } = await post('/api/chat/action', {
    action_key: 'meal_plan.generate_weekly_plan',
    conversation_id: `b-${Date.now()}`,
    role: 'elder',
    params: {},
  });
  out.push(summarize('B. /api/chat/action + action_key', status, j));
}

// 路径 C：走 followup 端点
{
  const { status, j } = await post('/api/chat/followup', {
    message: '请基于这份膳食建议生成一周三餐计划',
    action_key: 'meal_plan.generate_weekly_plan',
    conversation_id: `c-${Date.now()}`,
    role: 'elder',
  });
  out.push(summarize('C. /api/chat/followup + 两者都带', status, j));
}

fs.writeFileSync('build/followup-repro.txt', out.join('\n\n'), 'utf8');
console.log('done');
