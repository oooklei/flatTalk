// 用 Node 直接跑测试并落盘结果 —— PowerShell 管道会吞掉 node --test 的输出，
// 导致看不到失败清单（多次尝试 Select-String/Tee 都得到空文件）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = fs
  .readdirSync('tests')
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join('tests', f));

const r = spawnSync(process.execPath, ['--test', ...files], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const out = `${r.stdout || ''}\n${r.stderr || ''}`;
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/test-full.txt', out, 'utf8');

const lines = out.split('\n');
// 该 Node 版本的默认 reporter 用 ✔/✖ 而非 TAP 的 ok/not ok。
// 早前只匹配 ^not ok 导致「0 失败」的假阴性 —— 实际有失败但没被识别。
const failed = lines.filter((l) => /^[✖\u2716]\s/.test(l.trim()) || /^not ok /.test(l));
const passedCount = lines.filter((l) => /^[✔\u2714]\s/.test(l.trim())).length;
const summary = lines.filter((l) => /^# (tests|pass|fail|cancelled|skipped)/.test(l));

const report = [
  ...summary,
  `通过文件数: ${passedCount}`,
  `失败文件数: ${failed.length}`,
  '',
  ...failed.map((f) => `  ${f.trim().slice(0, 160)}`),
];
fs.writeFileSync('build/test-summary.txt', report.join('\n'), 'utf8');
console.log(report.join('\n'));
process.exit(failed.length ? 1 : 0);
