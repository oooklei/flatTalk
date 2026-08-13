// 列出所有「同一 action_key 被多个语义不同的按钮共用」的情况，作为拆分清单。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'src/skills';
const byAction = new Map(); // action_key -> [{skill, file, label, user_prompt}]

for (const skill of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, skill, 'templates', 'followups');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const b of (j.followup_suggestions || [])) {
      const ak = b.action_key || '(无action_key)';
      if (!byAction.has(ak)) byAction.set(ak, []);
      byAction.get(ak).push({
        skill,
        file: f,
        label: b.label || '',
        prompt: b.user_prompt || '',
      });
    }
  }
}

const lines = [];
lines.push('=== 需要拆分的 action_key（同 key 承载多个不同 label/诉求）===');
let need = 0;
for (const [ak, items] of [...byAction.entries()].sort()) {
  const labels = [...new Set(items.map((i) => i.label))];
  const prompts = [...new Set(items.map((i) => i.prompt))];
  // 判定标准：同一 key 下出现了 2 个以上不同的 label 或 prompt
  if (labels.length > 1 || prompts.length > 1) {
    need += 1;
    lines.push('');
    lines.push(`${ak}   (${items.length} 处引用, ${labels.length} 种label, ${prompts.length} 种诉求)`);
    for (const p of prompts) {
      const who = items.filter((i) => i.prompt === p);
      lines.push(`    诉求: "${p}"`);
      lines.push(`          label=${[...new Set(who.map((i) => i.label))].join(' / ')}`);
      lines.push(`          出现于: ${who.map((i) => i.file).join(', ')}`);
    }
  }
}
lines.push('');
lines.push(`需拆分的 action_key 共 ${need} 个`);

lines.push('');
lines.push('=== 全部 action_key 一览 ===');
for (const [ak, items] of [...byAction.entries()].sort()) {
  lines.push(`  ${ak.padEnd(42)} ${items.length} 处`);
}

fs.writeFileSync('build/action-split-plan.txt', lines.join('\n'), 'utf8');
console.log(`need=${need}`);
