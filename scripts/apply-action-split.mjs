// 按 user_prompt 精确改写 followups 的 action_key，实现 1 意图 1 模板。
//
// 只改 user_prompt 完全匹配的条目，避免误伤同 action_key 的其他按钮。
// 同时统一 check_availability 的 label 文案（原来"查可订状态"/"检查可订"并存）。
import fs from 'node:fs';
import path from 'node:path';

const RULES = [
  // 膳食：疾病维度 vs 质地维度
  { prompt: '请结合老人的健康状况调整这份膳食建议', to: 'meal_plan.adjust_for_disease', label: '按慢病调整' },
  { prompt: '请按老人的健康状况调整这份一周膳食计划', to: 'meal_plan.adjust_for_disease', label: '按慢病调整' },
  { prompt: '请把这份膳食建议调整为软烂易咀嚼版本', to: 'meal_plan.adjust_for_texture', label: '换成软烂版' },
  // 旅居：算钱 vs 重规划
  { prompt: '请按当前预算档测算这条旅居路线费用', to: 'travel_route.calculate_budget', label: '测算预算' },
  { prompt: '请按经济型预算重新规划这条旅居路线', to: 'travel_route.replan_by_budget', label: '调整预算' },
  // 文案统一（action_key 不变）
  { prompt: '请检查这条旅居路线近期是否可预订', to: 'travel_route.check_availability', label: '查可订状态' },
];

const ROOT = 'src/skills';
const changed = [];
let hit = 0;

for (const skill of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, skill, 'templates', 'followups');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = path.join(dir, f);
    const raw = fs.readFileSync(p, 'utf8');
    let j;
    try { j = JSON.parse(raw); } catch { continue; }
    let dirty = false;
    for (const b of (j.followup_suggestions || [])) {
      const rule = RULES.find((r) => r.prompt === String(b.user_prompt || '').trim());
      if (!rule) continue;
      if (b.action_key !== rule.to || b.label !== rule.label) {
        changed.push(`${skill}/${f}: "${b.label}" ${b.action_key} -> ${rule.to} (label: ${rule.label})`);
        b.action_key = rule.to;
        b.label = rule.label;
        dirty = true;
        hit += 1;
      }
    }
    if (dirty) fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`, 'utf8');
  }
}

fs.writeFileSync('build/action-split-applied.txt', `改写 ${hit} 条\n\n${changed.join('\n')}\n`, 'utf8');
console.log(`changed=${hit}`);
