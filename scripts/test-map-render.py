#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证旅居模板渲染输出：fillTemplateSlots + 静态图/TMap SDK 可达性
（test-map-render.mjs 的 Python 等价实现）

用法：python scripts/test-map-render.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

client = FlatTalkClient()

# 模拟 LLM 返回 template_id='travel_base_card' 的场景
result = client.fill_template_slots(
    template_id="travel_base_card",
    message="推荐防城港康养基地",
    business_data={},
)
data = result.get("data") or {}

print("=== fillTemplateSlots 返回结果 ===")
print("template_id:", result.get("template_id"))
print("data keys:", list(data.keys()))
_map_key = data.get("map_key")
print("map_key:", f"YES ({str(_map_key)[:15]}...)" if _map_key else "NO")
print("centerLat:", data.get("centerLat"))
print("centerLng:", data.get("centerLng"))
print("centerName:", data.get("centerName"))
_static_url = data.get("static_map_url")
print(
    "static_map_url:",
    f"YES ({str(_static_url)[:60]}...)" if _static_url else "NO (empty)",
)
print("markers count:", len(data.get("map_markers") or []))

# 检查 static_map_url 可达性
if _static_url:
    try:
        res = requests.get(_static_url, timeout=30)
        print("\n=== 静态图可达性 ===")
        print("HTTP status:", res.status_code)
        print("content-type:", res.headers.get("content-type"))
        print("image size:", len(res.content), "bytes")
    except requests.RequestException as e:
        print("\n=== 静态图请求失败 ===")
        print("error:", e)

# 检查 TMap SDK URL 是否可访问
if _map_key:
    sdk_url = f"https://map.qq.com/api/gljs?v=1.exp&key={_map_key}&libraries=visualization"
    try:
        res = requests.get(sdk_url, timeout=30)
        print("\n=== TMap SDK 可达性 ===")
        print("HTTP status:", res.status_code)
        print("content-type:", res.headers.get("content-type"))
        text = res.text
        print("SDK script length:", len(text), "chars")
        print("SDK starts with:", text[:50])
    except requests.RequestException as e:
        print("\n=== TMap SDK 请求失败 ===")
        print("error:", e)

sys.exit(0)
