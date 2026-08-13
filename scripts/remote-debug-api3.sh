#!/bin/bash
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮老人规划广西巴马康养旅居路线","session_id":"debug-map-05","role":"family"}' \
  > /tmp/api-resp3.json 2>&1

python3 -c "
import json
with open('/tmp/api-resp3.json') as f:
    d = json.load(f)

# 顶层 rendered_html
rh = d.get('rendered_html', '') or ''
print('=== 顶层 rendered_html ===')
print('len:', len(rh))
print('has mk-map:', 'mk-map' in rh)
print('has TMap:', 'TMap' in rh)
print('has map-bridge:', 'map-bridge' in rh)

# 顶层 data
td = d.get('data', {})
print()
print('=== 顶层 data ===')
if isinstance(td, dict):
    print('keys:', list(td.keys())[:15])
    print('source:', td.get('source'))
    print('map_mode:', td.get('map_mode'))
    wp = td.get('waypoints', [])
    print('waypoints:', len(wp) if isinstance(wp, list) else type(wp))
    if isinstance(wp, list) and len(wp) > 0:
        print('wp[0]:', json.dumps(wp[0], ensure_ascii=False)[:200])
elif isinstance(td, list):
    print('data is list, len:', len(td))
    if len(td) > 0:
        print('data[0] keys:', list(td[0].keys()) if isinstance(td[0], dict) else type(td[0]))
else:
    print('data type:', type(td))

# card.pages[0] 完整检查
pages = d.get('card', {}).get('pages', [])
print()
print('=== card.pages[0] HTML 检查 ===')
if pages:
    html = pages[0]
    print('html len:', len(html))
    print('has mk-map-canvas:', 'mk-map-canvas' in html)
    print('has map-canvas:', 'map-canvas' in html)
    print('has map-bridge:', 'map-bridge' in html)
    print('has TMap:', 'TMap' in html)
    print('has qq.com:', 'qq.com' in html)
    print('has data-map-mode:', 'data-map-mode' in html)
    print('has data-waypoints:', 'data-waypoints' in html)
    print('has map-kit.css:', 'map-kit' in html)
    print('has style:', '<style' in html)
    print('has script:', '<script' in html)
    # 找 map 相关内容
    import re
    map_matches = re.findall(r'(map[_-]\w+)', html, re.IGNORECASE)
    print('map-related tokens:', set(map_matches))
    # 打印 body 部分
    body_start = html.find('<body')
    if body_start > 0:
        print()
        print('=== body 前500字符 ===')
        print(html[body_start:body_start+500])
else:
    print('No pages!')
"
