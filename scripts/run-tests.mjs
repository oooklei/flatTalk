// 跑指定测试文件，结果落盘 —— 避开 PSReadLine 渲染崩溃与管道解析歧义。
// 判定口径用**退出码**（唯一可靠），同时记录用例数防止误判。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FILES = process.argv.slice(2);
const lines = [];
let pass = 0;

for (const f of FILES) {
  const r = spawnSync(process.execPath, ['--test', f], { encoding: 'utf8', timeout: 180000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const tests = out.match(/^# tests (\d+)/m)?.[1] || '?';
  const failN = out.match(/^# fail (\d+)/m)?.[1] || '?';
  const ok = r.status === 0;
  if (ok) pass += 1;
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${f}  tests=${tests} fail=${failN} exit=${r.status}`);
  if (!ok) {
    const detail = out.split('\n')
      .filter((l) => /not ok|✖|Error|AssertionError|expected|actual/.test(l))
      .slice(0, 12);
    lines.push(...detail.map((d) => `      ${d.trim().slice(0, 160)}`));
  }
}

lines.push('');
lines.push(`通过 ${pass}/${FILES.length}`);
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/run-tests.txt', lines.join('\n'), 'utf8');
console.log(`pass=${pass}/${FILES.length}`);
