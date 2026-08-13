#!/bin/bash
sleep 2
echo "=== Weather Action Test ==="
START=$(date +%s%3N)
timeout 20 curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d '{
    "action_key": "travel_route.check_weather_risk",
    "params": { "city": "广西防城港", "days": "3" },
    "user_prompt": "查天气",
    "execute_action": true,
    "conversation_id": "test-wx-fast3",
    "roleKey": "family"
  }' > /tmp/wxtest.json 2>&1
RC=$?
END=$(date +%s%3N)
echo "HTTP response time: $((END - START))ms"
echo "curl RC: $RC"

python3 << 'PYEOF'
import json
try:
    with open('/tmp/wxtest.json') as f:
        d = json.load(f)
    env = d.get('envelope', d)
    print('skill:', env.get('skill_key', ''))
    print('template:', env.get('template_id', '') or env.get('card',{}).get('templateId',''))
    print('answer:', (env.get('answer_text', '') or '')[:100])
    if 'weather' in (env.get('template_id','') or '').lower():
        print('✅ 天气卡片')
    elif 'dispatch' in (env.get('skill_key','') or '').lower():
        print('❌ 串到派单')
except Exception as e:
    print(f'parse error: {e}')
PYEOF
