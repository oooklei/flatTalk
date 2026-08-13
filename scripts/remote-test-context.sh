#!/bin/bash
sleep 8

echo "=== 多轮对话上下文测试 ==="
echo ""
echo "--- Step 1: 首轮推荐 ---"
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "推荐广西巴马康养旅居路线",
    "session_id": "test-ctx-1",
    "conversationId": "test-ctx-conv1",
    "roleKey": "family",
    "conversationHistory": []
  }' > /tmp/ctx1.json 2>&1
CONV_ID=$(python3 -c "import json; print(json.load(open('/tmp/ctx1.json')).get('conversation_id','test-ctx-conv1'))")
ANSWER1=$(python3 -c "import json; print((json.load(open('/tmp/ctx1.json')).get('answer_text','') or '')[:60])")
echo "conv: $CONV_ID"
echo "answer1: $ANSWER1"

echo ""
echo "--- Step 2: 追问（带 conversationHistory）---"
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d "{
    \"message\": \"那边的景点有什么特色\",
    \"session_id\": \"test-ctx-1\",
    \"conversationId\": \"$CONV_ID\",
    \"roleKey\": \"family\",
    \"conversationHistory\": [
      {\"role\": \"user\", \"content\": \"推荐广西巴马康养旅居路线\"},
      {\"role\": \"assistant\", \"content\": \"$ANSWER1\"}
    ]
  }" > /tmp/ctx2.json 2>&1

python3 << 'PYEOF'
import json
with open('/tmp/ctx2.json') as f:
    d = json.load(f)
answer = (d.get('answer_text','') or '')[:200]
skill = d.get('skill_key','') or d.get('context_snapshot',{}).get('scene','')
template = d.get('template_id','')

print(f'skill: {skill}')
print(f'template: {template}')
print(f'answer: {answer}')

# 判断上下文是否连贯
if '巴马' in answer or '百魔洞' in answer or '水晶宫' in answer or '盘阳河' in answer:
    print('\n✅ 上下文连贯：追问正确关联了巴马旅居路线')
else:
    print('\n⚠️ 需检查：追问未关联前文主题')
PYEOF

echo ""
echo "--- Step 3: 第二轮追问（无 conversationHistory，测 sessionStore fallback）---"
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d "{
    \"message\": \"天气怎么样\",
    \"session_id\": \"test-ctx-1\",
    \"conversationId\": \"$CONV_ID\",
    \"roleKey\": \"family\",
    \"conversationHistory\": []
  }" > /tmp/ctx3.json 2>&1

python3 << 'PYEOF'
import json
with open('/tmp/ctx3.json') as f:
    d = json.load(f)
answer = (d.get('answer_text','') or '')[:200]
skill = d.get('skill_key','') or d.get('context_snapshot',{}).get('scene','')

print(f'skill: {skill}')
print(f'answer: {answer}')

if '巴马' in answer or '天气' in answer or '广西' in answer:
    print('\n✅ sessionStore fallback：无前端历史也能关联上下文')
else:
    print('\n⚠️ sessionStore fallback 未生效')
PYEOF
