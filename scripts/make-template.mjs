// 模板制作 CLI：把原型 HTML（单文件 / 文件夹）转换为模板卡，放入指定技能的 templates/html 目录。
// 用法：
//   node scripts/make-template.mjs --skill meal_plan --in path/to/proto.html
//   node scripts/make-template.mjs --skill common --in path/to/proto-dir --layout grid
//   node scripts/make-template.mjs --skill common --in a.html b.html --layout card
import fs from 'node:fs';
import path from 'node:path';
import { makeTemplateFromHtml, toTemplateId } from '../src/template-card/make-template.js';

const SKILLS_DIR = path.join(process.cwd(), 'src', 'skills');

function parseArgs(argv) {
  const o = { skill: 'common', layout: 'card', description: '', inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill') o.skill = argv[++i];
    else if (a === '--layout') o.layout = argv[++i];
    else if (a === '--description') o.description = argv[++i];
    else if (a === '--in') { while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o.inputs.push(argv[++i]); }
    else if (!a.startsWith('--')) o.inputs.push(a);
  }
  return o;
}

function collectHtmlFiles(input) {
  const fp = path.resolve(input);
  if (!fs.existsSync(fp)) return [];
  if (fs.statSync(fp).isDirectory()) {
    return fs.readdirSync(fp, { recursive: true })
      .map((p) => path.join(fp, p))
      .filter((f) => fs.statSync(f).isFile() && /\.html?$/i.test(f));
  }
  return [fp];
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.inputs.length) {
    console.error('用法: node scripts/make-template.mjs --skill <skill> --in <file|dir> [--layout card|grid|vertical|horizontal] [--description 说明]');
    process.exit(1);
  }
  const skillDir = path.join(SKILLS_DIR, o.skill);
  if (!fs.existsSync(skillDir)) {
    console.error(`技能目录不存在: ${skillDir}`); process.exit(1);
  }
  const htmlDir = path.join(skillDir, 'templates', 'html');
  fs.mkdirSync(htmlDir, { recursive: true });

  const files = o.inputs.flatMap(collectHtmlFiles);
  if (!files.length) { console.error('未找到任何 HTML 文件'); process.exit(1); }

  const used = new Set();
  for (const file of files) {
    const id = toTemplateId(file);
    let finalId = id;
    let i = 2;
    while (used.has(finalId) || fs.existsSync(path.join(htmlDir, finalId + '.html'))) finalId = `${id}_${i++}`;
    used.add(finalId);
    const html = fs.readFileSync(file, 'utf8');
    const r = makeTemplateFromHtml(html, { id: finalId, layout: o.layout, description: o.description });
    fs.writeFileSync(path.join(htmlDir, finalId + '.html'), r.html, 'utf8');
    fs.writeFileSync(path.join(htmlDir, finalId + '.manifest.json'), JSON.stringify(r.manifest, null, 2), 'utf8');
    console.log(`✅ ${finalId}  (${path.relative(process.cwd(), path.join(htmlDir, finalId + '.html'))})  字段: ${r.fields.length}`);
  }
  console.log(`\n完成：在技能 ${o.skill} 下生成 ${used.size} 个模板。`);
}

main();
