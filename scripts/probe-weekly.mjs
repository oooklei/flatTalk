// 复现：点「生成一周计划」为什么还是一日三餐
// followups 里 user_prompt = "请基于这份膳食建议生成一周三餐计划"
// 直接把这句发给 LIS，看命中哪个意图
const utts = [
  '请基于这份膳食建议生成一周三餐计划',   // followups 的 user_prompt
  '一周三餐计划',
  '生成一周计划',                        // 按钮 label 本身
  '一周',
  '七天',
];
const out = [];
for (const u of utts) {
  const r = await fetch('http://127.0.0.1:8100/v1/sort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ utterance: u, context: { role: 'elder', session_id: 'probe' } }),
  });
  const j = await r.json();
  const tops = (j.intents || []).slice(0, 3)
    .map((i) => `${i.intent_id}(${Number(i.confidence).toFixed(3)})->${i.template_id}`);
  out.push(`「${u}」\n    mode=${j.mode}\n    ${tops.join('\n    ')}`);
}
const fs = await import('node:fs');
fs.writeFileSync('build/weekly-probe.txt', out.join('\n\n'), 'utf8');
console.log('done');
