// 抓完整 stderr —— PowerShell 管道会吞掉 node --test 的加载期错误
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FILES = process.argv.slice(2);
const lines = [];
for (const f of FILES) {
  const r = spawnSync(process.execPath, ['--test', f], { encoding: 'utf8', timeout: 120000 });
  lines.push(`===== ${f}  exit=${r.status} =====`);
  lines.push('--- stdout 尾部 ---');
  lines.push((r.stdout || '').split('\n').slice(-40).join('\n'));
  lines.push('--- stderr ---');
  lines.push((r.stderr || '(空)').slice(0, 3000));
  lines.push('');
}
fs.writeFileSync('build/raw-test-out.txt', lines.join('\n'), 'utf8');
console.log('done');
