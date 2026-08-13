// 打包 4 个项目 + PG 导出为 tar.gz，供上传到 192.168.1.2:/mnt/llgj/apps/gxy
// 用 Node 而非 PowerShell —— PS 对嵌套花括号/管道解析不稳定。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'd:/GuiCare';
const STAGE = path.join(ROOT, '_stage_gxy');
const TAR = path.join(ROOT, '_gxy_deploy.tar.gz');

// 通用排除：目录名 / 文件名正则
const SKIP_DIR = new Set([
  'node_modules', '.git', '.venv', '__pycache__', 'build', 'dist',
  '.pytest_cache', '.ruff_cache', 'preview', 'source-copies',
  // 旧镜像 tar（858MB）不需要上传，远程重新构建
  'docker-images',
  // 编码器模型的 pytorch 原始权重：运行时只用 onnx，_src 是转换来源
  '_src',
]);
const SKIP_FILE = /\.(pid|err|out|log|zip|tar\.gz|rar|db-wal|db-shm)$/i;
const SKIP_NAME = new Set([
  '.env', '.env.remote', '.DS_Store',
  // onnx.data 与 model.onnx 二选一由 LIS 自己决定；两者都要，不排除
]);

function copyTree(src, dst, depth = 0) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const base = path.basename(src);
    if (depth > 0 && SKIP_DIR.has(base)) return 0;
    fs.mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const e of fs.readdirSync(src)) {
      n += copyTree(path.join(src, e), path.join(dst, e), depth + 1);
    }
    return n;
  }
  const base = path.basename(src);
  if (SKIP_NAME.has(base)) return 0;
  if (SKIP_FILE.test(base)) return 0;
  // 下划线前缀的调试残留不带，但 Python 的 __init__.py / __main__.py 等
  // dunder 文件是包结构必需，绝不能排除。
  if (base.startsWith('_') && !base.startsWith('__')) return 0;
  fs.copyFileSync(src, dst);
  return 1;
}

if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

const jobs = [
  ['flatTalk', path.join(ROOT, 'flatTalk')],
  ['LIS-System', path.join(ROOT, 'LIS-System')],
  ['Tag-System', path.join(ROOT, 'Tag-System')],
];

for (const [name, src] of jobs) {
  const n = copyTree(src, path.join(STAGE, name));
  console.log(`${name.padEnd(12)} ${n} files`);
}

// local-kb 已弃用（改用远程 gxy-local-kb），不再打包
const kbDir = path.join(STAGE, 'flatTalk', 'local-kb');
if (fs.existsSync(kbDir)) {
  fs.rmSync(kbDir, { recursive: true, force: true });
  console.log('local-kb     已移除（弃用）');
}

// PG 导出单独放
const pgSrc = path.join(ROOT, 'flatTalk', 'build', 'pgdump');
const pgDst = path.join(STAGE, 'pgdump');
fs.mkdirSync(pgDst, { recursive: true });
let pgN = 0;
for (const f of fs.readdirSync(pgSrc)) {
  fs.copyFileSync(path.join(pgSrc, f), path.join(pgDst, f));
  pgN += 1;
}
console.log(`pgdump       ${pgN} files`);

// 统计
let total = 0; let bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else { total += 1; bytes += fs.statSync(p).size; }
  }
})(STAGE);
console.log(`\nstage: ${total} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);

if (fs.existsSync(TAR)) fs.rmSync(TAR);
execFileSync('tar', ['-czf', TAR, '-C', STAGE, '.'], { stdio: 'inherit' });
console.log(`tar: ${(fs.statSync(TAR).size / 1024 / 1024).toFixed(2)} MB -> ${TAR}`);
