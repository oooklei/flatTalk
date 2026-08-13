// 提取 docx 纯文本 — 用复制成 .zip 绕过 Expand-Archive 扩展名限制
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const docxPath = resolve(root, '防城港市AI养老试点5条旅居养老线路产品设计方案（大健康产业协会牵头落地版）.docx');
const tmpDir = resolve(root, 'scripts', '_docx_extract');
const tmpZip = resolve(root, 'scripts', '_docx_tmp.zip');

// 复制 docx → zip
copyFileSync(docxPath, tmpZip);

// 解压
execSync(`Remove-Item -Recurse -Force "${tmpDir}" -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Path "${tmpDir}" -Force | Out-Null; Expand-Archive -Path "${tmpZip}" -DestinationPath "${tmpDir}" -Force`, { shell: 'powershell' });

// 读取 word/document.xml
const xmlPath = resolve(tmpDir, 'word', 'document.xml');
if (!existsSync(xmlPath)) {
  console.error('未找到 word/document.xml');
  process.exit(1);
}
const xml = readFileSync(xmlPath, 'utf8');

// 提取表格和段落文本
// 把 </w:p> 转成换行，<w:tab> 转成制表符，去掉所有 XML 标签
let text = xml
  .replace(/<\/w:p>/g, '\n')
  .replace(/<w:tab[^>]*\/>/g, '\t')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

// 清理多余空行，但保留结构
text = text.replace(/\n{3,}/g, '\n\n').trim();

writeFileSync(resolve(root, 'scripts', '_fangchenggang-routes.txt'), text, 'utf8');
console.log('提取完成，字符数:', text.length);
console.log('\n=== 前 800 字 ===\n');
console.log(text.slice(0, 800));
console.log('\n...\n\n=== 后 500 字 ===\n');
console.log(text.slice(-500));
