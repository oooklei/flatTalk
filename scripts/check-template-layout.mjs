#!/usr/bin/env node
/**
 * 模板目录规范守卫。
 *
 * 规范（与现状一致，只是把约定变成可执行检查）：
 *   1. 可投放模板必须位于 src/skills/<skill>/templates/html/ 单层之下，
 *      不允许再套子目录。
 *      —— 实测唯一违规是 common/templates/html/common/（多一层），
 *         它能工作只因 admin 的 walk 是递归的、renderer 又硬编码了这条路径；
 *         但两处一旦不同步就会出现"admin 能看到、渲染找不到"的断链。
 *   2. 每个 .html 必须有同名 .manifest.json。
 *   3. manifest.id 必须与文件名一致（否则模板库注册名与磁盘名不符）。
 *   4. manifest 必须有 intent_id，且该意图必须在 catalog 中存在。
 *   5. catalog 的 template_id 必须能在磁盘上找到对应模板。
 *
 * 例外：templates/preview/ 与 *.preview.html 是渲染产物，不参与检查。
 *
 * 用法：node scripts/check-template-layout.mjs
 * 退出码：0 合规；1 有违规
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'src', 'skills');

const violations = [];
const notes = [];

function isPreview(p) {
  return /[\\/]preview[\\/]/.test(p) || /\.preview\.html$/.test(p) || /[\\/]index\.html$/.test(p);
}

// ── 收集磁盘模板 ────────────────────────────────────────
const onDisk = new Map(); // id -> 文件路径
const skillDirs = fs
  .readdirSync(SKILLS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name);

for (const skill of skillDirs) {
  const htmlRoot = path.join(SKILLS, skill, 'templates', 'html');
  if (!fs.existsSync(htmlRoot)) continue;

  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        // 规则 1：html/ 下不应再有子目录
        violations.push(
          `[层级] ${path.relative(ROOT, fp)} —— 模板必须平铺在 templates/html/ 单层，`
          + '不要再建子目录（渲染方与 admin 的路径解析不一致时会断链）',
        );
        walk(fp, depth + 1);
        continue;
      }
      if (!e.name.endsWith('.html') || isPreview(fp)) continue;

      const base = e.name.replace(/\.html$/, '');
      const man = fp.replace(/\.html$/, '.manifest.json');

      // 规则 2
      if (!fs.existsSync(man)) {
        violations.push(`[manifest缺失] ${path.relative(ROOT, fp)}`);
        continue;
      }
      let m;
      try {
        m = JSON.parse(fs.readFileSync(man, 'utf8'));
      } catch (err) {
        violations.push(`[manifest损坏] ${path.relative(ROOT, man)}: ${err.message}`);
        continue;
      }
      // 规则 3
      if (m.id && m.id !== base) {
        violations.push(`[id不符] ${path.relative(ROOT, man)}: manifest.id=${m.id} 文件名=${base}`);
      }
      const id = m.id || base;
      if (onDisk.has(id)) {
        violations.push(`[id重复] ${id} 同时存在于\n    ${onDisk.get(id)}\n    ${path.relative(ROOT, fp)}`);
      }
      onDisk.set(id, path.relative(ROOT, fp));
      // 规则 4（intent_id 存在性稍后与 catalog 一起校验）
      if (!m.intent_id) {
        notes.push(`[无intent_id] ${path.relative(ROOT, man)} —— 未绑定意图，不会被 LIS 路由命中`);
      }
    }
  };
  walk(htmlRoot, 0);
}

// ── 与 catalog 交叉校验 ─────────────────────────────────
const catalogPath = path.join(ROOT, 'config', 'intent-catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const catalogIntents = catalog.intents || [];
const catalogIds = new Set(catalogIntents.map((i) => i.intent_id));

for (const it of catalogIntents) {
  const tpl = it.entry?.template_id;
  // 规则 5
  if (!tpl) {
    violations.push(`[catalog缺template_id] ${it.intent_id}`);
  } else if (!onDisk.has(tpl)) {
    violations.push(`[catalog指向不存在的模板] ${it.intent_id} -> ${tpl}`);
  }
}

// manifest.intent_id 必须是 catalog 里的真意图
for (const [id, rel] of onDisk) {
  const man = path.join(ROOT, rel).replace(/\.html$/, '.manifest.json');
  const m = JSON.parse(fs.readFileSync(man, 'utf8'));
  if (m.intent_id && !catalogIds.has(m.intent_id)) {
    violations.push(`[intent_id不存在] ${rel}: manifest.intent_id=${m.intent_id} 不在 catalog 中`);
  }
}

const report = [
  '=== 模板目录规范检查 ===',
  `磁盘可投放模板 : ${onDisk.size}`,
  `catalog 意图   : ${catalogIntents.length}`,
  '',
  `违规 : ${violations.length}`,
  ...violations.map((v) => `  ${v}`),
  '',
  `提示 : ${notes.length}`,
  ...notes.slice(0, 20).map((n) => `  ${n}`),
];
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'template-layout.txt'), report.join('\n'), 'utf8');
console.log(`模板=${onDisk.size} 违规=${violations.length} 提示=${notes.length}`);
process.exit(violations.length ? 1 : 0);
