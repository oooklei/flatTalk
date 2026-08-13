#!/bin/bash
sleep 3
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"推荐京族滨海文化线","session_id":"test-spot-filter2","role":"family"}' \
  > /tmp/spot-test.json 2>&1

python3 << 'PYEOF'
import json, re

with open('/tmp/spot-test.json') as f:
    d = json.load(f)

html = d.get('rendered_html', '') or ''

# 找所有 "name":"xxx" 在 spots 相关区域
spot_names = re.findall(r'"name":"([^"]+)"', html)

spam_keywords = ['whatsapp', '報名', '熱線', '华侨城', 'logo', '旅行團', '报名', '热线']
spam_hits = [n for n in spot_names if any(k in n.lower() for k in spam_keywords)]

print('=== 景点过滤验证 ===')
print('spot count:', len(spot_names))
print('spam hits:', spam_hits if spam_hits else 'NONE (过滤生效)')
print('first 8 spots:', spot_names[:8])
PYEOF
