#!/bin/bash
sleep 8

echo "=== 测试：桂林附近有什么医院 ==="
curl -sk -X POST https://localhost:5445/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "桂林附近有什么医院",
    "session_id": "test-guilin-hospital",
    "conversationId": "test-guilin-hospital-conv",
    "roleKey": "family"
  }' > /tmp/guilin.json 2>&1

python3 << 'PYEOF'
import json
with open('/tmp/guilin.json') as f:
    d = json.load(f)
env = d.get('envelope', d)
answer = (d.get('answer_text','') or env.get('answer_text',''))[:200]
template = d.get('template_id','') or env.get('template_id','')
skill = d.get('skill_key','') or env.get('skill_key','') or d.get('context_snapshot',{}).get('scene','')
html = env.get('rendered_html','') or ''

print(f'skill: {skill}')
print(f'template: {template}')
print(f'answer: {answer}')

# 检查是否有桂林的医院
import re
if '桂林' in html or '医院' in html:
    # 提取 markers 中的 POI 名称
    names = re.findall(r'"name"\s*:\s*"([^"]*)"', html)
    if names:
        print(f'\n=== POI 名称 ({len(names)}) ===')
        for n in names[:10]:
            print(f'  {n}')

    # 检查中心坐标
    center = re.findall(r'"lat"\s*:\s*([\d.]+).*?"lng"\s*:\s*([\d.]+)', html)
    if center:
        lat, lng = center[0]
        print(f'\n中心坐标: lat={lat}, lng={lng}')
        if float(lat) > 24.5 and float(lng) > 109.5:
            print('✅ 桂林区域坐标')
        elif float(lat) < 22 and float(lng) < 109:
            print('❌ 仍为嘉路康养中心坐标')
else:
    print('\n⚠️ 未找到桂林或医院相关内容')
PYEOF
