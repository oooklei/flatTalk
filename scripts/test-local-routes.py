#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
端到端测试：防城港5条本地线路查询 + 模板渲染
（test-local-routes.mjs 的 Python 等价实现）

用法：python scripts/test-local-routes.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import html as html_mod
import json
import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient, FlatTalkError  # noqa: E402

client = FlatTalkClient()

TEMPLATE_DIR = str(_ROOT / "src" / "skills" / "travel_route" / "templates" / "html")
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


def is_finite_number(value) -> bool:
    """等价于 JS Number.isFinite（排除 bool，Python 中 bool 是 int 子类）。"""
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return value == value and value not in (float("inf"), float("-inf"))


def match_local_routes(message: str, product_domain: str) -> list:
    return client._call_fn("matchLocalRoutes", {"message": message, "productDomain": product_domain})


def build_local_route_context(message: str, product_domain: str) -> dict:
    return client._call_fn("buildLocalRouteContext", {"message": message, "productDomain": product_domain})


# ========== 测试1: 关键词匹配 ==========
print("=== 测试1: 关键词匹配 ===")
queries = [
    {"msg": "京族滨海文化", "expectId": "fcg_route_001"},
    {"msg": "银发爱情边境线", "expectId": "fcg_route_002"},
    {"msg": "壮村民俗康养", "expectId": "fcg_route_003"},
    {"msg": "十万大山森林", "expectId": "fcg_route_004"},
    {"msg": "芒街跨境体验", "expectId": "fcg_route_005"},
]

try:
    for q in queries:
        matches = match_local_routes(q["msg"], "sojourn_route") or []
        got = matches[0].get("product_id") if matches else None
        check(f"{q['msg']}→{q['expectId']}", got == q["expectId"], f"(got {got})")

    # 防城港通用查询返回全部
    all_matches = match_local_routes("防城港旅居线路", "sojourn_route") or []
    check("防城港通用→5条", len(all_matches) == 5, f"(got {len(all_matches)})")
except FlatTalkError as e:
    check("matchLocalRoutes 桥端点可用", False, f"({e})")

# ========== 测试2: buildLocalRouteContext ==========
print("\n=== 测试2: buildLocalRouteContext ===")
try:
    ctx = build_local_route_context("京族滨海文化线", "sojourn_route") or {}
    selected = ctx.get("selected_product") or {}
    check("provider=local_routes", ctx.get("provider") == "local_routes")
    check("source_status=local_kb_cache", ctx.get("source_status") == "local_kb_cache")
    check("data_source=local_routes", ctx.get("data_source") == "local_routes")
    check("selected_product 非空", bool(ctx.get("selected_product")))
    check("product_name=京族滨海文化线", selected.get("product_name") == "京族滨海文化线")
    check("price_label=398元", "398" in (selected.get("price_label") or ""))
    check("waypoints 非空", isinstance(ctx.get("waypoints"), list) and len(ctx.get("waypoints")) > 0)
    check("itinerary 非空",
          isinstance(selected.get("itinerary"), list) and len(selected.get("itinerary") or []) > 0)
    check("highlights 非空",
          isinstance(selected.get("highlights"), list) and len(selected.get("highlights") or []) > 0)
    check("combo_price 有值", bool(ctx.get("combo_price")))
except FlatTalkError as e:
    check("buildLocalRouteContext 桥端点可用", False, f"({e})")

# ========== 测试3: fillRouteCard 端到端 ==========
print("\n=== 测试3: fillRouteCard 端到端 ===")
for route in queries:
    try:
        jtd_ctx = build_local_route_context(route["msg"], "sojourn_route")
    except FlatTalkError as e:
        check(f"{route['msg']} buildLocalRouteContext", False, f"({e})")
        continue

    business_data = {"primary_city": "防城港", "jtd": jtd_ctx}
    model_result = client.fill_template_slots(
        message=route["msg"],
        template_id="sojourn_route",
        business_data=business_data,
    )
    d = model_result.get("data") or {}
    # 说明：fillTemplateSlots 内部会把 sojourn_route 重路由到 route_svg 模板，
    # 数据契约随之变化（routeTitle/waypoints/itinerary_raw/static_svg），
    # 旧字段 dataSource/map_mode/waypoints_json 已废弃。此处按现行契约断言。
    check(f"{route['msg']} template_id", model_result.get("template_id") == "route_svg")
    check(f"{route['msg']} itinerary_source", d.get("itinerary_source") == "fangchenggang_routes")
    summary = d.get("summary") or ""
    check(f"{route['msg']} summary 有内容", len(summary) > 10, f"(got \"{summary[:30]}\")")
    check(f"{route['msg']} highlights 是数组",
          isinstance(d.get("highlights"), list) and len(d.get("highlights") or []) > 0)
    itinerary_raw = d.get("itinerary_raw")
    check(f"{route['msg']} itinerary_raw 有值",
          isinstance(itinerary_raw, list) and len(itinerary_raw) > 5,
          f"(got {len(itinerary_raw) if isinstance(itinerary_raw, list) else None})")
    check(f"{route['msg']} waypoints 有值", len(d.get("waypoints") or []) > 0)
    check(f"{route['msg']} routeTitle 有值", bool(d.get("routeTitle")))
    check(f"{route['msg']} destination 有值", bool(d.get("destination")))
    check(f"{route['msg']} static_svg 有值", len(d.get("static_svg") or "") > 1000)

    # 渲染检查
    render_result = client.render_template_card_result(
        template_dir=TEMPLATE_DIR,
        model_result=model_result,
        actions=model_result.get("actions") or [],
        followupSuggestions=[],
    )
    html = render_result.get("rendered_html") or ""
    check(f"{route['msg']} HTML>5KB", len(html) > 5000, f"(got {len(html)})")

    # 提取页面 HTML 检查技术件名
    srcdoc_match = re.search(r'srcdoc="([\s\S]*?)"></iframe>', html)
    page_html = html_mod.unescape(srcdoc_match.group(1)) if srcdoc_match else html
    # 先剔除 base64 内联资源与 <script>/<style>：其随机字符会偶然包含 "mock" 等子串，
    # 造成技术件名泄漏误报（实测命中均出现在图片 base64 流中）。
    scan_text = re.sub(r"data:[^;,\s]+;base64,[A-Za-z0-9+/=]+", "", page_html)
    scan_text = re.sub(r"<script[\s\S]*?</script>", "", scan_text, flags=re.IGNORECASE)
    scan_text = re.sub(r"<style[\s\S]*?</style>", "", scan_text, flags=re.IGNORECASE)
    # 用词边界约束，避免 "mock" 命中随机字符串中间
    has_leak = bool(re.search(r"\btavily\b|金跳动|\bjintiaodong\b|\bmock\b|厂家联调",
                              scan_text, re.IGNORECASE))
    check(f"{route['msg']} 无技术件名残留", not has_leak)

    # 检查残留 Mustache（同样在剔除 base64/script/style 后的文本上检查）
    mustache = re.findall(r"\{\{[^}]+\}\}", scan_text)
    check(f"{route['msg']} 无残留 Mustache", len(mustache) == 0, f"(found {len(mustache)})")

    # 输出第一条线路的完整 HTML 文件
    if route["expectId"] == "fcg_route_001":
        (OUT_DIR / f"fcg-{route['expectId']}.html").write_text(page_html, encoding="utf-8")

print(f"\n=== 结果: {_pass} 通过 / {_fail} 失败 ===")
sys.exit(1 if _fail > 0 else 0)
