// 列出「仅能由 scene-router infer_intent 产出」的意图。
//
// 口径说明（上次报的 78 是粗略统计，这里逐条核实）：
//   LIS 熔断/不可达/LLM_FALLBACK 时，chat-orchestrator 会调 identifyScene，
//   此时意图来源为 ruleSet.infer_intent，无它则退化为 ruleSet.default_intent。
//   因此「只能由 infer_intent 产出」= infer_intent 的 return 分支里出现、
//   且不等于该技能的 default_intent 的意图。
//
// 同时交叉验证：
//   - 该意图是否在 catalog 中（不在 catalog 说明 LIS 侧也不认，属僵尸分支）
//   - 该意图绑定的 template_id（降级后拿不到细分卡，退化成哪张）
import fs from 'node:fs';
import path from 'node:path';

const RULES_DIR = 'src/core/scene-router/rules';
const catalog = JSON.parse(fs.readFileSync('config/intent-catalog.json', 'utf8'));
const catMap = new Map(catalog.intents.map((i) => [i.intent_id, i.entry?.template_id || '']));

const rows = [];
const summary = [];

for (const f of fs.readdirSync(RULES_DIR).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(RULES_DIR, f), 'utf8');
  const sceneKey = src.match(/scene_key:\s*['"]([^'"]+)['"]/)?.[1] || f.replace('.js', '');
  const defaultIntent = src.match(/default_intent:\s*['"]([^'"]+)['"]/)?.[1] || '';

  // 只取 infer_intent 函数体内的 return，避免把别处的字符串误当意图
  const fnIdx = src.indexOf('infer_intent');
  if (fnIdx < 0) {
    summary.push(`${sceneKey}: 无 infer_intent（降级时只能出 ${defaultIntent}）`);
    continue;
  }
  // 从 infer_intent 起到下一个顶层键或文件尾
  const tail = src.slice(fnIdx);
  const endIdx = tail.search(/\n\s{0,2}[a-z_]+:\s|\n\};?\s*$/);
  const body = endIdx > 0 ? tail.slice(0, endIdx) : tail;

  const returns = [...body.matchAll(/return\s+['"]([a-z_]+(?:\.[a-z_]+)?)['"]/g)].map((m) => m[1]);
  const uniq = [...new Set(returns)];
  const onlyByInfer = uniq.filter((i) => i !== defaultIntent);

  summary.push(
    `${sceneKey}  default=${defaultIntent}  infer分支=${uniq.length}  仅靠infer=${onlyByInfer.length}`,
  );
  for (const iid of onlyByInfer) {
    rows.push({
      scene: sceneKey,
      intent: iid,
      inCatalog: catMap.has(iid),
      template: catMap.get(iid) || '(catalog无)',
      fallbackTo: defaultIntent,
      fallbackTemplate: catMap.get(defaultIntent) || '(无)',
    });
  }
}

const inCat = rows.filter((r) => r.inCatalog);
const notInCat = rows.filter((r) => !r.inCatalog);

const out = [
  '# 仅能由 scene-router infer_intent 产出的意图',
  '',
  '## 各技能统计',
  ...summary.map((s) => `  ${s}`),
  '',
  `合计: ${rows.length}（在 catalog 中 ${inCat.length}，不在 catalog ${notInCat.length}）`,
  '',
  '## 在 catalog 中（LIS 降级时真会损失的细分意图）',
  '',
  '| 技能 | 意图 | 正常模板 | 降级后意图 | 降级后模板 |',
  '|---|---|---|---|---|',
  ...inCat.map(
    (r) => `| ${r.scene} | ${r.intent} | ${r.template} | ${r.fallbackTo} | ${r.fallbackTemplate} |`,
  ),
  '',
  '## 不在 catalog（LIS 侧不认，属僵尸分支）',
  ...(notInCat.length
    ? notInCat.map((r) => `  ${r.scene}: ${r.intent}`)
    : ['  （无）']),
];

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/infer-only-intents.md', out.join('\n'), 'utf8');
console.log(`合计=${rows.length} 在catalog=${inCat.length} 不在catalog=${notInCat.length}`);
