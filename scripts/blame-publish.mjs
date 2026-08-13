// 判定这批 publish 测试失败是否由我的改动引入 —— 不动工作区。
//
// 方法：把 HEAD 版本的 chat-orchestrator.js 抽到临时文件，
// 与工作区做行级 diff，只看我这次真正改了什么；
// 再检查失败测试断言的目标是否在我的改动范围内。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const F = 'src/core/orchestrator/chat-orchestrator.js';
const lines = [];

let head = '';
try {
  head = execFileSync('git', ['show', `HEAD:${F}`], { encoding: 'utf8', maxBuffer: 64e6 });
} catch (e) {
  lines.push(`无法读取 HEAD:${F} -> ${e.message}`);
}
const wt = fs.readFileSync(F, 'utf8');

lines.push('=== 1. 我这次在 orchestrator 的改动（工作区 vs HEAD）===');
const diff = execFileSync('git', ['diff', '-U2', '--', F], { encoding: 'utf8', maxBuffer: 64e6 });
lines.push(diff || '(无差异)');

lines.push('');
lines.push('=== 2. 失败测试断言的关键符号是否在 HEAD 就已存在 ===');
// publish-fill-route 断言 fillRouteCardLegacy -> route_coastal
// publish-chat-smoke 断言 京族滨海文化线 -> skill_key=travel_route
const SYMS = [
  ['route_coastal', 'src/core/model-service.js'],
  ['fillRouteCardLegacy', 'src/core/model-service.js'],
  ['京族', 'src/core/scene-router/rules/travel-route.js'],
  ['ambiguity_options', F],
];
for (const [sym, file] of SYMS) {
  let h = '';
  try { h = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 64e6 }); } catch {}
  const w = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  lines.push(`  ${sym.padEnd(22)} HEAD=${h.includes(sym) ? '有' : '无'}  工作区=${w.includes(sym) ? '有' : '无'}  (${file})`);
}

fs.writeFileSync('build/publish-blame.txt', lines.join('\n'), 'utf8');
console.log('done');
