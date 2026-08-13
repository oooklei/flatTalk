const http = require('http');
const payload = JSON.stringify({
  action_key: 'check_availability',
  skill_key: 'travel_route',
  action_params: { product_id: '2070305000000000271' },
  conversation_id: 'test-avail-node',
});
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
      console.log('template:', j.envelope?.template_id || '');
      console.log('answer:', (j.envelope?.answer_text || j.answer_text || '').slice(0, 200));
    } catch(e) {
      console.log('Raw:', d.slice(0, 300));
    }
    process.exit(0);
  });
});
req.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(30000, () => { console.error('TIMEOUT'); req.destroy(); });
req.write(payload);
req.end();
