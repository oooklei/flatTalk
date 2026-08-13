#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
诊断 fillTemplateSlots 完整返回值
（diag-fill-slots.mjs 的 Python 等价实现）

用法：python scripts/diag-fill-slots.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

MESSAGE = "推荐广西巴马三日康养旅居路线"


def main() -> int:
    client = FlatTalkClient(timeout=180)

    # 测试1: 传 template_id='sojourn_route'
    print("=== 测试1: template_id=sojourn_route ===")
    r1 = client.fill_template_slots(
        message=MESSAGE,
        template_id="sojourn_route",
        business_data={"primary_city": "广西巴马"},
    )
    print("完整返回:", json.dumps(r1, ensure_ascii=False, indent=2)[:800])

    # 测试2: 传 template_id='route_card'
    print("\n=== 测试2: template_id=route_card ===")
    r2 = client.fill_template_slots(
        message=MESSAGE,
        template_id="route_card",
        business_data={"primary_city": "广西巴马"},
    )
    print("template_id:", (r2 or {}).get("template_id"))
    print("data 字段数:", len(((r2 or {}).get("data") or {})))

    # 测试3: 不传 template_id，只传 template_library
    print("\n=== 测试3: template_library 方式 ===")
    r3 = client.fill_template_slots(
        message=MESSAGE,
        template_library=[{"id": "sojourn_route", "match": "旅居 路线 康养"}],
        business_data={"primary_city": "广西巴马"},
    )
    print("template_id:", (r3 or {}).get("template_id"))
    print("data 字段数:", len(((r3 or {}).get("data") or {})))
    return 0


if __name__ == "__main__":
    sys.exit(main())
