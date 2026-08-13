#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
诊断 Tavily 景点图层：分步检查数据流
（diag-spots.mjs 的 Python 等价实现）

用法：python scripts/diag-spots.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

TEMPLATE_FILE = _ROOT / "src" / "skills" / "travel_route" / "templates" / "html" / "sojourn_route.html"

TEST_WAYPOINTS = [
    {"name": "巴马", "lat": 24.0544, "lng": 107.2583, "day": "Day1", "type": "stay", "plan": "康养体验"},
    {"name": "百魔洞", "lat": 24.0900, "lng": 107.2700, "day": "Day2", "type": "visit", "plan": "景点游览"},
]


def main() -> int:
    client = FlatTalkClient(timeout=180)

    # Step 1: 直接测 searchCategory
    print("=== Step 1: 测试 Tavily searchCategory ===")
    try:
        r = client.search_category(
            category="spot",
            center={"name": "广西巴马 巴马", "lat": 24.0544, "lng": 107.2583},
            timeout_ms=5000,
        ) or {}
        print("source_status:", r.get("source_status"))
        print("source_results 数量:", len(r.get("source_results") or []))
        print("images 数量:", len(r.get("images") or []))
        first = (r.get("source_results") or [None])[0]
        if first:
            print("第一条景点:", json.dumps(first, ensure_ascii=False)[:200])
    except Exception as e:  # noqa: BLE001
        print("Tavily 调用失败:", e)

    # Step 2: 模拟 enrichWaypointsWithSpots（原函数为私有，此处手动组合）
    print("\n=== Step 2: 测试 enrichWaypointsWithSpots（手动组合）===")
    enriched = []
    for wp in TEST_WAYPOINTS:
        try:
            center = {"name": f"广西巴马 {wp['name']}", "lat": wp["lat"], "lng": wp["lng"]}
            result = client.search_category(category="spot", center=center, timeout_ms=5000) or {}
            spots = []
            for i, item in enumerate((result.get("source_results") or [])[:3]):
                spots.append({
                    "name": item.get("title") or f"景点{i + 1}",
                    "desc": str(item.get("content") or "")[:100],
                    "lat": round(wp["lat"] + (random.random() - 0.5) * 0.015, 6),
                    "lng": round(wp["lng"] + (random.random() - 0.5) * 0.015, 6),
                    "source": "tavily",
                })
            enriched.append({**wp, "spots": spots})
        except Exception as e:  # noqa: BLE001
            enriched.append({**wp, "spots": [], "error": str(e)})

    all_spots = [
        {**s, "parent_waypoint": wp["name"], "parent_day": wp["day"]}
        for wp in enriched for s in wp["spots"]
    ]
    print("enriched waypoints:", len(enriched))
    print("allSpots 数量:", len(all_spots))
    sample = all_spots[0] if all_spots else "无"
    print("allSpots 样例:", json.dumps(sample, ensure_ascii=False)[:200])

    # Step 3: 检查模板中的 spots_json 注入
    print("\n=== Step 3: 模拟模板注入 ===")
    spots_json = json.dumps(all_spots, ensure_ascii=False)
    print("spots_json 长度:", len(spots_json))
    print("spots_json 前100字符:", spots_json[:100])

    # Step 4: 检查模板文件中 spots 相关标签
    print("\n=== Step 4: 检查模板 Mustache 标签 ===")
    if not TEMPLATE_FILE.exists():
        print(f"  模板文件不存在: {TEMPLATE_FILE}")
    else:
        tpl = TEMPLATE_FILE.read_text(encoding="utf-8")
        for tag in ["spots_json", "{{#spots}}", "{{/spots}}", "{{#hasSpots}}", "{{/hasSpots}}", "route-spots"]:
            print(f"  {tag}: {'存在' if tag in tpl else '缺失'}")

    print("\n=== 诊断完成 ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
