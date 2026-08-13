#!/bin/bash
sleep 5
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"推荐0730测试旅居路线","session_id":"test-h5-url","role":"family"}' \
  > /tmp/h5test.json 2>&1

python3 << 'PYEOF'
import json, re
with open('/tmp/h5test.json') as f:
    d = json.load(f)
html = d.get('rendered_html', '') or ''
urls = re.findall(r'https://lvjutest[^"\'<>\s\\]+', html)
print('=== H5 URLs ===')
if not urls:
    print('(no H5 urls in HTML)')
for u in set(urls):
    has_hash = '#/pages/' in u
    print(f'  {"✅" if has_hash else "❌"} {u}')
PYEOF
