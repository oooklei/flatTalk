// 核查"孤岛模板"是否被代码硬编码引用（不经 catalog/LIS 也能触达）
import fs from 'node:fs';
import path from 'node:path';

const orphans = [
  'answer', 'fallback_error',
  'service_card', 'service_emergency', 'service_intent', 'service_thinking',
  'route_coastal', 'route_culture', 'route_ecology', 'route_wellness', 'sojourn_route',
  'travel_availability_card', 'travel_base_card', 'travel_h5_embed_card', 'travel_need_summary_card',
];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.git/.test(p)) walk(p);
    } else if (/\.(js|mjs)$/.test(e.name) && !/[\\/]templates[\\/]/.test(p)) {
      files.push(p);
    }
  }
})('src');

const QUOTE = String.fromCharCode(39, 34, 96); // ' " `
const lines = ['=== 孤岛模板的代码引用情况 ===', '扫描 ' + files.length + ' 个 js/mjs 文件', ''];

for (const id of orphans) {
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const re = new RegExp('[' + QUOTE + ']' + id + '[' + QUOTE + ']', 'g');
    const n = (text.match(re) || []).length;
    if (n) hits.push(path.relative('src', f) + '(' + n + ')');
  }
  const verdict = hits.length ? 'CODE_REF' : 'UNREACHABLE';
  lines.push(id.padEnd(28) + ' ' + verdict.padEnd(12) + ' ' + hits.slice(0, 4).join(' '));
}

fs.writeFileSync('build/audit-orphan.txt', lines.join('\n'), 'utf8');
console.log('written build/audit-orphan.txt');
