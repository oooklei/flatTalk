const http = require('http');
const payload = JSON.stringify({
  message: '你好',
  session_id: 'test-msg',
  conversationId: 'test-msg-conv',
  roleKey: 'family',
});
console.log('Sending to /api/chat/message, payload:', payload);
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
    console.log('Status:', res.statusCode);
    console.log('Body:', d.slice(0, 300));
    process.exit(0);
  });
});
req.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(30000, () => { console.error('TIMEOUT'); req.destroy(); });
req.write(payload);
req.end();
