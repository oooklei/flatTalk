// 远程执行辅助：把本地 sh 脚本推到 192.168.1.2 执行并取回输出。
// 避免 PowerShell/zsh 双层引号转义地狱。
//   用法: node scripts/deploy/rsh.mjs <本地脚本路径> [输出文件名]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOST = process.env.GXY_HOST || 'root@192.168.1.2';
const script = process.argv[2];
if (!script || !fs.existsSync(script)) {
  console.error('usage: node rsh.mjs <script.sh> [outname]');
  process.exit(2);
}
const outName = process.argv[3] || `rsh-${path.basename(script, '.sh')}.txt`;
const remoteScript = `/tmp/_rsh_${path.basename(script)}`;
const remoteOut = `${remoteScript}.out`;
const localOut = path.join('build', outName);

fs.mkdirSync('build', { recursive: true });

const run = (args, opts = {}) =>
  execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: 'pipe', ...opts });

try {
  run(['scp', '-o', 'StrictHostKeyChecking=no', script, `${HOST}:${remoteScript}`]);
  // 去 CRLF，执行，落盘；无论成功失败都保留输出
  run([
    'ssh', HOST,
    `sed -i 's/\\r$//' ${remoteScript}; bash ${remoteScript} > ${remoteOut} 2>&1; echo "__EXIT=$?" >> ${remoteOut}`,
  ]);
  run(['scp', `${HOST}:${remoteOut}`, localOut]);
} catch (e) {
  // ssh 非零退出也要把输出取回
  try {
    run(['scp', `${HOST}:${remoteOut}`, localOut]);
  } catch { /* ignore */ }
  if (!fs.existsSync(localOut)) {
    console.error('FAILED before output captured:', e.message);
    process.exit(1);
  }
}

const text = fs.readFileSync(localOut, 'utf8');
const m = text.match(/__EXIT=(\d+)\s*$/);
const code = m ? Number(m[1]) : 0;
console.log(text.replace(/__EXIT=\d+\s*$/, ''));
console.log(`[rsh] exit=${code}  saved=${localOut}`);
process.exit(code);
