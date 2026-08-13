#!/bin/bash
sleep 2
curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d '{
    "action_key": "travel_route.booking_handoff",
    "params": { "product_id": "2070305000000000271", "destination": "广西桂林" },
    "label": "预订",
    "user_prompt": "我要预订",
    "execute_action": true,
    "conversation_id": "conv-test-order-v2",
    "roleKey": "family"
  }' > /tmp/orderv2.json 2>&1

python3 << 'PYEOF'
import json, re, html as htmlmod
with open('/tmp/orderv2.json') as f:
    d = json.load(f)
env = d.get('envelope', d)
raw_html = env.get('rendered_html', '') or ''

# Decode HTML entities
decoded = htmlmod.unescape(raw_html)

# Find data-h5-url
data_urls = re.findall(r'data-h5-url="([^"]*)"', decoded)
print('=== data-h5-url (decoded) ===')
for u in data_urls:
    print(f'  {u}')

# Find iframe src
srcs = re.findall(r'<iframe[^>]*src="([^"]*)"', decoded)
print('\n=== iframe src (decoded) ===')
for s in srcs:
    print(f'  {s}')

# Find all lvjutest URLs
urls = re.findall(r'https://lvjutest[^"\s<]+', decoded)
print('\n=== all lvjutest URLs ===')
for u in set(urls):
    if 'order' in u:
        print(f'  ❌ ORDER: {u}')
    elif 'product/detail' in u:
        print(f'  ✅ PRODUCT: {u}')
    else:
        print(f'  ? {u}')
PYEOF
