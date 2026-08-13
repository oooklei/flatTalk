#!/usr/bin/env python3
"""测试 /api/chat/action 的 check_availability 功能。

Python 版，替代 test-action-node.js。
用法: python scripts/test-action-node.py
"""
import json
import sys

import requests

API_HOST = "localhost"
API_PORT = 5298
PATH = "/api/chat/action"

payload = {
    "action_key": "check_availability",
    "skill_key": "travel_route",
    "action_params": {"product_id": "2070305000000000271"},
    "conversation_id": "test-avail-node",
}

try:
    resp = requests.post(
        f"http://{API_HOST}:{API_PORT}{PATH}",
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    print("Status:", resp.status_code)
    try:
        j = resp.json()
        print("ok:", j.get("ok"))
        print("error:", j.get("error", "(none)"))
        envelope = j.get("envelope") or {}
        print("template:", envelope.get("template_id", ""))
        answer = envelope.get("answer_text") or j.get("answer_text") or ""
        print("answer:", answer[:200])
    except ValueError:
        print("Raw:", resp.text[:300])
except requests.RequestException as e:
    print("ERROR:", e)
    sys.exit(1)
