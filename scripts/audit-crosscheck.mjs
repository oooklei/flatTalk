// 三系统贯通核查：LIS intent_kb ↔ flatTalk 模板/catalog ↔ 规范约束。
// 只读，不修改任何文件。
import fs from 'node:fs';
import path from 'node:path';

const FLAT = path.resolve('.');
const LIS = path.resolve('../LIS-System');

const out = [];
const say = (s = '') => out.push(s);

// ── 1. flatTalk 模板清单 ────────────────────────────────
const templates = new Map();
const skillsDir = path.join(FLAT, 'src/skills');
for (const skill of fs.readdirSync(skillsDir)) {
  const dir = path.join(skillsDir, skill, 'templates/html');
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.manifest.json')) continue;
    const abs = path.join(dir, file);
    const registered = fs.existsSync(abs.replace('.manifest.json', '.html'));
    let m;
    try { m = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
    const id = m.id || path.basename(file, '.manifest.json');
    templates.set(id, {
      skill,
      registered,
      intent_id: m.intent_id || null,
      match: typeof m.match === 'string' ? m.match : null,
      matchKind: m.match === undefined ? 'missing' : typeof m.match,
      idMatchesFile: id === path.basename(file, '.manifest.json'),
    });
  }
}
const registered = [...templates].filter(([, v]) => v.registered);

// ── 2. LIS intent_kb ────────────────────────────────────
const kbRaw = JSON.parse(fs.readFileSync(path.join(LIS, 'data/intent_kb.json'), 'utf8'));
const intents = kbRaw.intents || kbRaw;
const lisByIntent = new Map(intents.map((i) => [i.intent_id, i]));

// ── 3. flatTalk catalog（若存在） ────────────────────────
const catalogCandidates = [
  'src/core/intent-catalog/catalog.json',
  'data/intent-catalog.json',
  'build/intent_kb.seed.json',
  'src/core/scene-router/intent-template-map.json',
];
const catalogs = catalogCandidates
  .map((p) => ({ p, abs: path.join(FLAT, p) }))
  .filter(({ abs }) => fs.existsSync(abs));

say('=== 1. 规模 ===');
say(`flatTalk manifest      : ${templates.size}`);
say(`  registered (has html): ${registered.length}`);
say(`  orphan manifest      : ${templates.size - registered.length}`);
say(`LIS intents            : ${intents.length}`);
say(`catalog files found    : ${catalogs.map((c) => c.p).join(', ') || '(none)'}`);

say('');
say('=== 2. intent_id ↔ template_id 1:1 约束 ===');
const noIntent = registered.filter(([, v]) => !v.intent_id);
say(`模板缺 intent_id        : ${noIntent.length}/${registered.length}`);
if (noIntent.length) {
  const bySkill = {};
  for (const [id, v] of noIntent) (bySkill[v.skill] ??= []).push(id);
  for (const [s, ids] of Object.entries(bySkill)) say(`  ${s}: ${ids.join(', ')}`);
}

const tplByIntent = new Map();
for (const [id, v] of registered) {
  if (!v.intent_id) continue;
  (tplByIntent.get(v.intent_id) ?? tplByIntent.set(v.intent_id, []).get(v.intent_id)).push(id);
}
const intentMultiTpl = [...tplByIntent].filter(([, v]) => v.length > 1);
say(`一个意图绑多个模板      : ${intentMultiTpl.length}`);
for (const [i, ids] of intentMultiTpl) say(`  ${i} -> ${ids.join(', ')}`);

const lisTplCount = new Map();
for (const i of intents) {
  if (!i.template_id) continue;
  lisTplCount.set(i.template_id, (lisTplCount.get(i.template_id) || 0) + 1);
}
const tplMultiIntent = [...lisTplCount].filter(([, c]) => c > 1);
say(`LIS 中一个模板被多意图共用: ${tplMultiIntent.length}`);
for (const [t, c] of tplMultiIntent) {
  const who = intents.filter((i) => i.template_id === t).map((i) => i.intent_id);
  say(`  ${t} <- ${who.join(', ')}  (${c} 个意图)`);
}

say('');
say('=== 3. 跨系统引用完整性 ===');
const lisToMissingTpl = intents.filter((i) => i.template_id && !templates.has(i.template_id));
say(`LIS 指向不存在的模板    : ${lisToMissingTpl.length}`);
for (const i of lisToMissingTpl) say(`  ${i.intent_id} -> ${i.template_id}`);

const lisToOrphanTpl = intents.filter(
  (i) => i.template_id && templates.has(i.template_id) && !templates.get(i.template_id).registered,
);
say(`LIS 指向未注册的模板    : ${lisToOrphanTpl.length}  (manifest 存在但无 .html)`);
for (const i of lisToOrphanTpl) say(`  ${i.intent_id} -> ${i.template_id}`);

const tplIntentNotInLis = [...tplByIntent.keys()].filter((i) => !lisByIntent.has(i));
say(`模板 intent_id 不在 LIS : ${tplIntentNotInLis.length}`);
for (const i of tplIntentNotInLis) say(`  ${i} (模板 ${tplByIntent.get(i).join(', ')})`);

say('');
say('=== 4. LIS 数据质量 ===');
say(`enabled=false           : ${intents.filter((i) => i.enabled === false).length}`);
say(`缺 skill_key            : ${intents.filter((i) => !i.skill_key).length}`);
say(`缺 template_id          : ${intents.filter((i) => !i.template_id).length}`);
say(`缺 anchors 或为空       : ${intents.filter((i) => !(i.anchors || []).length).length}`);
const shortAnchors = intents.flatMap((i) =>
  (i.anchors || [])
    .filter((a) => String(a).length <= 2)
    .map((a) => `${i.intent_id}:"${a}"`),
);
say(`≤2 字锚点（易误命中）   : ${shortAnchors.length}`);
for (const s of shortAnchors) say(`  ${s}`);

say('');
say('=== 5. match 稽核（规范 5.1） ===');
const strMatch = registered.filter(([, v]) => v.matchKind === 'string');
const noPrefix = strMatch.filter(([, v]) => !/^【[^】]+】/.test(v.match));
say(`match=string            : ${strMatch.length}`);
say(`  无【】前缀            : ${noPrefix.length}`);
for (const [id] of noPrefix) say(`    ${id}`);
const prefixMap = new Map();
for (const [id, v] of strMatch) {
  const p = (v.match.match(/^【[^】]+】/) || [''])[0];
  if (!p) continue;
  (prefixMap.get(p) ?? prefixMap.set(p, []).get(p)).push(id);
}
const dupPrefix = [...prefixMap].filter(([, v]) => v.length > 1);
say(`  前缀重复              : ${dupPrefix.length}`);
for (const [p, ids] of dupPrefix) say(`    ${p} -> ${ids.join(', ')}`);

say('');
say('=== 6. 孤儿 manifest（无 .html，不会被注册） ===');
for (const [id, v] of templates) if (!v.registered) say(`  ${v.skill}/${id}`);

fs.writeFileSync(path.join(FLAT, 'build/audit-crosscheck.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));
