const http = require('http');
const payload = JSON.stringify({
  message: '嘉路康养中心周边有什么医院',
  session_id: 'test-nearby-map2',
  conversationId: 'test-nearby-map2-conv',
  roleKey: 'family',
});
const req = http.request({
  hostname: 'localhost',
  port: 5298,
  path: '/api/chat/message',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
}, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(d);
      const env = j.envelope || {};
      console.log('=== Top level keys ===');
      console.log(Object.keys(j));
      console.log('=== Envelope keys ===');
      console.log(Object.keys(env));
      console.log('template_id:', env.template_id);
      console.log('skill_key:', env.skill_key || j.skill_key);
      console.log('agent_key:', env.agent_key || j.agent_key);
      console.log('answer_text:', (env.answer_text || j.answer_text || '').slice(0, 300));
      console.log('rendered_html length:', (env.rendered_html || '').length);
      console.log('rendered_html preview:', (env.rendered_html || '').slice(0, 200));
      // 检查 context_snapshot
      const snap = env.context_snapshot || {};
      console.log('context_snapshot:', JSON.stringify(snap).slice(0, 200));
      // business_data
      const biz = env.business_data || j.business_data || {};
      console.log('business_data keys:', Object.keys(biz));
    } catch(e) {
      console.log('Parse error:', e.message);
      console.log('Raw (first 500):', d.slice(0, 500));
    }
    process.exit(0);
  });
});
req.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(60000, () => { console.error('TIMEOUT 60s'); req.destroy(); });
req.write(payload);
req.end();
