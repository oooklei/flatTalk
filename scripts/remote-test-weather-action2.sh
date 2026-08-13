#!/bin/bash
sleep 6

# 1. 先发旅居规划
echo "=== Step 1: 旅居规划 ==="
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"推荐京族滨海文化线","session_id":"test-weather-fix","role":"family","conversationHistory":[]}' \
  > /tmp/wf1.json 2>&1
CONV_ID=$(python3 -c "import json; print(json.load(open('/tmp/wf1.json')).get('conversation_id',''))")
echo "conversation_id: $CONV_ID"

# 2. 模拟 compact_followups 点击天气风险按钮（走 /api/chat/action）
echo ""
echo "=== Step 2: 点击天气风险按钮（action 路径）==="
curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d "{
    \"action_key\": \"travel_route.check_weather_risk\",
    \"params\": { \"city\": \"广西防城港\", \"days\": \"3\" },
    \"label\": \"查天气风险\",
    \"user_prompt\": \"请检查这条旅居路线近期天气风险\",
    \"execute_action\": true,
    \"reenter_chat\": false,
    \"conversation_id\": \"$CONV_ID\",
    \"roleKey\": \"family\",
    \"channel\": \"mobile\",
    \"conversationHistory\": [{\"message\":\"推荐京族滨海文化线\",\"role\":\"user\"}]
  }" \
  > /tmp/wf2.json 2>&1

# 3. 分析
echo ""
echo "=== Step 3: 分析 ==="
python3 << 'PYEOF'
import json
with open('/tmp/wf2.json') as f:
    d = json.load(f)

env = d.get('envelope', d)
sk = env.get('skill_key', d.get('skill_key',''))
tpl = env.get('template_id', env.get('card',{}).get('templateId',''))
answer = env.get('answer_text','') or ''

print('skill_key:', sk)
print('template_id:', tpl)
print('answer (first 120):', answer[:120])

if sk == 'travel_route':
    print('\n✅ 正确：留在 travel_route')
elif sk == 'dispatch_manage':
    print('\n❌ 串到 dispatch_manage')
else:
    print(f'\n⚠️ 场景: {sk}')

if 'weather' in (tpl or ''):
    print(f'✅ 天气卡片: {tpl}')
elif 'dispatch' in (tpl or '') or 'work_order' in (tpl or ''):
    print(f'❌ 派单卡片: {tpl}')

# 检查 route source
route = env.get('route', {})
if route.get('source') == 'action_key_lock':
    print('✅ action_key 锁定生效')
elif route.get('source'):
    print(f'⚠️ route source: {route["source"]}')
PYEOF
