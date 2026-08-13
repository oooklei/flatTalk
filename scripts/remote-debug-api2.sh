#!/bin/bash
# 打印完整API返回的JSON结构（关键字段）
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮老人规划广西巴马康养旅居路线","session_id":"debug-map-04","role":"family"}' \
  > /tmp/api-resp2.json 2>&1

python3 -c "
import json
with open('/tmp/api-resp2.json') as f:
    d = json.load(f)

# 打印所有顶层key
print('=== 顶层keys ===')
print(list(d.keys()))

# card 结构
card = d.get('card', {})
print()
print('=== card keys ===')
print(list(card.keys()))

# 打印 card 的每个字段（截断长值）
for k, v in card.items():
    sv = str(v)
    if len(sv) > 200:
        sv = sv[:200] + '...'
    print(f'card.{k}: {sv}')

# 检查是否有 card.pages 或 card.html
print()
print('=== 寻找HTML ===')
print('card.pages:', type(card.get('pages')))
print('card.html len:', len(card.get('html','') or ''))
print('card.rendered_html len:', len(card.get('rendered_html','') or ''))

# 检查 data 的实际结构
data = card.get('data', {})
print()
print('=== data keys ===')
print(list(data.keys()) if isinstance(data, dict) else type(data))
if isinstance(data, dict):
    for k in list(data.keys())[:20]:
        v = data[k]
        sv = str(v)
        if len(sv) > 100:
            sv = sv[:100] + '...'
        print(f'data.{k}: {sv}')

# 检查 interactions / actions
print()
print('=== interactions ===')
for a in d.get('interactions', []):
    print(a.get('action_key',''), a.get('label',''))
"
