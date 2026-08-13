#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
精确诊断：直接检查渲染后的页面 HTML（不经 buildHtmlFallback 包裹）
（diag-spots-e2e.mjs 的 Python 等价实现）

用法：python scripts/diag-spots-e2e.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

TEMPLATE_DIR = _ROOT / "src" / "skills" / "travel_route" / "templates" / "html"
OUT_DIR = _HERE / "test-output"

SPOTS = [
    {
        "name": "百魔洞景区", "desc": "巴马著名长寿景点", "lat": 24.058, "lng": 107.262,
        "source": "tavily", "parent_waypoint": "巴马", "parent_day": "Day2",
    },
    {
        "name": "水晶宫", "desc": "喀斯特溶洞奇观", "lat": 24.061, "lng": 107.255,
        "source": "tavily", "parent_waypoint": "巴马", "parent_day": "Day2",
    },
]
WAYPOINTS = [
    {"name": "南宁", "lat": 22.8170, "lng": 108.3669, "day": "Day1", "type": "arrival"},
    {"name": "巴马", "lat": 24.0544, "lng": 107.2583, "day": "Day2", "type": "stay"},
    {"name": "北海", "lat": 21.4812, "lng": 109.1228, "day": "Day3", "type": "departure"},
]


def build_model_result() -> dict:
    polyline = [{"lat": w["lat"], "lng": w["lng"]} for w in WAYPOINTS]
    fit_bounds = {"minLat": 21.48, "minLng": 107.25, "maxLat": 24.05, "maxLng": 109.12}
    return {
        "template_id": "sojourn_route",
        "answer_text": "推荐广西巴马三日康养之旅",
        "data": {
            "routeTitle": "广西巴马三日康养之旅",
            "destination": "广西巴马",
            "days": "3天2晚",
            "season": "四季皆宜",
            "budgetLevel": "经济",
            "priceLabel": "约1680元/人",
            "suitable": "康养老人",
            "bookingStatus": "可订",
            "summary": "巴马长寿之乡康养体验",
            "highlights": ["长寿文化", "天然氧吧"],
            "itinerary": [
                {"day": "Day1", "plan": "抵达南宁", "wp_name": "南宁"},
                {"day": "Day2", "plan": "巴马康养", "wp_name": "巴马"},
                {"day": "Day3", "plan": "返程", "wp_name": "北海"},
            ],
            "healthNotice": "建议出行前确认身体状况",
            "centerLat": 24.0544,
            "centerLng": 107.2583,
            "centerName": "广西巴马",
            "center_json": json.dumps({"lat": 24.0544, "lng": 107.2583, "name": "广西巴马"}, ensure_ascii=False),
            "map_key": os.environ.get("TENCENT_MAP_JS_KEY", ""),
            "static_map_url": "",
            "markers_json": json.dumps(WAYPOINTS, ensure_ascii=False),
            "map_markers": WAYPOINTS,
            "waypoints_json": json.dumps(WAYPOINTS, ensure_ascii=False),
            "waypoints": WAYPOINTS,
            "polyline_path": polyline,
            "polyline_path_json": json.dumps(polyline, ensure_ascii=False),
            "fit_bounds": fit_bounds,
            "fit_bounds_json": json.dumps(fit_bounds, ensure_ascii=False),
            "route_planning_url": "",
            "spots_json": json.dumps(SPOTS, ensure_ascii=False),
            "spots": SPOTS,
            "spot_images": [],
            "spot_images_json": "[]",
            "spot_status": "real_data",
            "hasSpots": True,
        },
    }


def main() -> int:
    client = FlatTalkClient(timeout=180)
    model_result = build_model_result()

    # 用 renderCard 直接渲染（不走 buildHtmlFallback），拿到原始页面 HTML
    card = client.render_card(
        dir=str(TEMPLATE_DIR),
        json_data={"template_id": "sojourn_route", "data": model_result["data"]},
    ) or {}

    pages = card.get("pages") or []
    page_html = pages[0] if pages else ""

    print("=== renderCard 直接输出 ===")
    print("templateId:", card.get("templateId"))
    print("pageHtml 长度:", len(page_html))

    # 检查关键 JS 变量
    for v in ["var CENTER", "var _c", "var WAYPOINTS", "var SPOTS", "var POLYLINE_PATH", "var FIT_BOUNDS"]:
        print(f"  {v}: {'存在' if v in page_html else '缺失'}")

    # 提取 SPOTS 赋值行
    spots_line = re.search(r"var SPOTS\s*=\s*([^;]+);", page_html)
    if spots_line:
        print("\nSPOTS 赋值:", spots_line.group(0)[:200])
    else:
        print("\n!! SPOTS 赋值行未找到")

    # 检查 application/json script 标签是否还在
    json_scripts = re.findall(
        r"""<script[^>]*type=["']application/json["'][^>]*>""", page_html, re.IGNORECASE
    )
    print(f"\napplication/json script 标签: {len(json_scripts)} 个")

    # 检查 spots-section Mustache 渲染
    print("包含 spot-card:", "spot-card" in page_html)
    print("包含 spot-name:", "spot-name" in page_html)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "spots-debug.html").write_text(page_html, encoding="utf-8")
    print("\n已写入 scripts/test-output/spots-debug.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
