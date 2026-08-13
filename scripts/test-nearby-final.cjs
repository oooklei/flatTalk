const http = require('http');
const payload = JSON.stringify({
  message: '嘉路康养中心周边有什么配套',
  session_id: 'test-nearby-final',
  conversationId: 'test-nearby-final-conv',
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
      console.log('=== top-level rendered_html ===');
      console.log('length:', (j.rendered_html || '').length);
      console.log('preview:', (j.rendered_html || '').slice(0, 300));
      console.log('\n=== top-level html_fallback ===');
      console.log('length:', (j.html_fallback || '').length);
      console.log('preview:', (j.html_fallback || '').slice(0, 300));
      console.log('\n=== card ===');
      console.log('templateId:', j.card?.templateId);
      console.log('pages count:', j.card?.pages?.length);
      console.log('pages[0] length:', (j.card?.pages?.[0] || '').length);
      console.log('\n=== template_id ===');
      console.log('top:', j.template_id);
      console.log('render_mode:', j.render_mode);

      // 保存完整 HTML 供分析
      const fullHtml = j.rendered_html || j.html_fallback || j.card?.pages?.[0] || '';
      require('fs').writeFileSync('/tmp/nearby-full.html', fullHtml);
      console.log('\nSaved full HTML to /tmp/nearby-full.html, length:', fullHtml.length);

      // 检查关键内容
      console.log('\n=== Key checks ===');
      console.log('Has map_key:', fullHtml.includes('KI4BZ'));
      console.log('Has TMap:', fullHtml.includes('TMap'));
      console.log('Has markers_json:', fullHtml.includes('markers_json'));
      console.log('Has mapCanvas:', fullHtml.includes('mapCanvas'));
      console.log('Has gljs:', fullHtml.includes('gljs'));
    } catch(e) {
      console.log('Error:', e.message);
    }
    process.exit(0);
  });
});
req.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(120000, () => { console.error('TIMEOUT 120s'); req.destroy(); });
req.write(payload);
req.end();
