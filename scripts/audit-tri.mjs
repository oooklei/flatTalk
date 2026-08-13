// 三方一致性核查：flatTalk config/intent-catalog.json ↔ LIS data/intent_kb.json ↔ 磁盘模板
import fs from 'node:fs';
import path from 'node:path';

const lines = [];
const say = (s = '') => lines.push(String(s));

const catalog = JSON.parse(fs.readFileSync('config/intent-catalog.json', 'utf8'));
const cItems = catalog.intents || [];
const kb = JSON.parse(fs.readFileSync('../LIS-System/data/intent_kb.json', 'utf8'));
const lItems = kb.intents || kb;

// 磁盘模板
const onDisk = new Set();
const skills = 'src/skills';
for (const s of fs.readdirSync(skills)) {
  const d = path.join(skills, s, 'templates/html');
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.html') && !f.endsWith('.preview.html')) {
      onDisk.add(path.basename(f, '.html'));
    }
  }
}

const cIds = new Set(cItems.map((x) => x.intent_id));
const lIds = new Set(lItems.map((x) => x.intent_id));

say('=== 规模 ===');
say(`catalog intents : ${cItems.length}`);
say(`LIS intents     : ${lItems.length}`);
say(`磁盘模板        : ${onDisk.size}`);

say('');
say('=== 意图集合差异 ===');
const onlyCatalog = [...cIds].filter((x) => !lIds.has(x));
const onlyLis = [...lIds].filter((x) => !cIds.has(x));
say(`只在 catalog（LIS 无法路由）: ${onlyCatalog.length}`);
for (const x of onlyCatalog) say(`  ${x}`);
say(`只在 LIS（catalog 无执行入口）: ${onlyLis.length}`);
for (const x of onlyLis) say(`  ${x}`);

say('');
say('=== template_id 漂移 ===');
const drift = [];
for (const x of cItems) {
  const l = lItems.find((y) => y.intent_id === x.intent_id);
  if (l && l.template_id !== x.entry?.template_id) {
    drift.push(`${x.intent_id}: catalog=${x.entry?.template_id} lis=${l.template_id}`);
  }
}
say(`漂移数 : ${drift.length}`);
for (const d of drift) say(`  ${d}`);

say('');
say('=== 指向不存在的模板 ===');
const cMiss = cItems.filter((x) => x.entry?.template_id && !onDisk.has(x.entry.template_id));
say(`catalog -> 缺失模板 : ${cMiss.length}`);
for (const x of cMiss) say(`  ${x.intent_id} -> ${x.entry.template_id}`);
const lMiss = lItems.filter((x) => x.template_id && !onDisk.has(x.template_id));
say(`LIS -> 缺失模板     : ${lMiss.length}`);
for (const x of lMiss) say(`  ${x.intent_id} -> ${x.template_id}`);

say('');
say('=== 模板 1:1 约束 ===');
const cTplCount = new Map();
for (const x of cItems) {
  const t = x.entry?.template_id;
  if (!t) continue;
  cTplCount.set(t, [...(cTplCount.get(t) || []), x.intent_id]);
}
const cShared = [...cTplCount].filter(([, v]) => v.length > 1);
say(`catalog 中被多意图共用 : ${cShared.length}`);
for (const [t, v] of cShared) say(`  ${t} <- ${v.join(', ')}`);

const lTplCount = new Map();
for (const x of lItems) {
  if (!x.template_id) continue;
  lTplCount.set(x.template_id, [...(lTplCount.get(x.template_id) || []), x.intent_id]);
}
const lShared = [...lTplCount].filter(([, v]) => v.length > 1);
say(`LIS 中被多意图共用     : ${lShared.length}`);
for (const [t, v] of lShared) say(`  ${t} <- ${v.join(', ')}`);

say('');
say('=== 未被任何意图引用的模板（孤岛） ===');
const referenced = new Set([...cTplCount.keys(), ...lTplCount.keys()]);
const orphan = [...onDisk].filter((t) => !referenced.has(t));
say(`孤岛模板 : ${orphan.length}`);
for (const t of orphan) say(`  ${t}`);

fs.writeFileSync('build/audit-tri.txt', lines.join('\n'), 'utf8');
console.log(`written build/audit-tri.txt (${lines.length} lines)`);
