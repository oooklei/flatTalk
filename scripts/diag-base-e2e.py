#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sojourn_base 端到端：fillTemplateSlots → 渲染 → 检查
（diag-base-e2e.mjs 的 Python 等价实现）

用法：python scripts/diag-base-e2e.py
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

BUSINESS_DATA = {
    "jtd": {
        "source_status": "mock_vendor_data",
        "product_domain": "sojourn_base",
        "products": [
            {
                "product_name": "防城港滨海康养中心", "destination": "防城港",
                "price_label": "3000元/月起", "tags": ["慢病康复", "海滨气候"],
            },
            {
                "product_name": "北海银滩康养基地", "destination": "北海",
                "price_label": "2500元/月起", "tags": ["慢病友好", "海滨气候"],
            },
        ],
    },
}


def main() -> int:
    client = FlatTalkClient(timeout=180)

    model_result = client.fill_template_slots(
        message="推荐康养基地",
        template_id="sojourn_base",
        business_data=BUSINESS_DATA,
    )
    data = (model_result or {}).get("data") or {}

    print("=== sojourn_base 端到端 ===")
    print("template_id:", (model_result or {}).get("template_id"))
    print("answer_text:", str((model_result or {}).get("answer_text") or "")[:60])
    print("map_mode:", data.get("map_mode"))
    print("centerLat:", data.get("centerLat"))
    print("markers_json 有值:", bool(data.get("markers_json")))

    render_result = client.render_template_card_result(
        template_dir=str(TEMPLATE_DIR),
        model_result=model_result,
        actions=[],
        followupSuggestions=[],
    )
    page_html_raw = (render_result or {}).get("rendered_html") or ""
    print("render_status:", (render_result or {}).get("render_status"))
    print("HTML 长度:", len(page_html_raw))

    # 提取 srcdoc 内容
    srcdoc_match = re.search(r'srcdoc="([\s\S]*?)"></iframe>', page_html_raw)
    page_html = html_mod.unescape(srcdoc_match.group(1)) if srcdoc_match else page_html_raw

    # 检查技术件名残留
    has_leak = bool(re.search(r"tavily|金跳动|jintiaodong|mock|厂家联调", page_html, re.IGNORECASE))
    print("技术件名残留:", "✗ 有" if has_leak else "✓ 无")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "base-full-test.html").write_text(page_html, encoding="utf-8")
    print("已写入 scripts/test-output/base-full-test.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
