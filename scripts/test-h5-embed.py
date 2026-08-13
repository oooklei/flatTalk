#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试：H5 iframe 嵌入模板 + 天气风险按钮（综合）
（test-h5-embed.mjs 的 Python 等价实现）

用法：python scripts/test-h5-embed.py
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

from flattalk_client import FlatTalkClient, FlatTalkError  # noqa: E402

client = FlatTalkClient()

_pass = 0
_fail = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global _pass, _fail
    if cond:
        _pass += 1
        print(f"  ✓ {name}")
    else:
        _fail += 1
        print(f"  ✗ {name} {detail}")


# ========== 测试1：fillTravelH5EmbedCard 有H5 URL ==========
print("=== 测试1: H5嵌入模板（有URL）===")

mock_jtd = {
    "selected_product": {
        "product_id": "jtd_mock_bama_001",
        "product_name": "广西巴马康养旅居三日体验",
        "destination": "广西巴马",
        "price_label": "约1680元/人",
        "handoff_urls": {
            "h5_product_url": "https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001",
        },
    },
}
result1 = client.fill_travel_h5_embed_card(business_data={"jtd": mock_jtd})
data1 = result1.get("data") or {}
# 现行实现中 actions 恒为空数组，交互按钮统一放在 followup_suggestions
# （见 travel-cards.js:1237-1246），故合并两者后再查找。
actions1 = (result1.get("followup_suggestions") or []) + (result1.get("actions") or [])

check("template_id=travel_h5_embed_card", result1.get("template_id") == "travel_h5_embed_card")
check("h5Url 非空", bool(data1.get("h5Url")), f"(got {data1.get('h5Url')})")
check(
    "h5Url=h5_product_url",
    data1.get("h5Url") == "https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001",
)
check("productName 有值", bool(data1.get("productName")))
check("destination 有值", bool(data1.get("destination")))
check("priceLabel 有值", bool(data1.get("priceLabel")))
check("hasH5Url=true", data1.get("hasH5Url") is True)
check(
    'actions 含"在新页面打开"',
    any(a.get("action_key") == "travel_route.open_h5_external" for a in actions1),
)

# ========== 测试2：有 h5_order_url 时优先用下单页 ==========
print("\n=== 测试2: h5_order_url 优先 ===")
mock_jtd2 = {
    "selected_product": {
        "product_id": "jtd_real_001",
        "product_name": "京族滨海文化线",
        "destination": "防城港",
        "handoff_urls": {
            "h5_product_url": "https://example.com/product/001",
            "h5_order_url": "https://example.com/order/001",
        },
    },
    "availability": {
        "normalized": {
            "available": True,
            "h5_order_url": "https://example.com/order/001?date=2025-03",
        },
    },
}
result2 = client.fill_travel_h5_embed_card(business_data={"jtd": mock_jtd2})
data2 = result2.get("data") or {}
check(
    "h5Url=order_url（最高优先）",
    data2.get("h5Url") == "https://example.com/order/001?date=2025-03",
    f"(got {data2.get('h5Url')})",
)

# ========== 测试3：无H5 URL ==========
print("\n=== 测试3: 无H5 URL降级 ===")
result3 = client.fill_travel_h5_embed_card(
    business_data={"jtd": {"selected_product": {"product_name": "测试产品"}}}
)
data3 = result3.get("data") or {}
check("template_id 仍正确", result3.get("template_id") == "travel_h5_embed_card")
check("h5Url 为空", not data3.get("h5Url"))
check("hasH5Url=false", data3.get("hasH5Url") is False)
# 降级文案现为「暂时无法提供在线预订页面」/「暂未开放在线预订」，不再含「暂无」
# （见 travel-cards.js:1196-1205），改判「暂」字降级语义。
check('answer_text 含降级文案', "暂" in (result3.get("answer_text") or ""),
      f"(got \"{(result3.get('answer_text') or '')[:40]}\")")

# ========== 测试4：action-dispatcher booking_handoff 路由 ==========
print("\n=== 测试4: booking_handoff → server_skill ===")
def _classify(action_key: str) -> str:
    """classifyAction 桥端点返回 {action_type: ...}"""
    r = client._call_fn("classifyAction", {"actionKey": action_key})
    return (r or {}).get("action_type", "") if isinstance(r, dict) else (r or "")


check(
    "classifyAction(booking_handoff)=server_skill",
    _classify("travel_route.booking_handoff") == "server_skill",
)
check(
    "classifyAction(open_h5_external)=client_redirect",
    _classify("travel_route.open_h5_external") == "client_redirect",
)

# booking_handoff 走 server_skill 路径
# 注意：原 .mjs 向 dispatchAction 注入了 JS 回调 handlers.runSkill；HTTP 桥无法传递函数，
# 改用 capture_run_skill=True 让桥层合成 runSkill 并回传 envelope。
try:
    action_result = client.dispatch_action(
        action_key="travel_route.booking_handoff",
        params={
            "product_id": "jtd_mock_bama_001",
            "h5_product_url": "https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001",
        },
        capture_run_skill=True,
    )
    check(
        "result_type=skill_run",
        action_result.get("result_type") == "skill_run",
        f"(got {action_result.get('result_type')})",
    )
    envelope = action_result.get("envelope") or {}
    check(
        "runSkill 收到 template_id=travel_h5_embed_card",
        envelope.get("template_id") == "travel_h5_embed_card",
    )
except FlatTalkError as e:
    check("booking_handoff 分发", False, f"({e})")

# open_h5_external 走 redirect 路径
try:
    ext_result = client.dispatch_action(
        action_key="travel_route.open_h5_external",
        params={"h5_url": "https://example.com/product/001"},
    )
    check(
        "open_h5_external result_type=redirect",
        ext_result.get("result_type") == "redirect",
        f"(got {ext_result.get('result_type')})",
    )
    check("redirect_url 正确", ext_result.get("redirect_url") == "https://example.com/product/001")
except FlatTalkError as e:
    check("open_h5_external 分发", False, f"({e})")

# ========== 测试5：模板渲染检查 ==========
print("\n=== 测试5: 模板渲染 ===")
template_dir = str(_ROOT / "src" / "skills" / "travel_route" / "templates" / "html")
render_result = client.render_card(
    dir=template_dir,
    json_data={"templateId": "travel_h5_embed_card", "data": data1},
)
check(
    "templateId=travel_h5_embed_card",
    render_result.get("templateId") == "travel_h5_embed_card",
    f"(got {render_result.get('templateId')})",
)
pages = render_result.get("pages")
check("pages 有内容", isinstance(pages, list) and len(pages) > 0)
html = (pages[0] if isinstance(pages, list) and pages else "") or ""
# 模板已明确不使用 iframe（H5 需登录态，见 travel_h5_embed_card.html:174 注释），
# 改为「前往预订页面」外链按钮，故改判跳转按钮存在。
check("HTML 含预订跳转按钮", "booking-btn" in html)
check("HTML 不使用 iframe", "<iframe" not in html)
check("HTML 含 src=H5 URL", str(data1.get("h5Url") or "") in html)
check("HTML 含 productName", "广西巴马" in html)

print(f"\n=== 结果: {_pass} 通过 / {_fail} 失败 ===")
sys.exit(1 if _fail > 0 else 0)
