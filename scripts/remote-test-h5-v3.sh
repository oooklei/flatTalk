#!/bin/bash
sleep 3
curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d '{
    "action_key": "travel_route.booking_handoff",
    "params": { "product_id": "2070305000000000271", "destination": "广西桂林" },
    "label": "预订",
    "user_prompt": "我要预订",
    "execute_action": true,
    "reenter_chat": false,
    "conversation_id": "conv_test_h5_v3",
    "roleKey": "family",
    "channel": "mobile"
  }' > /tmp/h5v3.json 2>&1

python3 << 'PYEOF'
import json, re
with open('/tmp/h5v3.json') as f:
    d = json.load(f)

env = d.get('envelope', {})
html = env.get('rendered_html', '') or ''

# Extract all lvjutest URLs
urls = set(re.findall(r'https://lvjutest[^"\'<>\s\\]*', html))
print('=== All H5 URLs in rendered HTML ===')
for u in sorted(urls):
    if '#/pages/' in u:
        print(f'  ✅ {u}')
    elif '/pages/' in u:
        print(f'  ❌ {u}')
PYEOF
