#!/usr/bin/env python3
"""「这条线路要多少钱」为什么出 route_compare_card
分别看：templateIdFromAction 给什么、LIS 给什么、flatTalk 端到端给什么。

Python 版，替代 probe-budget.mjs。
用法: python scripts/probe-budget.py
"""
import json
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
BUILD_DIR.mkdir(parents=True, exist_ok=True)

lines = []
client = FlatTalkClient()

# 1. templateIdFromAction 对相关 action 的映射
lines.append("=== templateIdFromAction ===")
for k in [
    "travel_route.calculate_budget",
    "travel_route.compare_destinations",
    "travel_route.check_availability",
]:
    try:
        result = client.template_id_from_action(action_key=k)
        tpl = result.get("template_id", "")
        lines.append(f"  {k.ljust(38)} -> {tpl}")
    except FlatTalkError as e:
        lines.append(f"  {k.ljust(38)} -> ERROR: {e}")

# 2. LIS 直接判定
lines.append("")
lines.append("=== LIS /v1/sort ===")
try:
    resp = requests.post(
        "http://127.0.0.1:8100/v1/sort",
        json={"utterance": "这条线路要多少钱", "context": {"role": "elder", "session_id": "p"}},
        timeout=15,
    )
    lis = resp.json()
    for i in (lis.get("intents") or [])[:3]:
        lines.append(f"  {i.get('intent_id')}({float(i.get('confidence', 0)):.3f}) -> {i.get('template_id')}")
except (requests.RequestException, ValueError) as e:
    lines.append(f"  LIS 不可用: {e}")

# 3. flatTalk 端到端（不带 action_key，纯话语）
lines.append("")
lines.append("=== flatTalk /api/chat/message（无 action_key）===")
try:
    import time
    resp = requests.post(
        "http://127.0.0.1:5298/api/chat/message",
        json={
            "message": "这条线路要多少钱",
            "conversation_id": f"p-{int(time.time() * 1000)}",
            "role": "elder",
        },
        timeout=30,
    )
    ft = resp.json()
    lines.append(f"  intent={ft.get('intent')} template_id={ft.get('template_id')} skill={ft.get('skill_key')}")
    route_str = json.dumps(ft.get("route") or {}, ensure_ascii=False)
    lines.append(f"  route={route_str[:260]}")
except (requests.RequestException, ValueError) as e:
    lines.append(f"  flatTalk 不可用: {e}")

output = "\n".join(lines)
(BUILD_DIR / "budget-probe.txt").write_text(output, encoding="utf-8")
print("done")
