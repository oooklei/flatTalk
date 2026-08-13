import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(html|css)$/i.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const pairs = [
  ['#0B5C63', '#D06E2A'],
  ['#0b5c63', '#D06E2A'],
  ['#FF7826', '#E8843C'],
  ['#ff7826', '#E8843C'],
  ['#FF9A5C', '#F0B487'],
  ['#ff9a5c', '#F0B487'],
  ['#FF7A45', '#E8843C'],
  ['#ff7a45', '#E8843C'],
  ['#FB923C', '#E8843C'],
  ['#fb923c', '#E8843C'],
  ['#F8EAD9', '#FAF8F5'],
  ['#F8EADA', '#FDF6F0'],
  ['#E5E5E5', '#E4E0D8'],
  ['#F0EBE3', '#E4E0D8'],
  ['#FFF3E0', '#FDF6F0'],
  ['#3A3A3A', '#3D3A36'],
  ['#999999', '#8A8278'],
  ['#333333', '#3D3A36'],
  ['--bg-page: #FFFFFF', '--bg-page: #FAF8F5'],
  ['--bg-page:#FFFFFF', '--bg-page:#FAF8F5'],
  ['background: #eef2f7', 'background: #F0EDE7'],
  ['background:#eef2f7', 'background:#F0EDE7'],
];

const files = walk('src/skills');
let changed = 0;
let hits = 0;
for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  for (const [from, to] of pairs) {
    if (!text.includes(from)) continue;
    const n = text.split(from).length - 1;
    hits += n;
    text = text.split(from).join(to);
  }
  if (text !== before) {
    fs.writeFileSync(file, text);
    changed += 1;
    console.log(path.relative(process.cwd(), file));
  }
}
console.log(`files=${changed} hits=${hits} scanned=${files.length}`);
