#!/bin/bash
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"推荐京族滨海文化线","session_id":"test-spot-filter3","role":"family"}' \
  > /tmp/spot-test3.json 2>&1

python3 << 'PYEOF'
import json, re

with open('/tmp/spot-test3.json') as f:
    d = json.load(f)

html = d.get('rendered_html', '') or ''

# 找 spots JSON 数据块
spot_json_match = re.findall(r'spots.*?(\[.*?\])', html[:50000], re.DOTALL)

# 找所有 title 或 name 字段
all_titles = re.findall(r'(?:title|name)["\']?\s*:\s*["\']([^"\']{3,})["\']', html)

# 找 Tavily 日志
tavily_log = re.findall(r'jtd-tavily.*?(?:拉到|完成).*', html)

print('=== HTML 分析 ===')
print('html len:', len(html))
print('has spots keyword:', 'spots' in html)
print('has 特色景点:', '特色景点' in html)
print('has waypoint:', 'waypoint' in html.lower() or 'WAYPOINTS' in html)
print('all titles/names found:', len(all_titles))
print('first 10:', all_titles[:10])
print()

# 检查垃圾关键词是否还在
spam_kw = ['whatsapp', '報名', '熱線', '华侨城旅游网', '广东旅行团']
for kw in spam_kw:
    if kw.lower() in html.lower():
        print(f'!!! 仍含垃圾词: {kw}')
    else:
        print(f'OK 已清除: {kw}')
PYEOF
