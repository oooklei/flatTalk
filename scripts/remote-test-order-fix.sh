#!/bin/bash
sleep 2
echo "=== 检查 booking_handoff iframe URL ==="
curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d '{
    "action_key": "travel_route.booking_handoff",
    "params": { "product_id": "2070305000000000271", "destination": "广西桂林" },
    "label": "预订",
    "user_prompt": "我要预订",
    "execute_action": true,
    "conversation_id": "conv-test-order-fix",
    "roleKey": "family"
  }' > /tmp/ordercheck.json 2>&1

python3 << 'PYEOF'
import json, re
with open('/tmp/ordercheck.json') as f:
    d = json.load(f)
env = d.get('envelope', d)
html = env.get('rendered_html', '') or ''

# 找所有 URL
urls = re.findall(r'https://lvjutest[^"\'<>\s\\]*', html)
print('=== ALL URLs ===')
for u in set(urls):
    if 'order' in u.lower():
        print(f'  ❌ ORDER: {u}')
    elif 'product/detail' in u:
        print(f'  ✅ PRODUCT: {u}')
    else:
        print(f'  ? {u}')

# 检查 iframe src
iframes = re.findall(r'<iframe[^>]*src=["\']?([^"\'>\s]+)', html)
print('\n=== iframe src ===')
for s in iframes:
    print(f'  {s}')

# 检查是否有 h5Url 变量赋值
h5vars = re.findall(r'h5Url\s*=\s*["\']([^"\']+)', html)
print('\n=== h5Url vars ===')
for v in h5vars:
    print(f'  {v}')

# 检查 data-h5-url 属性
dataUrls = re.findall(r'data-h5-url=["\']([^"\']+)', html)
print('\n=== data-h5-url ===')
for d2 in dataUrls:
    print(f'  {d2}')
PYEOF
