// 核查「多意图 → 1 模板」在各层的真实情况。
//
// 上次只查了 catalog 的 entry.template_id 是否 1:1（结论 86↔86），
// 但那只是**静态绑定**。实际出卡还经过：
//   1. followups 的 template_id 字段
//   2. action_key -> templateIdFromAction 映射
//   3. publish 包 product_template_id
//   4. scene-router 降级
// 任一层出现多对一，用户就会"问不同的事看到同一张卡"。
import fs from 'node:fs';
import path from 'node:path';
import { templateIdFromAction } from '../src/core/actions/action-dispatcher.js';

const lines = [];
const catalog = JSON.parse(fs.readFileSync('config/intent-catalog.json', 'utf8'));

// ── 层 1：catalog 静态绑定 ──
const byTpl = new Map();
for (const i of catalog.intents) {
  const t = i.entry?.template_id || '';
  if (!t) continue;
  if (!byTpl.has(t)) byTpl.set(t, []);
  byTpl.get(t).push(i.intent_id);
}
const dupCatalog = [...byTpl.entries()].filter(([, v]) => v.length > 1);
lines.push('=== 层1: catalog entry.template_id ===');
lines.push(`  意图 ${catalog.intents.length}，模板 ${byTpl.size}，多对一 ${dupCatalog.length}`);
for (const [t, ids] of dupCatalog) lines.push(`    ${t} <- ${ids.join(', ')}`);

// ── 层 2：followups 的 template_id ──
lines.push('');
lines.push('=== 层2: followups JSON 里 action_key -> template_id ===');
const actionToTpl = new Map();
const fuRoot = 'src/skills';
for (const skill of fs.readdirSync(fuRoot)) {
  const dir = path.join(fuRoot, skill, 'templates', 'followups');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const b of (j.followup_suggestions || j.followups || [])) {
      const ak = b.action_key || '';
      if (!ak) continue;
      const derived = templateIdFromAction(ak, {});
      if (!actionToTpl.has(derived)) actionToTpl.set(derived, new Set());
      actionToTpl.get(derived).add(ak);
    }
  }
}
const dupAction = [...actionToTpl.entries()].filter(([, v]) => v.size > 1);
lines.push(`  action_key 去重后映射到 ${actionToTpl.size} 个模板，多对一 ${dupAction.length}`);
for (const [t, aks] of dupAction.sort((a, b) => b[1].size - a[1].size)) {
  lines.push(`    ${t}  <- ${[...aks].join(', ')}`);
}

// ── 层 3：followups 里 user_prompt 相同/相近导致意图无法区分 ──
lines.push('');
lines.push('=== 层3: followups 的 user_prompt 是否够区分 ===');
const prompts = new Map();
for (const skill of fs.readdirSync(fuRoot)) {
  const dir = path.join(fuRoot, skill, 'templates', 'followups');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const b of (j.followup_suggestions || j.followups || [])) {
      const p = String(b.user_prompt || '').trim();
      if (!p) continue;
      if (!prompts.has(p)) prompts.set(p, []);
      prompts.get(p).push(`${f}:${b.action_key || b.label || ''}`);
    }
  }
}
const dupPrompt = [...prompts.entries()].filter(([, v]) => v.length > 1);
lines.push(`  不同按钮共用同一 user_prompt: ${dupPrompt.length} 组`);
for (const [p, where] of dupPrompt.slice(0, 12)) {
  lines.push(`    "${p.slice(0, 40)}"  <- ${where.length} 处: ${where.slice(0, 3).join(' | ')}`);
}

// ── 层 4：无 action_key 的按钮（只能靠 user_prompt 重走意图识别）──
lines.push('');
lines.push('=== 层4: 缺 action_key 的追问按钮（全靠语义重识别）===');
let noAk = 0;
let total = 0;
for (const skill of fs.readdirSync(fuRoot)) {
  const dir = path.join(fuRoot, skill, 'templates', 'followups');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const b of (j.followup_suggestions || j.followups || [])) {
      total += 1;
      if (!b.action_key) noAk += 1;
    }
  }
}
lines.push(`  按钮总数 ${total}，其中无 action_key ${noAk}`);

fs.writeFileSync('build/multi-intent-audit.txt', lines.join('\n'), 'utf8');
console.log('done');

