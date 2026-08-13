// 查早餐卡真实产出了几个餐次（不猜，直接打请求看 data.meals）
const r = await fetch('http://127.0.0.1:5298/api/chat/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: '早餐吃什么好',
    conversation_id: `probe-${Date.now()}`,
    role: 'elder',
  }),
});
const j = await r.json();
const meals = j?.data?.meals || j?.card?.data?.meals || [];
const out = [
  `template_id = ${j.template_id}`,
  `intent      = ${j.intent}`,
  `meals 数量  = ${Array.isArray(meals) ? meals.length : '(非数组)'}`,
  `meals 餐次  = ${Array.isArray(meals) ? meals.map((m) => m.mealName || m.name).join(' / ') : ''}`,
  `dateBadge   = ${j?.data?.dateBadge || ''}`,
  `totalCal    = ${j?.data?.totalCal || ''}`,
  '',
  '渲染后 HTML 里出现的餐次字样：',
];
const html = j.rendered_html || j?.data?.rendered_html || '';
for (const k of ['早餐', '午餐', '晚餐']) {
  out.push(`  ${k}: ${(html.match(new RegExp(k, 'g')) || []).length} 次`);
}
const fs = await import('node:fs');
fs.writeFileSync('build/breakfast-probe.txt', out.join('\n'), 'utf8');
console.log('done');
