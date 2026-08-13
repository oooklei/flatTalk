#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成真实 H5 嵌入卡片测试页面（用金跳动真实接口数据）
（gen-h5-embed-test.mjs 的 Python 等价实现）

依赖：requests（经 flattalk_client）
用法：python scripts/gen-h5-embed-test.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

H5_BASE = "https://lvjutest.jtdcn.cn/h5"
TEMPLATE_DIR = _ROOT / "src" / "skills" / "travel_route" / "templates" / "html"
OUT_DIR = _HERE / "test-output"
OUT_FILE = OUT_DIR / "h5-embed-real-test.html"


def main() -> int:
    client = FlatTalkClient(timeout=180)

    # 1. 搜索真实产品
    search_r = client.jtd_search_products(query={
        "tenantId": "042788",
        "productDomain": "sojourn_route",
        "pageSize": 10,
    })
    response = (search_r or {}).get("response") or {}
    data = response.get("data") or {}
    items = data.get("list") or data.get("items") or []
    if not items:
        print("无产品")
        return 1
    product = items[0]
    product_id = product.get("productId")

    # 2. 可订校验
    avail_r = client.jtd_check_availability(payload={
        "productId": product_id,
        "checkIn": "2025-03-15",
        "checkOut": "2025-03-20",
        "quantity": 2,
        "productDomain": "sojourn_route",
    })
    avail = ((avail_r or {}).get("response") or {}).get("data") or {}

    # 3. 构造 H5 URL
    h5_product_url = f"{H5_BASE}/pages/product/detail?productId={product_id}"
    h5_order_url = (
        f"{H5_BASE}/pages/order/index?productId={product_id}"
        f"&checkIn=2025-03-15&checkOut=2025-03-20"
    )

    # 4. 填充模板
    route_product = product.get("routeProduct") or {}
    model_result = client.fill_travel_h5_embed_card(business_data={
        "jtd": {
            "selected_product": {
                "product_id": product_id,
                "product_name": product.get("productName"),
                "destination": route_product.get("arrival") or "广西",
                "price_label": f"{product.get('minPrice')}元起",
                "handoff_urls": {
                    "h5_product_url": h5_product_url,
                    "h5_order_url": h5_order_url,
                },
            },
            "availability": {
                "normalized": {
                    "available": avail.get("available"),
                    "h5_order_url": h5_order_url,
                    "h5_product_url": h5_product_url,
                },
            },
            "handoff_enabled": True,
        },
    })

    # 5. 渲染
    render_result = client.render_card(
        dir=str(TEMPLATE_DIR),
        json_data={
            "templateId": "travel_h5_embed_card",
            "data": (model_result or {}).get("data") or {},
        },
    )
    pages = (render_result or {}).get("pages") or []
    if not pages:
        print("渲染失败：无输出页面")
        return 1

    # 6. 写文件
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(pages[0], encoding="utf-8")

    print("=== 真实H5嵌入卡片测试页面生成完毕 ===")
    print(f"productId: {product_id}")
    print(f"productName: {product.get('productName')}")
    print(f"available: {avail.get('available')} stock: {avail.get('availableStockCount')}")
    print(f"h5ProductUrl: {h5_product_url}")
    print(f"h5OrderUrl: {h5_order_url}")
    print(f"output: {OUT_FILE}")
    print("\n打开 http://localhost:8088/h5-embed-real-test.html 查看")
    return 0


if __name__ == "__main__":
    sys.exit(main())
