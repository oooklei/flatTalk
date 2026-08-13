#!/bin/bash
# 远程API调试：检查返回的template/source/map数据
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮老人规划广西巴马康养旅居路线","session_id":"debug-map-03","role":"family"}' \
  > /tmp/api-resp.json 2>&1

python3 -c "
import json
with open('/tmp/api-resp.json') as f:
    d = json.load(f)

card = d.get('card', {})
data = card.get('data', {})
html = card.get('rendered_html', '')

print('=== 顶层字段 ===')
print('ok:', d.get('ok'))
print('skill_key:', d.get('skill_key'))
print('answer_text:', (d.get('answer_text','') or '')[:100])

print()
print('=== 卡片信息 ===')
print('templateId:', card.get('templateId'))
print('source:', data.get('source'))
print('map_mode:', data.get('map_mode'))
print('waypoints count:', len(data.get('waypoints', [])))
print('route_summary:', (data.get('route_summary','') or '')[:80])

print()
print('=== HTML 检查 ===')
print('html_len:', len(html))
print('has mk-map-canvas:', 'mk-map-canvas' in html)
print('has map-canvas:', 'map-canvas' in html)
print('has map-bridge.js:', 'map-bridge.js' in html or 'map-bridge' in html)
print('has TMap:', 'TMap' in html)
print('has qq.com map:', 'qq.com' in html)
print('has data-map-mode:', 'data-map-mode' in html)
print('has data-waypoints:', 'data-waypoints' in html)
print('has iframe:', '<iframe' in html)
print('has style tag:', '<style' in html)
print('has script tag:', '<script' in html)

# 看前2000字符
print()
print('=== HTML 前2000字符 ===')
print(html[:2000])
"
