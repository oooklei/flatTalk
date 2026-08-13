#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
端到端：fillTemplateSlots → renderTemplateCardResult → 检查残留 Mustache 标签
（diag-template-e2e.mjs 的 Python 等价实现）

用法：python scripts/diag-template-e2e.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import html as html_mod
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

CRITICAL_FIELDS = [
    "routeTitle", "destination", "season", "budgetLevel", "days", "suitable",
    "bookingStatus", "summary", "healthNotice", "centerLat", "centerLng",
    "waypoints_json", "spots_json",
]

BUSINESS_DATA = {
    "primary_city": "广西巴马",
    "jtd": {
        "provider": "jintiaodong",
        "source_status": "mock_vendor_data",
        "product_domain": "sojourn_route",
        "products": [],
        "selected_product": None,
        "waypoints": [
            {"name": "南宁", "lat": 22.8170, "lng": 108.3669, "day": "Day1", "type": "arrival", "spots": []},
            {
                "name": "巴马", "lat": 24.0544, "lng": 107.2583, "day": "Day2", "type": "stay",
                "spots": [{
                    "name": "百魔洞景区", "desc": "巴马著名长寿景点",
                    "lat": 24.058, "lng": 107.262, "source": "tavily",
                }],
                "spot_images": [],
            },
            {"name": "北海", "lat": 21.4812, "lng": 109.1228, "day": "Day3", "type": "departure", "spots": []},
        ],
    },
}


def main() -> int:
    client = FlatTalkClient(timeout=180)

    # Step 1: fillTemplateSlots
    print("=== Step 1: fillTemplateSlots ===")
    model_result = client.fill_template_slots(
        message="推荐广西巴马三日康养旅居路线",
        template_id="sojourn_route",
        business_data=BUSINESS_DATA,
    )
    data = (model_result or {}).get("data") or {}

    print("template_id:", (model_result or {}).get("template_id"))
    print("answer_text:", str((model_result or {}).get("answer_text") or "")[:80])
    print("data 字段数:", len(data))

    # 检查关键字段
    print("\n--- 关键字段值 ---")
    for key in CRITICAL_FIELDS:
        v = data.get(key)
        empty = v is None or v == ""
        if isinstance(v, list):
            info = f"[{len(v)}项]"
        elif isinstance(v, str):
            info = f'"{v[:50]}"'
        else:
            info = str(v)
        print(f"  {key}: {'✗ 空' if empty else '✓ ' + info}")

    # Step 2: 渲染
    print("\n=== Step 2: renderTemplateCardResult ===")
    render_result = client.render_template_card_result(
        template_dir=str(TEMPLATE_DIR),
        model_result=model_result,
        actions=(model_result or {}).get("actions") or [],
        followupSuggestions=(model_result or {}).get("followup_suggestions") or [],
    )
    page_html_raw = (render_result or {}).get("rendered_html") or ""
    print("render_status:", (render_result or {}).get("render_status"))
    print("HTML 长度:", len(page_html_raw))

    # 提取 srcdoc 内容
    srcdoc_match = re.search(r'srcdoc="([\s\S]*?)"></iframe>', page_html_raw)
    page_html = html_mod.unescape(srcdoc_match.group(1)) if srcdoc_match else page_html_raw

    # Step 3: 找残留的 Mustache 标签
    print("\n=== Step 3: 残留 Mustache 标签 ===")
    tags = []
    for m in re.finditer(r"\{\{[^}]+\}\}", page_html):
        start = max(0, m.start() - 15)
        end = m.end() + 15
        tags.append({"tag": m.group(0), "ctx": page_html[start:end]})

    if not tags:
        print("✓ 没有残留 Mustache 标签")
    else:
        print(f"✗ 发现 {len(tags)} 个残留标签:")
        for t in tags:
            print(f"  {t['tag']}  ...{t['ctx']}...")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "route-full-test.html").write_text(page_html, encoding="utf-8")
    print("\n已写入 scripts/test-output/route-full-test.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
