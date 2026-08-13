const http = require('http');
const payload = JSON.stringify({
  message: '嘉路康养中心周边有什么医院',
  session_id: 'test-nearby-err',
  conversationId: 'test-nearby-err-conv',
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
      console.log('error:', JSON.stringify(j.error));
      console.log('debug:', JSON.stringify(j.debug));
      console.log('stages:', JSON.stringify(j.stages));
      console.log('card:', JSON.stringify(j.card)?.slice(0,300));
      console.log('render_mode:', j.render_mode);
      console.log('template_id:', j.template_id);
      console.log('html_fallback:', (j.html_fallback || '').slice(0, 200));
    } catch(e) {
      console.log('Raw:', d.slice(0, 500));
    }
    process.exit(0);
  });
});
req.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(60000, () => { console.error('TIMEOUT'); req.destroy(); });
req.write(payload);
req.end();
