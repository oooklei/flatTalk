#!/usr/bin/env node
/**
 * 由 build/intent-migration.json 生成两份产物：
 *   1. config/intent-catalog.json      —— flatTalk 网关注册表（全量意图，强制 1:1）
 *   2. build/intent_kb.seed.json       —— LIS IntentKB 种子（意图 + 锚点 + template_id）
 *
 * 迁移目标：废除 scene-router 这个第二意图识别器，让 LIS 成为唯一分拣入口。
 *
 * 保留原 catalog 里 9 条人工维护的 intent_desc / examples / match_hints，
 * 不能被自动生成内容覆盖 —— 那是人写的语义描述，质量高于关键词拼接。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'build', 'intent-migration.json'), 'utf8'),
);
const catalogPath = path.join(ROOT, 'config', 'intent-catalog.json');
const existing = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

/** 已有条目按 intent_id 索引，用于保留人工维护字段 */
const prev = new Map(existing.intents.map((i) => [i.intent_id, i]));

/** 真孤儿：无任何识别器产出，也无按钮触发，直接排除 */
const ORPHANS = new Set(['travel_route_booking_handoff', 'travel_route_need_summary']);

/**
 * 强制 1:1 覆盖表：原先多个意图共用一张卡，语义上是错配
 * （如 diet_card 声明"一日三餐完整"，却被"早餐吃什么"命中）。
 * 拆出的独立模板由 scripts/split-shared-templates.mjs 生成。
 */
const TEMPLATE_OVERRIDE = {
  meal_plan_breakfast_advice: 'diet_breakfast_card',
  meal_plan_lunch_advice: 'diet_lunch_card',
  meal_plan_dinner_advice: 'diet_dinner_card',
  meal_plan_condition_advice: 'diet_condition_card',
  'nearby_resource.medical': 'nearby_medical_card',
  'nearby_resource.shop': 'nearby_shop_card',
  'nearby_resource.transit': 'nearby_transit_card',
  'nearby_resource.leisure': 'nearby_leisure_card',
  travel_route_budget: 'travel_budget_card',
  travel_route_compare: 'route_compare_card',
  travel_route_query: 'route_detail_card',
  elder_assistant_usage: 'assistant_usage_card',
  'health_risk_warning.manual_review': 'health_manual_review_card',
  elder_policy_benefit: 'policy_benefit_card',
};

/** 由 intent_id 推导可读描述（仅在无人工描述时使用） */
function deriveDesc(intentId, skillKey, anchors) {
  const tail = intentId.includes('.') ? intentId.split('.').pop() : intentId.replace(`${skillKey}_`, '');
  const kw = anchors.slice(0, 4).join('、');
  return kw ? `${skillKey} / ${tail}：${kw}` : `${skillKey} / ${tail}`;
}

const intents = [];
const kbSeed = [];
const skipped = [];

for (const [intentId, v] of Object.entries(migration.intents)) {
  if (ORPHANS.has(intentId)) { skipped.push(intentId); continue; }
  const templateId = TEMPLATE_OVERRIDE[intentId] || v.template_id;
  if (!templateId) { skipped.push(`${intentId} (无模板)`); continue; }

  const old = prev.get(intentId);
  const entry = {
    intent_id: intentId,
    intent_desc: old?.intent_desc || deriveDesc(intentId, v.skill_key, v.anchors),
    examples: old?.examples || v.anchors.slice(0, 3),
    tags: old?.tags || [v.skill_key],
    entry: {
      kind: 'template',
      skill_key: v.skill_key,
      template_id: templateId,
    },
    enabled: old?.enabled !== false,
  };
  if (old?.match_hints) entry.match_hints = old.match_hints;
  else if (v.anchors.length) entry.match_hints = { keywords: v.anchors.slice(0, 12) };
  intents.push(entry);

  // IntentKB 种子：description 也参与向量匹配，所以用可读描述而非 id
  kbSeed.push({
    intent_id: intentId,
    description: entry.intent_desc,
    skill_key: v.skill_key,
    template_id: templateId,
    anchors: v.anchors,
  });
}

intents.sort((a, b) => a.intent_id.localeCompare(b.intent_id));
kbSeed.sort((a, b) => a.intent_id.localeCompare(b.intent_id));

fs.writeFileSync(
  catalogPath,
  `${JSON.stringify(
    {
      catalog_version: '1.0.0',
      updated_at: new Date().toISOString(),
      _note:
        '生产配置，非示例。intent_id → entry.template_id 强制 1:1。'
        + '由 scripts/generate-intent-registry.mjs 从 scene-router 规则迁移生成，'
        + '人工维护的 intent_desc/examples/match_hints 会被保留。'
        + 'LIS IntentKB 是意图与锚点的权威源，本文件是 flatTalk 侧的执行入口映射。',
      intents,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

fs.writeFileSync(
  path.join(ROOT, 'build', 'intent_kb.seed.json'),
  `${JSON.stringify({ generated_at: new Date().toISOString(), intents: kbSeed }, null, 2)}\n`,
  'utf8',
);

const anchorTotal = kbSeed.reduce((a, b) => a + b.anchors.length, 0);
const noAnchor = kbSeed.filter((k) => k.anchors.length === 0).map((k) => k.intent_id);
const report = [
  `catalog 条目数    : ${intents.length}`,
  `IntentKB 种子数   : ${kbSeed.length}`,
  `锚点总数          : ${anchorTotal}`,
  `无锚点(靠description匹配): ${noAnchor.length}`,
  ...noAnchor.map((i) => `    ${i}`),
  `已排除            : ${skipped.length}`,
  ...skipped.map((i) => `    ${i}`),
  '',
  '1:1 校验:',
];
const byTpl = {};
for (const i of intents) (byTpl[i.entry.template_id] = byTpl[i.entry.template_id] || []).push(i.intent_id);
const dup = Object.entries(byTpl).filter(([, v]) => v.length > 1);
report.push(`  被多个意图共用的模板: ${dup.length}`);
for (const [t, v] of dup) report.push(`    ${t} <- ${v.join(', ')}`);
fs.writeFileSync(path.join(ROOT, 'build', 'registry-report.txt'), report.join('\n'), 'utf8');
console.log('written config/intent-catalog.json + build/intent_kb.seed.json');
