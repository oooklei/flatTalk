#!/usr/bin/env python3
"""测试本地 /api/chat/message 旅居规划响应，定位 LLM 返回结构。

Python 版，替代 test-local-api.mjs。
用法: python scripts/test-local-api.py
"""
import json
import sys
from pathlib import Path

import requests

API_HOST = "localhost"
API_PORT = 5298
PATH = "/api/chat/message"
OUT_FILE = Path(__file__).parent / "test-result6.json"

payload = {"message": "旅居规划", "roleKey": "elder", "userId": "test-user"}

try:
    resp = requests.post(
        f"http://{API_HOST}:{API_PORT}{PATH}",
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=60,
    )
    try:
        d = resp.json()
        data = d.get("data") or {}
        result = {
            "template_id": d.get("template_id"),
            "scene_key": d.get("scene_key"),
            "map_mode": data.get("map_mode"),
            "has_static_svg": bool(data.get("static_svg")),
            "static_svg_length": len(data.get("static_svg") or ""),
            "followup_count": len(d.get("followup_suggestions") or []),
            "action_count": len(d.get("actions") or []),
        }
    except ValueError:
        result = {"error": "JSON parse failed", "raw": resp.text[:300]}
except requests.RequestException as e:
    result = {"error": str(e)}

OUT_FILE.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print("done")
