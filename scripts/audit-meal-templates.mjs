// 审计 meal_plan 各模板示例数据的餐次，找出「单餐卡却带全天」的问题。
import fs from 'node:fs';
import path from 'node:path';

const dir = 'src/skills/meal_plan/templates/html';
const out = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const h = fs.readFileSync(path.join(dir, f), 'utf8');
  const j = h.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
  let names = '(无示例数据)';
  if (j) {
    try {
      const d = JSON.parse(j[1]);
      names = Array.isArray(d.meals)
        ? (d.meals.map((m) => m.mealName).join(' / ') || '(meals为空)')
        : '(无 meals 字段)';
    } catch { names = '(JSON 解析失败)'; }
  }
  // 单餐卡（名字里带 breakfast/lunch/dinner）却出现多个餐次 = 问题
  const single = /breakfast|lunch|dinner/.test(f);
  const count = names.split(' / ').filter((s) => /餐/.test(s)).length;
  const flag = single && count > 1 ? '  <== 单餐卡带了多餐' : '';
  out.push(`${f.padEnd(34)} meals: ${names}${flag}`);
}
fs.writeFileSync('build/meal-templates.txt', out.join('\n'), 'utf8');
console.log('done');
