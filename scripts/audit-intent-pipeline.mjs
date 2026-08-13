#!/usr/bin/env node
/**
 * 语料→意图→锚点→模板 全链路一致性核对。
 *
 * 权威源：config/intent-catalog.json（intent_id → entry.template_id，强制 1:1），
 * 与 LIS IntentKB 同源。原 src/core/scene-router/intent-template-map.js 是
 * **第二份**映射表，已删除 —— 两份表分属不同文件、无统一事务，改一处漏一处
 * 就会静默断链，且它允许多个意图共用一张卡，违反 1:1。
 *
 * 用法：
 *   node scripts/audit-intent-pipeline.mjs              # 仅静态文件核对
 *   node scripts/audit-intent-pipeline.mjs --live       # 额外查运行中的服务
 *
 * 退出码：0 全部通过；1 存在断链
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');
const LIS_BASE = process.env.LIS_BASE_URL || 'http://127.0.0.1:8100';

const problems = [];
const notes = [];

// ── 1. catalog ────────────────────────────────────────────
const catalogPath = path.join(ROOT, 'config', 'intent-catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const catalogIntents = Array.isArray(catalog.intents) ? catalog.intents : [];
const catalogIds = new Set(catalogIntents.map((i) => i.intent_id));

// ── 2. 真实模板（扫盘，与 admin 模板管理同规则：必须有同名 manifest）──
// 保持**递归**：与 admin 的 scanTemplatePairs 行为一致，且能兼容
// 历史遗留的子目录结构。
// 注：common/templates/html/common/ 这一层已扁平化，目前所有模板都平铺在
// templates/html/ 单层下，由 scripts/check-template-layout.mjs 守卫。
function scanTemplates() {
  const skillsDir = path.join(ROOT, 'src', 'skills');
  const ids = new Set();
  const noManifest = [];
  if (!fs.existsSync(skillsDir)) return { ids, noManifest };

  const walk = (dir, skill) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(fp, skill);
      } else if (e.name.endsWith('.html')) {
        const id = e.name.replace(/\.html$/, '');
        if (fs.existsSync(fp.replace(/\.html$/, '.manifest.json'))) ids.add(id);
        else noManifest.push(`${skill}/${e.name}`);
      }
    }
  };

  for (const skill of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!skill.isDirectory() || skill.name.startsWith('_')) continue;
    walk(path.join(skillsDir, skill.name, 'templates', 'html'), skill.name);
  }
  return { ids, noManifest };
}
const { ids: templateIds, noManifest } = scanTemplates();

// ── 3. catalog 拍平索引（供后续检查复用）──────────────────
const catalogByIntent = new Map(catalogIntents.map((i) => [i.intent_id, i]));

// ── 检查 A：catalog 的 template_id 必须真实存在 ────────────
for (const it of catalogIntents) {
  const tpl = it.entry?.template_id;
  if (!tpl) {
    problems.push(`[A] catalog 条目缺 entry.template_id: ${it.intent_id}`);
  } else if (!templateIds.has(tpl)) {
    problems.push(`[A] catalog 指向不存在的模板: ${it.intent_id} -> ${tpl}`);
  }
}

// ── 检查 B：强制 1:1 —— 一张模板不得被多个意图共用 ─────────
// 共用会导致语义错配：如 diet_card 的 manifest 写明"一日三餐完整膳食"，
// 若被 meal_plan_breakfast_advice 共用，用户问"早餐吃什么"却收到全天卡片。
const byTemplate = new Map();
for (const it of catalogIntents) {
  const tpl = it.entry?.template_id;
  if (!tpl) continue;
  if (!byTemplate.has(tpl)) byTemplate.set(tpl, []);
  byTemplate.get(tpl).push(it.intent_id);
}
for (const [tpl, ids] of byTemplate) {
  if (ids.length > 1) {
    problems.push(`[B] 违反 1:1，模板被 ${ids.length} 个意图共用: ${tpl} <- ${ids.join(', ')}`);
  }
}

// ── 检查 C：intent_id 不得重复 ────────────────────────────
const seenIds = new Set();
for (const it of catalogIntents) {
  if (seenIds.has(it.intent_id)) {
    problems.push(`[C] catalog 存在重复 intent_id: ${it.intent_id}`);
  }
  seenIds.add(it.intent_id);
}

// ── 检查 E：无 manifest 的 HTML 不会被模板管理收录 ─────────
if (noManifest.length) {
  notes.push(
    `[E] ${noManifest.length} 个 HTML 缺同名 .manifest.json，模板管理不会收录：\n`
    + `    ${noManifest.slice(0, 5).join(', ')}`,
  );
}

// ── 检查 F（--live）：IntentKB 意图必须都在 catalog ────────
if (LIVE) {
  try {
    const kb = await (await fetch(`${LIS_BASE}/admin/intents`)).json();
    const kbIds = (kb.intents || []).map((e) => e.intent_id);
    for (const id of kbIds) {
      if (!catalogIds.has(id)) {
        problems.push(`[F] IntentKB 有意图但 catalog 没有（LIS 认出也执行不了）: ${id}`);
      }
    }
    // 反向：catalog 有但 IntentKB 没有 → LIS 永远认不出
    for (const id of catalogIds) {
      if (!kbIds.includes(id)) {
        notes.push(`[F] catalog 有条目但 IntentKB 无对应意图（LIS 认不出）: ${id}`);
      }
    }
    notes.push(`[F] IntentKB 意图数 ${kbIds.length}（kb_version ${kb.kb_version}）`);
  } catch (e) {
    notes.push(`[F] 跳过在线核对（LIS 未启动？）: ${e.message}`);
  }
}

// ── 输出 ──────────────────────────────────────────────────
// 同时写文件：Windows 控制台会把中文输出变成乱码，报告文件是可靠来源。
const report = [];
report.push('=== 链路统计 ===');
report.push(`catalog 意图      : ${catalogIntents.length}（启用 ${catalogIntents.filter((i) => i.enabled !== false).length}）`);
report.push(`独立模板数(1:1)   : ${byTemplate.size}`);
report.push(`可用模板(含manifest): ${templateIds.size}`);
if (notes.length) {
  report.push('');
  report.push('=== 提示（非阻塞）===');
  report.push(...notes);
}
if (problems.length) {
  report.push('');
  report.push('=== 断链（需修复）===');
  report.push(...problems);
  report.push(`共 ${problems.length} 处断链`);
} else {
  report.push('');
  report.push('全部一致性检查通过');
}
const reportPath = path.join(ROOT, 'build', 'audit-report.txt');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, report.join('\n'), 'utf8');
console.log(report.join('\n'));
if (problems.length) process.exit(1);
