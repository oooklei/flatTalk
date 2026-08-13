// 验证 LIS 是否有会话级记忆导致「这条线路要多少钱」被前一轮带偏。
// 复现 e2e 的调用顺序：先问"线路对比"，紧接着问"这条线路要多少钱"。
import fs from 'node:fs';

async function sort(utterance, sessionId) {
  const r = await fetch('http://127.0.0.1:8100/v1/sort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ utterance, context: { role: 'elder', session_id: sessionId } }),
  });
  const j = await r.json();
  const t = (j.intents || [])[0] || {};
  return `${t.intent_id}(${Number(t.confidence).toFixed(3)}) -> ${t.template_id}`;
}

const out = [];

out.push('=== A. 全新 session，单独问 ===');
out.push(`  ${await sort('这条线路要多少钱', 'fresh-1')}`);

out.push('');
out.push('=== B. 同一 session，先问对比再问预算（复现 e2e 顺序）===');
out.push(`  第1轮 线路对比:  ${await sort('帮我对比几条线路', 'shared-1')}`);
out.push(`  第2轮 要多少钱:  ${await sort('这条线路要多少钱', 'shared-1')}`);

out.push('');
out.push('=== C. 不同 session，同样顺序 ===');
out.push(`  第1轮 线路对比:  ${await sort('帮我对比几条线路', 'diff-a')}`);
out.push(`  第2轮 要多少钱:  ${await sort('这条线路要多少钱', 'diff-b')}`);

fs.writeFileSync('build/lis-session-probe.txt', out.join('\n'), 'utf8');
console.log('done');
