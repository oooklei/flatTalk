// 校验所有模板 manifest 的 match 字段：JSON 合法性、前缀唯一性、覆盖率。
import fs from 'node:fs';
import path from 'node:path';

const SKILLS_DIR = path.resolve('src/skills');

const rows = [];
let bad = 0;

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
      console.log(`JSON_FAIL ${skill}/${file}: ${e.message}`);
      bad += 1;
      continue;
    }
    const hasHtml = fs.existsSync(abs.replace('.manifest.json', '.html'));
    const match = manifest.match;
    const kind = match === undefined ? 'missing' : typeof match === 'object' ? 'object' : 'string';
    const prefix = kind === 'string' ? (String(match).match(/^【[^】]+】/) || [''])[0] : '';
    rows.push({ skill, file, hasHtml, kind, prefix, id: manifest.id || '' });
  }
}

const registered = rows.filter((r) => r.hasHtml);
const strings = registered.filter((r) => r.kind === 'string');
const missingPrefix = strings.filter((r) => !r.prefix);
const noMatch = registered.filter((r) => r.kind === 'missing');
const objMatch = registered.filter((r) => r.kind === 'object');

const byPrefix = new Map();
for (const r of strings) {
  if (!r.prefix) continue;
  if (!byPrefix.has(r.prefix)) byPrefix.set(r.prefix, []);
  byPrefix.get(r.prefix).push(`${r.skill}/${r.id}`);
}
const dupes = [...byPrefix.entries()].filter(([, v]) => v.length > 1);

console.log(`manifest total       : ${rows.length}`);
console.log(`registered (has html): ${registered.length}`);
console.log(`  match=string       : ${strings.length}`);
console.log(`  match=object       : ${objMatch.length}`);
console.log(`  match=missing      : ${noMatch.length}`);
console.log(`prefixed             : ${strings.length - missingPrefix.length}/${strings.length}`);
console.log(`unique prefixes      : ${byPrefix.size}`);
console.log(`JSON errors          : ${bad}`);

if (missingPrefix.length) {
  console.log('\nNO_PREFIX:');
  for (const r of missingPrefix) console.log(`  ${r.skill}/${r.file}`);
}
if (noMatch.length) {
  console.log('\nNO_MATCH_FIELD:');
  for (const r of noMatch) console.log(`  ${r.skill}/${r.file}`);
}
if (dupes.length) {
  console.log('\nDUPLICATE_PREFIX:');
  for (const [p, v] of dupes) console.log(`  ${p} -> ${v.join(', ')}`);
}

const pass = bad === 0 && missingPrefix.length === 0 && noMatch.length === 0 && dupes.length === 0;
console.log(`\n${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
