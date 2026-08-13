import fs from 'node:fs';
import path from 'node:path';
import { renderMermaid } from './mermaid-render.mjs';
import { CHARTS } from './arch-charts.mjs';

console.log(`开始渲染 ${CHARTS.length} 个图表...`);
const results = await renderMermaid(CHARTS);

// 写出元数据供 docx 生成器读取
const OUT_DIR = 'd:\\GuiCare\\flatTalk\\docs\\diagrams';
fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(results, null, 2), 'utf8');

const ok = results.filter(r => r.ok).length;
console.log(`\n完成: ${ok}/${results.length} 成功`);
console.log('元数据: docs/diagrams/meta.json');

const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.log('失败列表:');
  failed.forEach(f => console.log(`  ${f.name}: ${f.error}`));
  process.exit(1);
}
