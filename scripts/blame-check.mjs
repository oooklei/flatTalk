// 判定测试失败是否由本次改动引入 —— 不动工作区。
//
// 方法：把 HEAD 版本的被改文件抽到临时目录，用 --import 钩子把 import 重定向到
// 基线副本过于复杂且易错。改用更可靠的方式：
//   1. 先确认测试断言的目标符号是否存在于 HEAD 版本（多条失败断言的是源码文本）
//   2. 对比工作区与 HEAD 的差异行，确认我的改动是否触及相关逻辑
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CHANGED = [
  'src/core/model-service.js',
  'src/core/model-runtime/extra-template-fills.js',
];

// 测试里断言存在、但报"找不到"的符号
const SYMBOLS = [
  ['isHomeCareServiceAsk', 'src/core/model-service.js'],
  ['distToJialuKm > 40', 'src/core/orchestrator/chat-orchestrator.js'],
  ['function showStaticMap', 'src/skills/nearby_resource/templates/html/nearby_map_overview.html'],
];

const lines = [];

lines.push('=== 1. 这些符号在 HEAD（基线）里存在吗？ ===');
lines.push('（若基线也没有，说明测试本来就红，与本次改动无关）');
for (const [sym, file] of SYMBOLS) {
  let head = '';
  try {
    head = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 64e6 });
  } catch (e) {
    lines.push(`  ${sym}: 无法读取 HEAD:${file}`);
    continue;
  }
  const inHead = head.includes(sym);
  const wt = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const inWt = wt.includes(sym);
  lines.push(`  ${sym}`);
  lines.push(`     HEAD=${inHead ? '有' : '无'}  工作区=${inWt ? '有' : '无'}  -> ${
    !inHead && !inWt ? '两边都没有：既有失败，与本次改动无关'
      : inHead && !inWt ? '我删掉了：需修复'
        : '存在'
  }`);
}

lines.push('');
lines.push('=== 2. 我在这两个文件里改了什么 ===');
for (const f of CHANGED) {
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', '-U0', '--', f], { encoding: 'utf8', maxBuffer: 64e6 });
  } catch {}
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  lines.push(`  ${f}: +${added.length} -${removed.length}`);
  for (const l of removed) lines.push(`     删 ${l.slice(1).trim().slice(0, 130)}`);
}

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/blame-check.txt', lines.join('\n'), 'utf8');
console.log('done');
