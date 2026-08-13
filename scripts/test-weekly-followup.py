#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证追问"生成一周计划"是否正确路由到 weekly_plan 模板
（test-weekly-followup.mjs 的 Python 等价实现）

用法：python scripts/test-weekly-followup.py
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


def template_id_from_action(action_key: str, params: dict | None = None) -> str:
    """调用 templateIdFromAction 桥端点，返回 template_id 字符串。"""
    result = client.template_id_from_action(action_key=action_key, params=params or {})
    if isinstance(result, dict):
        return result.get("template_id") or ""
    return str(result or "")


# 测试1: templateIdFromAction 导出可用
print("== 测试1: templateIdFromAction 导出 ==")
cases = [
    ("meal_plan.generate_weekly_plan", {}, "weekly_plan"),
    # action-dispatcher.js:82 明确映射 adjust_for_condition -> diet_condition_card
    # （拆分 adjust_for_disease / adjust_for_condition 后的现行行为）。
    # 原 .mjs 期望 "" 属拆分前的过期断言，Node 侧同样失败 4/5。
    ("meal_plan.adjust_for_condition", {}, "diet_condition_card"),
    ("travel_route.check_availability", {}, "travel_availability_card"),
    ("sos.call_120", {}, "service_emergency"),
    ("find_service.catalog", {}, "service_catalog"),
]
_pass = 0
for action_key, params, expected in cases:
    result = template_id_from_action(action_key, params)
    ok = result == expected
    print(f"  {'✅' if ok else '❌'} {action_key} → \"{result}\" (期望 \"{expected}\")")
    if ok:
        _pass += 1
print(f"  {_pass}/{len(cases)} 通过\n")

# 测试2: 模拟 handleChat 的 template_id 解析逻辑
print("== 测试2: handleChat template_id 解析（模拟）==")


def resolve_template_id(body: dict) -> str:
    rc = body.get("reenter_chat") is True or body.get("execute_action") is False
    return (
        body.get("template_id")
        or body.get("templateId")
        or (body.get("params") or {}).get("template_id")
        or body.get("next_template_id")
        or ("" if rc else template_id_from_action(
            body.get("action_key") or body.get("actionKey") or "",
            body.get("params") or {},
        ))
    )


# 场景A: 前端发送 action_key 但没有 template_id（bug 场景）
body_a = {
    "action_key": "meal_plan.generate_weekly_plan",
    "skill_key": "meal_plan",
    "user_prompt": "请基于这份膳食建议生成一周三餐计划",
    "execute_action": True,
    "reenter_chat": False,
}
print(f"  场景A (action_key无template_id): \"{resolve_template_id(body_a)}\" (期望 \"weekly_plan\")")

# 场景B: 前端同时发送 template_id 和 action_key
body_b = {**body_a, "template_id": "weekly_plan"}
print(f"  场景B (两者都有): \"{resolve_template_id(body_b)}\" (期望 \"weekly_plan\")")

# 场景C: reenter_chat=true 时不应推导
body_c = {**body_a, "reenter_chat": True}
print(f"  场景C (reenter_chat=true): \"{resolve_template_id(body_c)}\" (期望 \"\")")

# 场景D: 非 action 按钮（普通追问）
body_d = {
    "user_prompt": "帮我看一下天气",
    "execute_action": False,
    "reenter_chat": True,
}
print(f"  场景D (普通追问): \"{resolve_template_id(body_d)}\" (期望 \"\")")

print("\n== 测试3: weekly_plan 模板是否存在 ==")
weekly_html = Path("src") / "skills" / "meal_plan" / "templates" / "html" / "weekly_plan.html"
weekly_manifest = Path("src") / "skills" / "meal_plan" / "templates" / "html" / "weekly_plan.manifest.json"
html_exists = weekly_html.exists()
print(f"  weekly_plan.html: {'✅ 存在' if html_exists else '❌ 缺失'} "
      f"({weekly_html.stat().st_size if html_exists else 0} bytes)")
print(f"  weekly_plan.manifest.json: {'✅ 存在' if weekly_manifest.exists() else '❌ 缺失'}")

print("\n[完成]")
