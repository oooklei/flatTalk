#!/bin/bash
curl -s -X POST http://localhost:5299/api/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我规划旅居路线","roleKey":"elder","userId":"test-user"}' \
  | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("scene_key:", d.get("scene_key","?"))
print("intent:", d.get("intent","?"))
print("routed:", d.get("routed","?"))
print("template_id:", d.get("template_id","?"))
print("--- stages ---")
for s in d.get("stages",[]):
  print(f"  {s.get(\"stage\")} | {s.get(\"label\")} | {s.get(\"detail\")}")
print("--- debug ---")
db = d.get("debug",{})
print("scene_confidence:", db.get("scene_confidence"))
print("knowledge_status:", db.get("knowledge_status"))
print("intent_type:", db.get("intent_context",{}).get("intent_type"))
'
