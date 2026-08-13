#!/bin/bash
sleep 3

# 1. 推荐路线
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"推荐0730测试旅居路线","session_id":"test-h5-url2","role":"family"}' \
  > /tmp/h5step1.json 2>&1

CONV_ID=$(python3 -c "import json; print(json.load(open('/tmp/h5step1.json')).get('conversation_id',''))")
echo "conv: $CONV_ID"

# 2. 点击预订按钮（booking_handoff）
curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d "{
    \"action_key\": \"travel_route.booking_handoff\",
    \"params\": { \"product_id\": \"2070305000000000271\", \"destination\": \"广西桂林\" },
    \"label\": \"预订\",
    \"user_prompt\": \"我要预订\",
    \"execute_action\": true,
    \"reenter_chat\": false,
    \"conversation_id\": \"$CONV_ID\",
    \"roleKey\": \"family\",
    \"channel\": \"mobile\"
  }" \
  > /tmp/h5step2.json 2>&1

# 3. 分析
python3 << 'PYEOF'
import json
with open('/tmp/h5step2.json') as f:
    d = json.load(f)

print('result_type:', d.get('result_type'))
print('redirect_url:', d.get('redirect_url', ''))

env = d.get('envelope', {})
html = env.get('rendered_html', '') or ''
data = env.get('data', {}) or {}

# 检查 data 中的 h5 url
handoff = data.get('handoff_urls', {}) or data.get('h5_url', {})
print('handoff_urls:', handoff)

# 检查 HTML 中的 iframe src
import re
iframes = re.findall(r'src=["\']([^"\']*lvjutest[^"\']*)', html)
print('iframe src:', iframes[:3] if iframes else '(none)')

# 检查是否有 #/pages/
all_urls = re.findall(r'https://lvjutest[^"\'<>\s\\]+', html)
for u in set(all_urls):
    has_hash = '#/pages/' in u
    print(f'  {"✅" if has_hash else "❌"} {u}')
PYEOF
