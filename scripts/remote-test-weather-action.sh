#!/bin/bash
sleep 5

# 1. 先发一条旅居规划消息，拿到 route_card
echo "=== Step 1: 发送旅居规划消息 ==="
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"推荐京族滨海文化线","session_id":"test-weather-route","role":"family","conversationHistory":[]}' \
  > /tmp/step1.json 2>&1

CONV_ID=$(python3 -c "import json; print(json.load(open('/tmp/step1.json')).get('conversation_id',''))")
echo "conversation_id: $CONV_ID"

# 2. 模拟点击"查天气风险"按钮
echo ""
echo "=== Step 2: 点击天气风险按钮 ==="
curl -sk -X POST https://localhost:5445/api/chat/followup \
  -H 'Content-Type: application/json' \
  -d "{
    \"message\": \"请检查这条旅居路线近期天气风险\",
    \"user_prompt\": \"请检查这条旅居路线近期天气风险\",
    \"action_key\": \"travel_route.check_weather_risk\",
    \"skill_key\": \"travel_route\",
    \"params\": { \"city\": \"广西防城港\" },
    \"execute_action\": true,
    \"reenter_chat\": false,
    \"followup_source\": \"action_button\",
    \"conversation_id\": \"$CONV_ID\",
    \"conversationHistory\": [{\"message\":\"推荐京族滨海文化线\",\"role\":\"user\"},{\"message\":\"已推荐路线\",\"role\":\"assistant\"}]
  }" \
  > /tmp/step2.json 2>&1

# 3. 分析结果
echo ""
echo "=== Step 3: 分析结果 ==="
python3 << 'PYEOF'
import json
with open('/tmp/step2.json') as f:
    d = json.load(f)

print('skill_key:', d.get('skill_key'))
print('template_id:', d.get('card',{}).get('templateId',''))
print('answer_text:', (d.get('answer_text','') or '')[:100])

# 检查是否串到派单
sk = d.get('skill_key','')
if sk == 'travel_route':
    print('\n✅ 正确：留在 travel_route 场景')
elif sk == 'dispatch_manage':
    print('\n❌ 错误：串到了 dispatch_manage（派单）')
else:
    print(f'\n⚠️ 意外场景: {sk}')

# 检查天气卡片
tpl = d.get('card',{}).get('templateId','')
if 'weather' in tpl:
    print(f'✅ 天气卡片: {tpl}')
elif 'dispatch' in tpl or 'work_order' in tpl:
    print(f'❌ 派单卡片: {tpl}')
else:
    print(f'⚠️ 其他卡片: {tpl}')
PYEOF
