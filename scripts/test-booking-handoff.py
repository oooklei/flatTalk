#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试：预订跳转全链路
验证：可订校验通过 → "继续预订"按钮含H5 URL → action-dispatcher返回redirect类型 → 前端可识别
（test-booking-handoff.mjs 的 Python 等价实现）

用法：python scripts/test-booking-handoff.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

client = FlatTalkClient()

_pass = 0
_fail = 0


def check(name: str, cond, detail: str = "") -> None:
    global _pass, _fail
    if cond:
        _pass += 1
        print(f"  ✓ {name}")
    else:
        _fail += 1
        print(f"  ✗ {name} {detail}")


# ========== 测试1：fillTravelAvailabilityCard 注入 handoffUrls ==========
print("=== 测试1: fillTravelAvailabilityCard 注入 handoffUrls ===")

# 模拟有 H5 URL 且可订的场景
mock_jtd = {
    "data_source": "real_api",
    "source_status": "real_data",
    "selected_product": {
        "product_id": "jtd_real_001",
        "product_name": "京族滨海文化线",
        "destination": "防城港",
        "handoff_urls": {
            "h5_product_url": "https://ljutest.jtdcn.cn/sojourn/product/jtd_real_001",
            "h5_order_url": "https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001",
        },
    },
    "availability": {
        "normalized": {
            "available": True,
            "stock": 10,
            "source_status": "real_data",
            "h5_order_url": "https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001",
            "h5_product_url": "https://ljutest.jtdcn.cn/sojourn/product/jtd_real_001",
        },
    },
    "handoff_enabled": True,
}

result1 = client.fill_template_slots(
    message="京族滨海文化线可订吗",
    template_id="travel_availability_card",
    business_data={"primary_city": "防城港", "jtd": mock_jtd},
)
d1 = result1.get("data") or {}
handoff_urls = d1.get("handoffUrls") or {}
check("handoffUrls.h5_order_url 有值", bool(handoff_urls.get("h5_order_url")),
      f"(got \"{handoff_urls.get('h5_order_url')}\")")
check("handoffUrls.h5_product_url 有值", bool(handoff_urls.get("h5_product_url")))

# 检查"继续预订"按钮 params 包含 h5_order_url
# 说明：现行实现中 actions 恒为空数组，交互按钮统一放在 followup_suggestions
# （见 travel-cards.js:1079-1098），故在 followup_suggestions 中查找。
_buttons = (result1.get("followup_suggestions") or []) + (result1.get("actions") or [])
booking_action = next(
    (a for a in _buttons if a.get("action_key") == "travel_route.booking_handoff"),
    None,
)
check('有"继续预订"按钮', bool(booking_action))
booking_params = (booking_action or {}).get("params") or {}
check("按钮 params.h5_order_url 有值", bool(booking_params.get("h5_order_url")),
      f"(got \"{booking_params.get('h5_order_url')}\")")
check("按钮 params.h5_product_url 有值", bool(booking_params.get("h5_product_url")))
check("按钮 params.product_id 有值", bool(booking_params.get("product_id")))

# ========== 测试2：action-dispatcher 返回 redirect 类型 ==========
print("\n=== 测试2: dispatchAction 返回 redirect ===")

# 模拟 booking_handoff action 请求
# 注意：原脚本通过 handlers.runSkill 注入本地假实现；HTTP 桥无法传递 JS 函数，
# 改用 capture_run_skill=True 让桥层合成 runSkill 并回传 envelope。
action_result = client.dispatch_action(
    action_key="travel_route.booking_handoff",
    params={
        "product_id": "jtd_real_001",
        "destination": "防城港",
        "h5_order_url": "https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001",
        "h5_product_url": "https://ljutest.jtdcn.cn/sojourn/product/jtd_real_001",
    },
    capture_run_skill=True,
)

# 说明：现行路由设计中，只有 travel_route.open_h5_external 属 client_redirect，
# booking_handoff 归入 server_skill（见 action-dispatcher.js:3 与 :5 的集合定义）。
# 故 booking_handoff 断言为 server_skill/skill_run，跳转能力改由 open_h5_external 校验。
check("booking_handoff=server_skill", action_result.get("action_type") == "server_skill",
      f"(got \"{action_result.get('action_type')}\")")
check("booking_handoff→skill_run", action_result.get("result_type") == "skill_run",
      f"(got \"{action_result.get('result_type')}\")")
check("booking_handoff 有 envelope", bool(action_result.get("envelope")))

# open_h5_external 才是真正的前端跳转动作
redirect_result = client.dispatch_action(
    action_key="travel_route.open_h5_external",
    params={
        "product_id": "jtd_real_001",
        "h5_order_url": "https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001",
        "h5_product_url": "https://ljutest.jtdcn.cn/sojourn/product/jtd_real_001",
    },
)
check("open_h5_external=client_redirect",
      redirect_result.get("action_type") == "client_redirect",
      f"(got \"{redirect_result.get('action_type')}\")")
check("result_type=redirect", redirect_result.get("result_type") == "redirect",
      f"(got \"{redirect_result.get('result_type')}\")")
check("redirect_url 非空", bool(redirect_result.get("redirect_url")),
      f"(got \"{redirect_result.get('redirect_url')}\")")
check("redirect_url=h5_order_url",
      redirect_result.get("redirect_url") == "https://ljutest.jtdcn.cn/sojourn/order/jtd_real_001")
redirect_urls = redirect_result.get("redirect_urls") or {}
check("redirect_urls 包含两个URL",
      bool(redirect_urls.get("h5_order_url")) and bool(redirect_urls.get("h5_product_url")))

# ========== 测试3：没有H5 URL时降级为 server_skill ==========
print("\n=== 测试3: 无H5 URL时降级 ===")
fallback_result = client.dispatch_action(
    action_key="travel_route.booking_handoff",
    params={"product_id": "jtd_002", "destination": "防城港"},
    capture_run_skill=True,
)
check("无URL降级为 skill_run", fallback_result.get("result_type") == "skill_run",
      f"(got \"{fallback_result.get('result_type')}\")")
check("降级后有 envelope", bool(fallback_result.get("envelope")))

# ========== 测试4：完整流程模拟 ==========
print("\n=== 测试4: 完整流程模拟 ===")
# 模拟前端发送的 action 请求。
# 现行流程：点「继续预订」→ booking_handoff 走服务端技能生成 H5 嵌入卡；
# 卡内「在新页面打开」→ open_h5_external 才返回 redirect 让前端跳转。
front_end_payload = {
    "action_key": "travel_route.open_h5_external",
    "params": {
        "product_id": "fcg_route_001",
        "destination": "防城港",
        "h5_order_url": "https://ljutest.jtdcn.cn/sojourn/order/fcg_route_001",
        "h5_product_url": "https://ljutest.jtdcn.cn/sojourn/product/fcg_route_001",
    },
}

# 模拟 dispatchAction 处理
api_response = client.dispatch_action(
    action_key=front_end_payload["action_key"],
    params=front_end_payload["params"],
)

# 前端判断逻辑
should_redirect = api_response.get("result_type") == "redirect" and bool(api_response.get("redirect_url"))
check("前端可识别为 redirect", should_redirect)
check("redirect_url 正确",
      api_response.get("redirect_url") == "https://ljutest.jtdcn.cn/sojourn/order/fcg_route_001")

print(f"\n=== 结果: {_pass} 通过 / {_fail} 失败 ===")
sys.exit(1 if _fail > 0 else 0)
