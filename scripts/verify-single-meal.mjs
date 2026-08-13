// 验证单餐卡只渲染对应餐次
import fs from 'node:fs';

const CASES = [
  ['早餐吃什么好', 'diet_breakfast_card', '早餐'],
  ['午餐吃什么好', 'diet_lunch_card', '午餐'],
  ['晚餐吃什么好', 'diet_dinner_card', '晚餐'],
  ['今天三餐怎么安排', 'diet_card', null], // 对照组：全天卡应保留三餐
];

const lines = [];
let ok = 0;

for (const [msg, wantTpl, onlyMeal] of CASES) {
  const r = await fetch('http://127.0.0.1:5298/api/chat/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, conversation_id: `m-${Date.now()}-${Math.random()}`, role: 'elder' }),
  });
  const j = await r.json();
  const html = j.rendered_html || j?.data?.rendered_html || '';
  const counts = {};
  for (const k of ['早餐', '午餐', '晚餐']) {
    counts[k] = (html.match(new RegExp(k, 'g')) || []).length;
  }
  const meals = j?.data?.meals;
  const mealNames = Array.isArray(meals) ? meals.map((m) => m.mealName).join('/') : '(无)';

  let pass;
  if (onlyMeal) {
    // 单餐卡：只应出现目标餐次；其他两餐计数为 0
    const others = ['早餐', '午餐', '晚餐'].filter((k) => k !== onlyMeal);
    pass = j.template_id === wantTpl && counts[onlyMeal] > 0 && others.every((k) => counts[k] === 0);
  } else {
    pass = j.template_id === wantTpl && counts['早餐'] > 0 && counts['午餐'] > 0;
  }
  if (pass) ok += 1;
  lines.push(
    `${pass ? 'OK ' : '!! '}${msg}  tpl=${j.template_id} (want ${wantTpl})`
    + `\n     HTML 餐次计数: 早=${counts['早餐']} 午=${counts['午餐']} 晚=${counts['晚餐']}`
    + `\n     data.meals: ${mealNames}`,
  );
}

lines.push('');
lines.push(`通过 ${ok}/${CASES.length}`);
fs.writeFileSync('build/meal-verify.txt', lines.join('\n'), 'utf8');
console.log(`pass=${ok}/${CASES.length}`);
