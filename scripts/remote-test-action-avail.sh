#!/bin/bash
RESP=$(curl -sk -X POST https://localhost:5445/api/chat/action \
  -H 'Content-Type: application/json' \
  -d '{"action_key":"check_availability","skill_key":"travel_route","action_params":{"product_id":"2070305000000000271"},"conversation_id":"test-avail-3"}' \
  -o /tmp/avail-resp.json -w '%{http_code} %{time_total}' 2>&1)
echo "HTTP/Time: $RESP"
echo "---"
python3 -c "
import json
with open('/tmp/avail-resp.json') as f:
    d = json.load(f)
print('ok:', d.get('ok'))
print('error:', d.get('error','(none)'))
env = d.get('envelope',{})
print('template:', env.get('template_id',''))
print('skill:', env.get('skill_key',''))
ans = env.get('answer_text','') or d.get('answer_text','')
print('answer:', ans[:200])
"
