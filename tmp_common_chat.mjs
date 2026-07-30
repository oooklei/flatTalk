const BASE = 'http://127.0.0.1:5298';

async function chat(message, role = 'elder_family') {
  const res = await fetch(`${BASE}/api/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, role, conversation_id: 'conv_common_1', turn_id: 'turn_common_1' }),
  });
  return res.json();
}

const log = (s) => process.stdout.write(String(s) + '\n');
const r = await chat('老人高龄津贴怎么申请，需要准备什么材料');
log(`ok=${r.ok} skill_key=${r.skill_key} template_id=${r.template_id} intent=${r.intent}`);
log(`knowledge_source=${r.knowledge_source || (r.knowledge && r.knowledge.source) || ''}`);
const ev = r.evidence || (r.knowledge && r.knowledge.matches) || [];
log(`evidence_count=${ev.length}`);
for (const m of ev.slice(0, 5)) {
  log(`  - [${m.collection || m.origin || '?'}] ${(m.title || '').slice(0, 30)} origin=${m.origin || '?'} src=${m.source || ''}`);
}
