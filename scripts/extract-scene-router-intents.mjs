#!/usr/bin/env node
/**
 * 从 scene-router 规则集提取全量意图 → 生成迁移物料。
 *
 * 一次性迁移脚本，已执行完毕（产出 build/intent-migration.json，
 * 再由 generate-intent-registry.mjs 转成 config/intent-catalog.json
 * 与 LIS IntentKB 种子）。
 *
 * 注意：它依赖的 src/core/scene-router/intent-template-map.js 已被删除
 * （那是第二份 intent→template 映射表，已统一到 config/intent-catalog.json）。
 * 保留本文件仅作迁移过程留档，重跑需改为读取 config/intent-catalog.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES_DIR = path.join(ROOT, 'src', 'core', 'scene-router', 'rules');

// 原先从 intent-template-map.js 读取；该文件已删除。
// 改为从 catalog 反推 skill → {intent: template} 结构，保持脚本可重跑。
const catalogForMap = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'config', 'intent-catalog.json'), 'utf8'),
);
const INTENT_TEMPLATE_MAP = {};
for (const it of catalogForMap.intents || []) {
  const skill = it.entry?.skill_key || '';
  if (!skill) continue;
  INTENT_TEMPLATE_MAP[skill] = INTENT_TEMPLATE_MAP[skill] || {};
  INTENT_TEMPLATE_MAP[skill][it.intent_id] = it.entry?.template_id || '';
}

/** 解析单个规则文件里的 infer_intent 分支，得到 intent -> [关键词] */
function parseInferIntent(src) {
  const out = {};
  // 取 infer_intent( 之后到该函数结束。原先用 /\n\s{2}\},?\n/ 作终止符匹配失败
  // （文件实际以 "  },\n};" 收尾），导致提取结果全为空。改为花括号配平扫描。
  const start = src.search(/infer_intent\s*\(\s*input\s*\)\s*\{/);
  if (start < 0) return out;
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return out;
  const body = src.slice(open + 1, end);

  // 形如：if (has(input, ['a','b'])) return 'intent_id';
  const inline = /if\s*\(\s*has\(\s*input\s*,\s*\[([^\]]*)\]\s*\)\s*\)\s*return\s*'([^']+)'/g;
  let m;
  while ((m = inline.exec(body))) {
    const terms = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const intent = m[2];
    (out[intent] = out[intent] || []).push(...terms);
  }

  // 形如：if (has(input, someTermsConst)) return 'intent_id';
  const byConst = /if\s*\(\s*has\(\s*input\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*\)\s*return\s*'([^']+)'/g;
  while ((m = byConst.exec(body))) {
    const constName = m[1];
    const intent = m[2];
    const decl = src.match(
      new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\];`),
    );
    if (decl) {
      const terms = [...decl[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      (out[intent] = out[intent] || []).push(...terms);
    }
  }

  // 兜底 default_intent
  const di = src.match(/default_intent:\s*'([^']+)'/);
  if (di && !out[di[1]]) out[di[1]] = [];
  return out;
}

const skills = {};
for (const f of fs.readdirSync(RULES_DIR)) {
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(RULES_DIR, f), 'utf8');
  const sceneKey = src.match(/scene_key:\s*'([^']+)'/)?.[1];
  if (!sceneKey) continue;
  skills[sceneKey] = {
    file: f,
    default_intent: src.match(/default_intent:\s*'([^']+)'/)?.[1] || '',
    intents: parseInferIntent(src),
  };
}

// 汇总：intent -> { skill_key, template_id, anchors }
const merged = {};
for (const [sceneKey, info] of Object.entries(skills)) {
  const tmap = INTENT_TEMPLATE_MAP[sceneKey] || {};
  for (const [intent, terms] of Object.entries(info.intents)) {
    const tpl = tmap[intent] || tmap.default || '';
    merged[intent] = {
      skill_key: sceneKey,
      template_id: tpl,
      template_from_default: !tmap[intent] && Boolean(tmap.default),
      anchors: [...new Set(terms)],
      is_scene_default: intent === info.default_intent,
    };
  }
}

// 把 map 里存在、但 infer_intent 没产出的意图也纳入（避免漏）
for (const [sceneKey, tmap] of Object.entries(INTENT_TEMPLATE_MAP)) {
  for (const [intent, tpl] of Object.entries(tmap)) {
    if (intent === 'default') continue;
    if (!merged[intent]) {
      merged[intent] = {
        skill_key: sceneKey,
        template_id: tpl,
        template_from_default: false,
        anchors: [],
        is_scene_default: false,
        note: 'map 中存在但 infer_intent 未产出（可能是孤儿或由别处触发）',
      };
    }
  }
}

const outPath = path.join(ROOT, 'build', 'intent-migration.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), skills: Object.keys(skills), intents: merged }, null, 2), 'utf8');

const noAnchor = Object.entries(merged).filter(([, v]) => v.anchors.length === 0);
const noTpl = Object.entries(merged).filter(([, v]) => !v.template_id);
const lines = [
  `规则文件数        : ${Object.keys(skills).length}`,
  `提取意图总数      : ${Object.keys(merged).length}`,
  `有种子锚点        : ${Object.keys(merged).length - noAnchor.length}`,
  `无锚点(需人工补)  : ${noAnchor.length}`,
  `无模板(需登记)    : ${noTpl.length}`,
  '',
  '无锚点意图:',
  ...noAnchor.map(([k, v]) => `  ${k}  (${v.skill_key})${v.note ? ' ' + v.note : ''}`),
  '',
  '无模板意图:',
  ...noTpl.map(([k, v]) => `  ${k}  (${v.skill_key})`),
];
fs.writeFileSync(path.join(ROOT, 'build', 'intent-migration-report.txt'), lines.join('\n'), 'utf8');
console.log('written build/intent-migration.json');
