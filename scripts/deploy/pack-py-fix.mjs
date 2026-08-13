// 只重传 Python 项目（LIS-System / Tag-System），修复被误删的 __init__.py
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'd:/GuiCare';
const STAGE = path.join(ROOT, '_stage_py');
const TAR = path.join(ROOT, '_py_fix.tar.gz');

const SKIP_DIR = new Set([
  'node_modules', '.git', '.venv', '__pycache__', 'build', 'dist',
  '.pytest_cache', '.ruff_cache', '_src',
]);
const SKIP_FILE = /\.(pid|err|out|log|zip|tar\.gz|rar|xlsx|docx|doc)$/i;
const SKIP_NAME = new Set(['.env', '.env.remote', '.DS_Store']);

function copyTree(src, dst, depth = 0) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    if (depth > 0 && SKIP_DIR.has(path.basename(src))) return 0;
    fs.mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const e of fs.readdirSync(src)) n += copyTree(path.join(src, e), path.join(dst, e), depth + 1);
    return n;
  }
  const base = path.basename(src);
  if (SKIP_NAME.has(base) || SKIP_FILE.test(base)) return 0;
  // dunder 文件（__init__.py 等）必须保留
  if (base.startsWith('_') && !base.startsWith('__')) return 0;
  fs.copyFileSync(src, dst);
  return 1;
}

if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

for (const name of ['LIS-System', 'Tag-System']) {
  const n = copyTree(path.join(ROOT, name), path.join(STAGE, name));
  console.log(`${name}: ${n} files`);
}

// 核对 __init__.py 是否都在
const inits = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === '__init__.py') inits.push(path.relative(STAGE, p));
  }
})(STAGE);
console.log(`__init__.py 数量: ${inits.length}`);
for (const i of inits) console.log('  ' + i);

if (fs.existsSync(TAR)) fs.rmSync(TAR);
execFileSync('tar', ['-czf', TAR, '-C', STAGE, '.'], { stdio: 'inherit' });
console.log(`tar: ${(fs.statSync(TAR).size / 1024 / 1024).toFixed(1)} MB`);
