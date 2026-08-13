import http from 'node:http';
import fs from 'node:fs';

const body = JSON.stringify({ message: '旅居规划', roleKey: 'elder', userId: 'test-user' });
const options = { hostname: 'localhost', port: 5298, path: '/api/chat/message', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    try {
      const d = JSON.parse(data);
      const result = {
        template_id: d.template_id,
        scene_key: d.scene_key,
        map_mode: d.data?.map_mode,
        has_static_svg: !!d.data?.static_svg,
        static_svg_length: d.data?.static_svg?.length || 0,
        followup_count: (d.followup_suggestions || []).length,
        action_count: (d.actions || []).length,
      };
      fs.writeFileSync('D:/GuiCare/flatTalk/scripts/test-result6.json', JSON.stringify(result, null, 2));
    } catch (e) {
      fs.writeFileSync('D:/GuiCare/flatTalk/scripts/test-result6.json', JSON.stringify({ error: e.message, raw: data.slice(0, 300) }));
    }
  });
});
req.on('error', (e) => {
  fs.writeFileSync('D:/GuiCare/flatTalk/scripts/test-result6.json', JSON.stringify({ error: e.message }));
});
req.write(body);
req.end();
