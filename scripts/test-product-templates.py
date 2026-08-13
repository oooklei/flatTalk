#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试产品模板库：验证4类产品匹配 + 生成HTML
（test-product-templates.mjs 的 Python 等价实现）

用法：python scripts/test-product-templates.py
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

OUT_DIR = _ROOT / "geographicSVG"
_pass = 0
_fail = 0


def select_product_template(route_name: str, description: str) -> dict | None:
    return client._call_fn("selectProductTemplate", {"routeName": route_name, "description": description})


def load_product_sample(product_id: str) -> dict | None:
    return client._call_fn("loadProductSample", {"productId": product_id})


print("=" * 60)
print("产品模板库测试")
print("=" * 60)

# 测试用例：线路描述 → 期望匹配的产品模板ID
test_cases = [
    {"name": "巴马5天4晚康养旅居", "desc": "负氧离子养生，长寿村探访", "expectId": "route_wellness"},
    {"name": "防城港京族滨海3天2晚", "desc": "海滩度假，海鲜美食，京族文化", "expectId": "route_coastal"},
    {"name": "三江侗族文化深度游", "desc": "风雨桥，侗族大歌，非遗手作", "expectId": "route_culture"},
    {"name": "崇左德天瀑布生态游", "desc": "喀斯特山水，溶洞瀑布，漂流", "expectId": "route_ecology"},
    # 无明确目的地关键词时，selectProductTemplate 按设计返回 null
    # （route-svg-generator.js:445-448「泛化『旅居/产品详情』不得静默套巴马 wellness 样例」）
    {"name": "某线路无明确关键词", "desc": "广西旅游线路", "expectId": None},
]

# 1. 测试模板匹配
print("\n--- 1. 产品模板匹配 ---")
for tc in test_cases:
    try:
        matched = select_product_template(tc["name"], tc["desc"])
    except FlatTalkError as e:
        print(f"  FAIL  {tc['name']} → 桥端点 selectProductTemplate 不可用 ({e})")
        _fail += 1
        continue
    # 桥端点未匹配时返回 {}，等价于 JS 的 null
    matched_id = matched.get("id") if matched else None
    ok = matched_id == tc["expectId"]
    print(f"  {'PASS' if ok else 'FAIL'}  {tc['name']} → "
          f"{matched_id or 'null'} (期望: {tc['expectId'] or 'null'})")
    if ok:
        _pass += 1
    else:
        _fail += 1

# 2. 测试示例数据加载
print("\n--- 2. 示例数据完整性 ---")
product_ids = ["route_wellness", "route_coastal", "route_culture", "route_ecology"]
for pid in product_ids:
    try:
        sample = load_product_sample(pid)
    except FlatTalkError as e:
        print(f"  FAIL  {pid} → 桥端点 loadProductSample 不可用 ({e})")
        _fail += 1
        continue
    checks = {
        "sample 非空": bool(sample),
        "含 waypoints": bool(sample) and isinstance(sample.get("waypoints"), list) and len(sample.get("waypoints")) > 0,
        "含 routeTitle": bool(sample) and bool(sample.get("routeTitle")),
        "含 destination": bool(sample) and bool(sample.get("destination")),
        "含 highlights": bool(sample) and isinstance(sample.get("highlights"), list),
        "含 itinerary": bool(sample) and isinstance(sample.get("itinerary"), list),
    }
    all_ok = all(checks.values())
    waypoint_desc = f"{len(sample.get('waypoints') or [])} waypoints" if sample else "null"
    print(f"  {'PASS' if all_ok else 'FAIL'}  {pid} ({waypoint_desc})")
    if not all_ok:
        for name, ok in checks.items():
            if not ok:
                print(f"         FAIL: {name}")
    if all_ok:
        _pass += 1
    else:
        _fail += 1

# 3. 用每类示例数据生成 HTML
print("\n--- 3. 示例数据→HTML生成 ---")
for pid in product_ids:
    try:
        sample = load_product_sample(pid)
    except FlatTalkError as e:
        print(f"  FAIL  {pid}: 桥端点 loadProductSample 不可用 ({e})")
        _fail += 1
        continue
    if not sample:
        print(f"  FAIL  {pid}: 示例数据为空")
        _fail += 1
        continue

    try:
        result = client.generate_route_html(
            route_name=sample.get("routeTitle") or "",
            route_description=sample.get("summary") or "",
            waypoints=sample.get("waypoints"),
            destination=sample.get("destination"),
            season=sample.get("season"),
            budgetLevel=sample.get("budgetLevel"),
            priceLabel=sample.get("priceLabel"),
            suitable=sample.get("suitable"),
            highlights=sample.get("highlights"),
            itinerary=sample.get("itinerary"),
            healthNotice=sample.get("healthNotice"),
        )

        html = result.get("html") or ""
        svg = result.get("svg") or ""
        out_path = OUT_DIR / f"preview-{pid}.html"
        out_path.write_text(html, encoding="utf-8")

        checks = {
            "html 非空": len(html) > 500,
            "svg 含 route-marker": "route-marker" in svg,
            "svg 含 data-spot-desc": "data-spot-desc" in svg,
            "svg 无 Tavily": "tavily" not in svg.lower(),
        }
        all_ok = all(checks.values())
        print(f"  {'PASS' if all_ok else 'FAIL'}  {pid} → "
              f"{len(html) / 1024:.1f}KB HTML, {len(svg) / 1024:.1f}KB SVG")
        if all_ok:
            _pass += 1
        else:
            _fail += 1
            for n, o in checks.items():
                if not o:
                    print(f"         FAIL: {n}")
    except Exception as e:  # noqa: BLE001 — 与原脚本 try/catch 语义一致
        print(f"  FAIL  {pid}: {e}")
        _fail += 1

print("\n" + "=" * 60)
print(f"总计: {_pass} PASS, {_fail} FAIL")
print("=" * 60)
sys.exit(1 if _fail > 0 else 0)
