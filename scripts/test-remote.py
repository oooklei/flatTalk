import requests, json

url = "http://localhost:5298/api/chat/message"
payload = {"message": "旅居规划", "roleKey": "elder", "userId": "test-user"}
r = requests.post(url, json=payload, timeout=60)
d = r.json()

result = {
    "scene_key": d.get("scene_key"),
    "intent": d.get("intent"),
    "template_id": d.get("template_id"),
    "routed": d.get("routed"),
    "has_html": bool(d.get("html")),
    "has_static_svg": bool(d.get("data", {}).get("static_svg")) if isinstance(d.get("data"), dict) else False,
    "map_mode": d.get("data", {}).get("map_mode") if isinstance(d.get("data"), dict) else None,
    "data_keys": list(d.get("data", {}).keys())[:20] if isinstance(d.get("data"), dict) else [],
    "followup_count": len(d.get("followup_suggestions", [])),
    "action_count": len(d.get("actions", [])),
}

with open("D:/GuiCare/flatTalk/scripts/test-result5.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2, default=str)
print("done")
