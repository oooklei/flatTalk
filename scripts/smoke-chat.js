const base = process.env.FLATTALK_SMOKE_BASE || 'http://127.0.0.1:5298';

const response = await fetch(`${base}/api/chat/message`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    request_id: 'smoke_req_1',
    conversation_id: 'smoke_conv_1',
    turn_id: 'smoke_turn_1',
    message: 'diabetes breakfast meal plan',
    skill_key: 'meal_plan',
    role: 'elder_family',
  }),
});

const envelope = await response.json();
if (!response.ok || !envelope.ok || envelope.skill_key !== 'meal_plan' || envelope.template_id !== 'diet_card') {
  console.error(JSON.stringify(envelope, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  skill_key: envelope.skill_key,
  template_id: envelope.template_id,
  render_status: envelope.debug?.render_status,
  knowledge_status: envelope.debug?.knowledge_status,
}, null, 2));
