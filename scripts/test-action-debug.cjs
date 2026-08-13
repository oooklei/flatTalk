const http = require('http');
const payload = JSON.stringify({
  action_key: 'check_availability',
  skill_key: 'travel_route',
  action_params: { product_id: '2070305000000000271' },
  conversation_id: 'test-avail-debug',
});
console.log('Sending payload:', payload);
console.log('Payload length:', Buffer.byteLength(payload));
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
    console.log('Headers:', JSON.stringify(res.headers).slice(0, 200));
    console.log('Body:', d.slice(0, 300));
    process.exit(0);
  });
});
req.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(30000, () => { console.error('TIMEOUT'); req.destroy(); });
req.write(payload);
req.end();
