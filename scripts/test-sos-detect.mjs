// 测试 SOS 紧急检测全链路
import { detectEmergency } from '../src/core/intent-classifier/emergency-detector.js';

const testCases = [
  { text: '救命！我摔倒了', expect: 'SOS' },
  { text: '快打120', expect: 'SOS' },
  { text: 'SOS', expect: 'SOS' },
  { text: '胸痛，不能呼吸', expect: 'SOS' },
  { text: '叫救护车', expect: 'SOS' },
  { text: '急救', expect: 'SOS' },
  { text: '今天天气不错', expect: false },
  { text: '帮我推荐膳食', expect: false },
];

let pass = 0, fail = 0;
for (const tc of testCases) {
  const result = detectEmergency({ text: tc.text });
  const isSos = result.matched && result.intent_type === 'SOS';
  const ok = (tc.expect === 'SOS') === isSos;
  if (ok) { pass++; console.log(`✅ "${tc.text}" → ${isSos ? 'SOS' : '正常'} ${result.keyword_match?.length ? '['+result.keyword_match.join(',')+']' : ''}`); }
  else { fail++; console.log(`❌ "${tc.text}" → 期望 ${tc.expect}，实际 ${isSos ? 'SOS' : '正常'} (${result.intent_type || 'none'})`); }
}
console.log(`\n${pass}/${pass+fail} 通过`);
process.exit(fail > 0 ? 1 : 0);
