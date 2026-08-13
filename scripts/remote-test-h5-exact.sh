#!/bin/bash
sleep 5
curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d '{
    "action_key": "travel_route.booking_handoff",
    "params": { "product_id": "2070305000000000271", "destination": "广西桂林" },
    "label": "预订",
    "user_prompt": "我要预订",
    "execute_action": true,
    "reenter_chat": false,
    "conversation_id": "conv_test_h5_exact",
    "roleKey": "family",
    "channel": "mobile"
  }' > /tmp/h5exact.json 2>&1

python3 << 'PYEOF'
import json
with open('/tmp/h5exact.json') as f:
    d = json.load(f)

env = d.get('envelope', {})
html = env.get('rendered_html', '') or ''

# 找 iframe 标签
import re
iframes = re.findall(r'<iframe[^>]*>', html)
for i in iframes:
    print('IFRAME TAG:', i[:200])

# 找 src= 属性值
srcs = re.findall(r'src="([^"]*)"', html)
for s in srcs:
    if 'lvjutest' in s or 'h5' in s:
        print('SRC:', s)

# 直接搜索 h5 URL 原始格式
for line in html.split('\n'):
    if 'lvjutest' in line or 'iframe' in line.lower():
        print('LINE:', line.strip()[:200])
PYEOF
