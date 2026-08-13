#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
检查静态图 URL 返回的实际内容
（test-static-map.mjs 的 Python 等价实现）

用法：python scripts/test-static-map.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402


def main() -> int:
    client = FlatTalkClient()

    result = client.fill_template_slots(
        template_id="travel_base_card",
        message="推荐防城港康养基地",
        business_data={},
    ) or {}

    data = result.get("data") or {}
    static_map_url = data.get("static_map_url")

    # 检查静态图 URL 返回内容
    if static_map_url:
        print("=== 静态图 URL ===")
        print(static_map_url)
        print("\n=== 静态图响应内容 ===")
        try:
            res = requests.get(static_map_url, timeout=30)
            print("HTTP status:", res.status_code)
            print("content-type:", res.headers.get("content-type"))
            print("response body:", res.text)
        except requests.RequestException as e:
            print("error:", e)

    # 检查环境变量（Node 进程持有 .env，Python 侧从项目 .env 读取用于诊断）
    print("\n=== 环境变量 ===")
    env_values = dict(os.environ)
    env_file = _ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            key = key.strip()
            if sep and key and key not in env_values:
                env_values[key] = value.strip()

    for key in ("TENCENT_MAP_JS_KEY", "TENCENT_MAP_KEY", "TENCENT_MAP_SK"):
        value = env_values.get(key)
        print(f"{key}:", (value[:10] + "...") if value else "NOT SET")

    return 0


if __name__ == "__main__":
    sys.exit(main())
