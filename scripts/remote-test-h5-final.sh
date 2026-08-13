#!/bin/bash
sleep 8
echo "=== booking_handoff test ==="
curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d '{
    "action_key": "travel_route.booking_handoff",
    "params": { "product_id": "2070305000000000271", "destination": "广西桂林" },
    "label": "预订",
    "user_prompt": "我要预订",
    "execute_action": true,
    "reenter_chat": false,
    "conversation_id": "conv-test-h5-final",
    "roleKey": "family",
    "channel": "mobile"
  }' > /tmp/h5final.json 2>&1

python3 << 'PYEOF'
import json, re
with open('/tmp/h5final.json') as f:
    d = json.load(f)
env = d.get('envelope', d)
html = env.get('rendered_html', '') or ''

# Find all lvjutest URLs
urls = set(re.findall(r'https://lvjutest[^"\'<>\s\\]*', html))
print('=== H5 URLs ===')
for u in sorted(urls):
    if 'order' in u:
        print(f'  ❌ ORDER PAGE: {u}')
    elif 'product/detail' in u:
        print(f'  ✅ PRODUCT PAGE: {u}')
    else:
        print(f'  ? {u}')

if not urls:
    print('  (no H5 URLs found)')
PYEOF
