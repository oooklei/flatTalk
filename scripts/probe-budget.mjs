// 「这条线路要多少钱」为什么出 route_compare_card
// 分别看：LIS 给什么、走 message 路径给什么、templateIdFromAction 给什么
import fs from 'node:fs';
import { templateIdFromAction } from '../src/core/actions/action-dispatcher.js';

const out = [];

// 1. templateIdFromAction 对相关 action 的映射
out.push('=== templateIdFromAction ===');
for (const k of [
  'travel_route.calculate_budget',
  'travel_route.compare_destinations',
  'travel_route.check_availability',
]) {
  out.push(`  ${k.padEnd(38)} -> ${templateIdFromAction(k, {})}`);
}

// 2. LIS 直接判定
const lis = await fetch('http://127.0.0.1:8100/v1/sort', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ utterance: '这条线路要多少钱', context: { role: 'elder', session_id: 'p' } }),
}).then((r) => r.json());
out.push('');
out.push('=== LIS /v1/sort ===');
for (const i of (lis.intents || []).slice(0, 3)) {
  out.push(`  ${i.intent_id}(${Number(i.confidence).toFixed(3)}) -> ${i.template_id}`);
}

// 3. flatTalk 端到端（不带 action_key，纯话语）
const ft = await fetch('http://127.0.0.1:5298/api/chat/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: '这条线路要多少钱',
    conversation_id: `p-${Date.now()}`,
    role: 'elder',
  }),
}).then((r) => r.json());
out.push('');
out.push('=== flatTalk /api/chat/message（无 action_key）===');
out.push(`  intent=${ft.intent} template_id=${ft.template_id} skill=${ft.skill_key}`);
out.push(`  route=${JSON.stringify(ft.route || {}).slice(0, 260)}`);

fs.writeFileSync('build/budget-probe.txt', out.join('\n'), 'utf8');
console.log('done');
