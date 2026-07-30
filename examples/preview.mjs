// 生成「带默认数据的成品预览」，用于与静态原件像素级对比。
// 用法: node examples/preview.mjs <templateId> [输出路径]
import fs from 'node:fs';
import path from 'node:path';
import { renderPreview } from '../src/template-card/index.js';

const id = process.argv[2] || 'diet_card';
const out = process.argv[3] || path.join('examples', 'output', `${id}_preview.html`);
const dir = path.join('examples', 'cards');

const html = renderPreview(dir, id);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');
console.log(`已生成预览: ${out}`);
console.log('把此文件与静态原件并排打开即可核对是否走样。');
