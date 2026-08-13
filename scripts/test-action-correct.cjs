const http = require('http');
const payload = JSON.stringify({
  action_key: 'travel_route.check_availability',
  skill_key: 'travel_route',
  params: { product_id: '2070305000000000271' },
  user_prompt: '请检查这条旅居路线近期是否可预订',
  execute_action: true,
  conversation_id: 'test-avail-correct',
  roleKey: 'family',
});
console.log('Sending:', payload);
const req = http.request({
  hostname: 'localhost',
  port: 5298,
  path: '/api/chat/action',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
}, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const j = JSON.parse(d);
      console.log('ok:', j.ok);
      console.log('error:', j.error || '(none)');
      console.log('result_type:', j.result_type || '');
      const env = j.envelope || {};
      console.log('template:', env.template_id || '');
      console.log('answer:', (env.answer_text || '').slice(0, 200));
    } catch(e) {
      console.log('Raw:', d.slice(0, 300));
    }
    process.exit(0);
  });
});
req.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(30000, () => { console.error('TIMEOUT 30s'); req.destroy(); });
req.write(payload);
req.end();
