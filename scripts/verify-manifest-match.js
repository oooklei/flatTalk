// 校验模板 manifest 的 match 字段是否符合 docs/TEMPLATE-AUTHORING.md 5.1 稽核规范。
//
// 检查项：
//   1. JSON 合法性
//   2. match 字段存在（对象格式豁免）
//   3. 以【N字标签】前缀开头
//   4. 前缀全库唯一
//   5. 裸泛化词不可作为唯一特征（警告）
//   6. 写明"不是什么"（警告）
//
// 退出码 0 = 通过；1 = 有硬性违规。警告不影响退出码。
import fs from 'node:fs';
import path from 'node:path';

const SKILLS_DIR = path.resolve('src/skills');

// 这些词在多个 skill 下都成立，不能作为唯一特征。
const GENERIC_WORDS = ['推荐', '查询', '详情', '列表', '状态', '确认', '清单', '报告'];

const rows = [];
const jsonErrors = [];

for (const skill of fs.readdirSync(SKILLS_DIR)) {
  const htmlDir = path.join(SKILLS_DIR, skill, 'templates', 'html');
  if (!fs.existsSync(htmlDir)) continue;
  for (const file of fs.readdirSync(htmlDir)) {
    if (!file.endsWith('.manifest.json')) continue;
    const abs = path.join(htmlDir, file);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      jsonErrors.push(`${skill}/${file}: ${e.message}`);
      continue;
    }
    // 只有存在同名 .html 才会被 discover.js 注册为模板。
    if (!fs.existsSync(abs.replace('.manifest.json', '.html'))) continue;

    const match = manifest.match;
    const kind = match === undefined ? 'missing' : typeof match === 'object' ? 'object' : 'string';
    const text = kind === 'string' ? String(match) : '';
    rows.push({
      skill,
      file,
      id: manifest.id || path.basename(file, '.manifest.json'),
      kind,
      text,
      prefix: (text.match(/^【[^】]+】/) || [''])[0],
    });
  }
}

const strings = rows.filter((r) => r.kind === 'string');
const noMatch = rows.filter((r) => r.kind === 'missing');
const objMatch = rows.filter((r) => r.kind === 'object');
const noPrefix = strings.filter((r) => !r.prefix);

const byPrefix = new Map();
for (const r of strings) {
  if (!r.prefix) continue;
  if (!byPrefix.has(r.prefix)) byPrefix.set(r.prefix, []);
  byPrefix.get(r.prefix).push(`${r.skill}/${r.id}`);
}
const dupePrefix = [...byPrefix.entries()].filter(([, v]) => v.length > 1);

// 前缀去掉书名号后若整体就是一个泛化词，等于没加特征。
const genericPrefix = strings.filter((r) => {
  const label = r.prefix.replace(/[【】]/g, '');
  return label && GENERIC_WORDS.includes(label);
});
// 未写排除语义的，提示补充。
const noExclusion = strings.filter((r) => !/非|不含|不是|排除/.test(r.text));

console.log(`registered templates : ${rows.length}`);
console.log(`  match=string       : ${strings.length}`);
console.log(`  match=object       : ${objMatch.length}  (确定性路由，豁免前缀)`);
console.log(`  match=missing      : ${noMatch.length}`);
console.log(`prefixed             : ${strings.length - noPrefix.length}/${strings.length}`);
console.log(`unique prefixes      : ${byPrefix.size}`);

const report = (title, items, render) => {
  if (!items.length) return;
  console.log(`\n${title}`);
  for (const item of items) console.log(`  ${render(item)}`);
};

report('JSON_ERROR:', jsonErrors, (s) => s);
report('MISSING_MATCH:', noMatch, (r) => `${r.skill}/${r.file}`);
report('NO_PREFIX:', noPrefix, (r) => `${r.skill}/${r.file}`);
report('DUPLICATE_PREFIX:', dupePrefix, ([p, v]) => `${p} -> ${v.join(', ')}`);
report('WARN_GENERIC_PREFIX:', genericPrefix, (r) => `${r.skill}/${r.id} 前缀 ${r.prefix} 是泛化词，需叠加域限定`);
report('WARN_NO_EXCLUSION:', noExclusion, (r) => `${r.skill}/${r.id} 未写"不是什么"`);

const violations = jsonErrors.length + noMatch.length + noPrefix.length + dupePrefix.length;
const warnings = genericPrefix.length + noExclusion.length;

console.log(`\nviolations: ${violations}  warnings: ${warnings}`);
console.log(violations === 0 ? 'PASS' : 'FAIL');
process.exit(violations === 0 ? 0 : 1);
