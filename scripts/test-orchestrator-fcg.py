#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整主流程端到端测试：用户消息 → 场景判断 → 数据加载 → 模板填充 → 渲染
验证防城港5条线路在真实编排器链路中的完整表现
（test-orchestrator-fcg.mjs 的 Python 等价实现）

用法：python scripts/test-orchestrator-fcg.py
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

client = FlatTalkClient()
BASE_URL = os.environ.get("FLATTALK_BASE_URL", "http://127.0.0.1:5298")

# 原脚本本地装配 createDataService + createChatOrchestrator 后调用 orchestrator.run()；
# Python 侧改为调用同等的服务端 HTTP 入口 POST /api/chat/message（src/app.js:136 → handleChat），
# 该入口内部即使用同一套 dataService / modelService / 编排链路。
# 说明：createDataService / chatOrchestratorRun 亦有对应桥端点，但工厂返回的子服务
# 含不可序列化的函数，跨 HTTP 无法等价装配，故统一走 /api/chat/message 真实链路。

OUT_DIR = _ROOT / "scripts" / "test-output"
OUT_DIR.mkdir(parents=True, exist_ok=True)

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


def orchestrator_run(message: str, session_id: str, context: dict) -> dict:
    resp = requests.post(
        f"{BASE_URL}/api/chat/message",
        json={"message": message, "session_id": session_id, "context": context},
        timeout=120,
    )
    return resp.json()


# ========== 测试用例 ==========
test_cases = [
    {"msg": "推荐防城港京族滨海文化线", "expectScene": "travel_route", "expectProduct": "京族滨海文化线", "label": "京族滨海"},
    {"msg": "想了解银发爱情边境线", "expectScene": "travel_route", "expectProduct": "银发爱情边境线", "label": "银发爱情"},
    {"msg": "壮村民俗康养线路怎么样", "expectScene": "travel_route", "expectProduct": "壮村民俗康养线", "label": "壮村民俗"},
    {"msg": "森林轻氧休闲线适合什么人", "expectScene": "travel_route", "expectProduct": "森林轻氧休闲线", "label": "森林轻氧"},
    {"msg": "芒街跨境体验线多少钱", "expectScene": "travel_route", "expectProduct": "芒街跨境体验线", "label": "芒街跨境"},
    {"msg": "防城港有哪些旅居线路", "expectScene": "travel_route", "expectProduct": None, "label": "防城港通用"},
]

for tc in test_cases:
    print(f"\n=== {tc['label']}: \"{tc['msg']}\" ===")
    try:
        result = orchestrator_run(tc["msg"], "test_fcg_routes", {"page": "chat"}) or {}

        # 1. 场景判断
        scene_key = (result.get("scene") or {}).get("scene_key") or result.get("scene_key") or ""
        check(f"{tc['label']} 场景=travel_route",
              scene_key == "travel_route" or not scene_key, f"(got {scene_key})")

        # 2. 响应结构
        has_answer = bool(result.get("answer_text")) or bool(result.get("answer"))
        check(f"{tc['label']} 有回答", has_answer)

        # 3. 模板填充结果
        model_result = result.get("model_result") or result.get("modelResult") or {}
        data = model_result.get("data") or {}
        template_id = model_result.get("template_id") or result.get("template_id") or ""

        check(f"{tc['label']} template_id 非空", bool(template_id), f"(got \"{template_id}\")")

        # 如果有 data（模板填充成功）
        if len(data.keys()) > 0:
            check(f"{tc['label']} dataSource",
                  data.get("dataSource") == "local_routes" or not data.get("dataSource"),
                  f"(got \"{data.get('dataSource')}\")")
            check(f"{tc['label']} summary 非空", bool(data.get("summary")),
                  f"(got \"{str(data.get('summary') or '')[:30]}\")")
            check(f"{tc['label']} map_mode",
                  (not data.get("map_mode")) or data.get("map_mode") == "route",
                  f"(got \"{data.get('map_mode')}\")")

            if tc["expectProduct"]:
                product_name = data.get("routeTitle") or ""
                check(f"{tc['label']} 产品匹配",
                      tc["expectProduct"][:2] in product_name, f"(got \"{product_name}\")")

            # 4. 渲染检查
            if template_id and result.get("rendered_html"):
                html = result["rendered_html"]
                check(f"{tc['label']} HTML渲染", len(html) > 1000, f"(got {len(html)})")

        # 5. 如果有 interactions
        if result.get("interactions") or result.get("actions"):
            actions = result.get("interactions") or result.get("actions") or []
            if isinstance(actions, list) and len(actions):
                check(f"{tc['label']} 有交互动作", True)
    except Exception as e:  # noqa: BLE001 — 与原脚本 try/catch 语义一致
        check(f"{tc['label']} 无异常", False, f"(error: {e})")

# ========== 额外检查：inferDestination ==========
print("\n=== inferDestination 防城港覆盖 ===")
r = client.fill_template_slots(message="防城港旅居", template_id="route_card", business_data={})
destination = (r.get("data") or {}).get("destination") or ""
check("防城港→destination 含防城港", "防城港" in destination, f"(got \"{destination}\")")

print(f"\n=== 结果: {_pass} 通过 / {_fail} 失败 ===")
sys.exit(1 if _fail > 0 else 0)
