const http = require('http');
const payload = JSON.stringify({
  message: '嘉路康养中心周边有什么医院',
  session_id: 'test-nearby-map',
  conversationId: 'test-nearby-map-conv',
  roleKey: 'family',
});
console.log('Sending...');
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
    try {
      const j = JSON.parse(d);
      const env = j.envelope || {};
      console.log('template:', env.template_id);
      console.log('skill:', env.skill_key || j.skill_key);
      const html = env.rendered_html || '';
      require('fs').writeFileSync('/tmp/nearby-map-output.html', html);
      console.log('HTML length:', html.length);
      console.log('Has map_key:', html.includes('KI4BZ'));
      console.log('Has markers_json:', html.includes('markers_json'));
      // 提取 markers_json 内容
      const m = html.match(/id="nearby-data"[^>]*>([\s\S]*?)<\/script>/);
      if (m) console.log('markers_json preview:', m[1].slice(0, 200));
      // 提取 center_json
      const c = html.match(/id="nearby-center"[^>]*>([\s\S]*?)<\/script>/);
      if (c) console.log('center_json:', c[1].trim());
      // map_key 值
      const mk = html.match(/MAP_KEY\s*=\s*'([^']*)'/);
      if (mk) console.log('MAP_KEY value:', mk[1]);
    } catch(e) {
      console.log('Parse error:', e.message);
      console.log('Raw:', d.slice(0, 300));
    }
    process.exit(0);
  });
});
req.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(60000, () => { console.error('TIMEOUT 60s'); req.destroy(); });
req.write(payload);
req.end();
