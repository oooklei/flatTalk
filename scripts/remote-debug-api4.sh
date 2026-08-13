#!/bin/bash
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮老人规划广西巴马康养旅居路线","session_id":"debug-07","role":"family"}' \
  > /tmp/api-resp4.json 2>&1

python3 -c "
import json
with open('/tmp/api-resp4.json') as f:
    d = json.load(f)

card = d.get('card', {})
print('card.templateId:', card.get('templateId'))
print('card.reason:', card.get('reason'))
print('model_status:', d.get('llm',{}).get('model_status','') if isinstance(d.get('llm'), dict) else '')
print()

# 检查 waypoints_json
data = d.get('data', {})
print('waypoints count:', len(data.get('waypoints', [])))
print('has waypoints_json:', 'waypoints_json' in data)
print('has polyline_json:', 'polyline_json' in data)
print('has map_mode:', 'map_mode' in data)
print('has center:', 'center' in data)
print('has fit_bounds:', 'fit_bounds' in data)
print('has route_plan_url:', 'route_plan_url' in data)
print()

# 检查 HTML 中的地图变量
html = d.get('rendered_html', '') or ''
# 找 var WAYPOINTS 或类似
import re
wp_vars = re.findall(r'var\s+(\w*WAYPOINT\w*|\w*waypoint\w*|\w*POLYLINE\w*)\s*=', html, re.IGNORECASE)
print('JS map vars found:', wp_vars)

# 找 routeMapCanvas
print('has routeMapCanvas:', 'routeMapCanvas' in html)
print('has CENTER:', 'var CENTER' in html or 'CENTER =' in html)
print('has POLYLINE_PATH:', 'POLYLINE_PATH' in html)
print('has FIT_BOUNDS:', 'FIT_BOUNDS' in html)

# 打印地图相关 script 片段
idx = html.find('routeMapCanvas')
if idx > 0:
    print()
    print('=== routeMapCanvas 上下文 ===')
    print(html[max(0,idx-200):idx+300])
"
