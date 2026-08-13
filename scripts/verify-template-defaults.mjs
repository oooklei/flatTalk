import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTopLevelNames } from '../src/template-card/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEmbeddedJson(html) {
  const re = /<script([^>]*)type=["']application\/json["']([^>]*)>([\s\S]*?)<\/script>/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = `${m[1] || ''}${m[2] || ''}`;
    const body = String(m[3] || '').trim();
    if (!body || body.startsWith('{{{') || body.startsWith('{{')) continue;
    candidates.push({ body, prefer: /\sid\s*=/.test(attrs) ? 0 : 1 });
  }
  candidates.sort((a, b) => b.prefer - a.prefer);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.body);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch { /* next */ }
  }
  return {};
}

function hasDefaultField(data, name) {
  if (!data || typeof data !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(data, name)) return true;
  if (!String(name).includes('.')) return false;
  let cur = data;
  for (const p of String(name).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return false;
    cur = cur[p];
  }
  return true;
}

const SKILLS = path.join(ROOT, 'src', 'skills');
let ok = 0;
const warns = [];
for (const skill of fs.readdirSync(SKILLS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)) {
  const dir = path.join(SKILLS, skill, 'templates', 'html');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const htmlFile = path.join(dir, f);
    const man = htmlFile.replace(/\.html$/, '.manifest.json');
    if (!fs.existsSync(man)) continue;
    const html = fs.readFileSync(htmlFile, 'utf8');
    const id = JSON.parse(fs.readFileSync(man, 'utf8')).id || f.replace(/\.html$/, '');
    const names = collectTopLevelNames(html);
    const data = parseEmbeddedJson(html);
    const missing = names.filter((n) => !hasDefaultField(data, n));
    if (missing.length) warns.push(`${skill}/${id}: ${missing.join(',')}`);
    else ok++;
  }
}
console.log(JSON.stringify({ ok, warn: warns.length, warns }, null, 2));
