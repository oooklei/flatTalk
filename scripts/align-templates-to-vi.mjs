/**
 * 批量将技能模板硬编码色对标桂颐 VI（ui/guiyang-vi-system.html）
 * C端：暖橙 #E8843C；政务：霁蓝 #3A6B8C；纸感底 #FAF8F5；墨色 #3D3A36
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/skills');
const exts = new Set(['.html', '.css']);

/** [from, to] — 长短序排列，先替长串 */
const REPLACEMENTS = [
  // 旧康养海青 / 翠绿主色 → 暖橙
  ['#0E7C86', '#E8843C'],
  ['#0e7c86', '#E8843C'],
  ['#0E7C8622', 'rgba(232,132,60,.13)'],
  ['#0e7c6b', '#3A6B8C'],
  ['#0E7C6B', '#3A6B8C'],
  ['#095c4f', '#1E4A66'],
  ['#0b6f61', '#1E4A66'],
  ['#1FA97E', '#E8843C'],
  ['#1fa97e', '#E8843C'],
  ['#16855f', '#D06E2A'],
  ['#16855F', '#D06E2A'],
  ['#4FD1A6', '#F0B487'],
  ['#2A9B6C', '#E8843C'],
  ['#1E7A54', '#D06E2A'],
  ['#2f8f5b', '#E8843C'],
  ['#2F8F5B', '#E8843C'],
  ['#2f6f4e', '#D06E2A'],
  ['#2F6F4E', '#D06E2A'],
  ['#56b87f', '#F0B487'],
  ['#56B87F', '#F0B487'],
  ['#2d8a5a', '#6B9B7A'],
  ['#2D8A5A', '#6B9B7A'],
  ['#45a872', '#6B9B7A'],
  ['#45A872', '#6B9B7A'],
  ['#1E8E6A', '#6B9B7A'],
  // 旧亮蓝 → 霁蓝
  ['#2C7BE5', '#3A6B8C'],
  ['#2c7be5', '#3A6B8C'],
  ['#1E63C0', '#1E4A66'],
  ['#5AA0F2', '#7FA8C2'],
  ['#2563eb', '#3A6B8C'],
  ['#2563EB', '#3A6B8C'],
  ['#4a90d9', '#3A6B8C'],
  ['#4A90D9', '#3A6B8C'],
  ['#3d7ec4', '#1E4A66'],
  ['#3D7EC4', '#1E4A66'],
  // 冷灰底 → 暖纸
  ['#f4f7fa', '#FAF8F5'],
  ['#F4F7FA', '#FAF8F5'],
  ['#f5f7fa', '#FAF8F5'],
  ['#F5F7FA', '#FAF8F5'],
  ['#f5f8fc', '#FAF8F5'],
  ['#F5F8FC', '#FAF8F5'],
  ['#fbfbfc', '#FAF8F5'],
  ['#FBFBFC', '#FAF8F5'],
  ['#ECFBF5', '#FDF6F0'],
  ['#ecfbf5', '#FDF6F0'],
  ['#EEF4FE', '#E8F0F5'],
  ['#eef4fe', '#E8F0F5'],
  ['#EAF1F3', '#F0EDE7'],
  ['#eaf1f3', '#F0EDE7'],
  ['#EAF2FE', '#E8F0F5'],
  ['#ebf4fb', '#E8F0F5'],
  ['#EBF4FB', '#E8F0F5'],
  ['#E6F7F0', '#FDF6F0'],
  ['#e6f7f0', '#FDF6F0'],
  ['#E6F5F2', '#E8F0F5'],
  ['#e6f5f2', '#E8F0F5'],
  ['#E3F2F3', '#FDF6F0'],
  ['#E3F6EF', '#E8F2EC'],
  ['#F4F8F7', '#FDF6F0'],
  ['#e2ebe6', '#E4E0D8'],
  ['#E2EBE6', '#E4E0D8'],
  ['#E1F0EA', '#E4E0D8'],
  ['#e1f0ea', '#E4E0D8'],
  ['#eceff3', '#E4E0D8'],
  ['#ECEFF3', '#E4E0D8'],
  ['#eef1f5', '#E4E0D8'],
  ['#EEF1F5', '#E4E0D8'],
  ['#e2e8f0', '#E4E0D8'],
  ['#E2E8F0', '#E4E0D8'],
  ['#f8fafc', '#FDF6F0'],
  ['#F8FAFC', '#FDF6F0'],
  ['#f1f5f9', '#F0EDE7'],
  ['#F1F5F9', '#F0EDE7'],
  // 墨色 / 次文字
  ['#1e293b', '#3D3A36'],
  ['#1E293B', '#3D3A36'],
  ['#1f2329', '#3D3A36'],
  ['#1F2329', '#3D3A36'],
  ['#2b2f33', '#3D3A36'],
  ['#2B2F33', '#3D3A36'],
  ['#1a2e22', '#3D3A36'],
  ['#1A2E22', '#3D3A36'],
  ['#1F2A33', '#3D3A36'],
  ['#2E3A36', '#3D3A36'],
  ['#1F2D3D', '#3D3A36'],
  ['#64748b', '#8A8278'],
  ['#64748B', '#8A8278'],
  ['#5b6573', '#6B6660'],
  ['#5B6573', '#6B6660'],
  ['#5a6b62', '#8A8278'],
  ['#5A6B62', '#8A8278'],
  ['#6b7280', '#8A8278'],
  ['#6B7280', '#8A8278'],
  ['#6B7A8F', '#8A8278'],
  ['#6b7a8f', '#8A8278'],
  ['#7C8A84', '#8A8278'],
  ['#94a3b8', '#A8A09A'],
  ['#94A3B8', '#A8A09A'],
  ['#9aa3af', '#A8A09A'],
  ['#9AA3AF', '#A8A09A'],
  // SQE 渐变残留
  ['rgba(14,124,107,.98)', 'rgba(58,107,140,.98)'],
  ['rgba(37,99,235,.86)', 'rgba(30,74,102,.86)'],
  ['rgba(16, 52, 60, .10)', 'rgba(62, 56, 50, 0.08)'],
  ['rgba(16, 52, 60, .08)', 'rgba(62, 56, 50, 0.08)'],
  ['rgba(15, 23, 42, .08)', 'rgba(62, 56, 50, 0.08)'],
  ['rgba(31,45,61,.08)', 'rgba(62,56,50,.08)'],
  ['rgba(20,30,40,.06)', 'rgba(62,56,50,.08)'],
  ['rgba(30, 50, 40, 0.06)', 'rgba(62, 56, 50, 0.08)'],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'preview') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (exts.has(path.extname(name))) out.push(p);
  }
  return out;
}

let filesChanged = 0;
let totalHits = 0;
for (const file of walk(root)) {
  let text = fs.readFileSync(file, 'utf8');
  let hits = 0;
  for (const [from, to] of REPLACEMENTS) {
    if (!text.includes(from)) continue;
    const parts = text.split(from);
    hits += parts.length - 1;
    text = parts.join(to);
  }
  if (hits > 0) {
    fs.writeFileSync(file, text);
    filesChanged += 1;
    totalHits += hits;
    console.log(`${hits}\t${path.relative(process.cwd(), file)}`);
  }
}
console.log(`\nDone: ${filesChanged} files, ${totalHits} replacements`);
