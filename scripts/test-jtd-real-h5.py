#!/usr/bin/env python3
"""用真实产品ID测试 productDetail + checkAvailability + 构造H5 URL。

Python 版，替代 test-jtd-real-h5.mjs。
用法: python scripts/test-jtd-real-h5.py
"""
import json
import os
import re
from pathlib import Path

import requests

from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path(__file__).resolve().parent.parent


def load_env():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    text = env_path.read_text(encoding="utf-8")
    for line in text.splitlines():
        m = re.match(r"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$", line)
        if m:
            key, val = m.group(1), m.group(2)
            if key not in os.environ:
                os.environ[key] = val


def main():
    load_env()
    client = FlatTalkClient()

    # 1. 搜索拿到产品
    print("=== 1. searchProducts ===")
    try:
        search_r = client.jtd_search_products(
            query={"tenantId": "042788", "productDomain": "sojourn_route", "pageSize": 10}
        )
    except FlatTalkError as e:
        print(f"调用失败: {e}")
        return

    print(f"raw response: {json.dumps(search_r.get('response', {}), ensure_ascii=False)[:800]}")
    data = (search_r.get("response") or {}).get("data") or {}
    items = data.get("items") or data.get("list") or []
    print(f"items: {len(items)}")
    if not items:
        print("无产品")
        return

    product = items[0]
    product_id = product.get("productId") or product.get("product_id") or ""
    product_name = product.get("productName") or product.get("product_name") or ""
    print(f"productId: {product_id}")
    print(f"productName: {product_name}")

    # 2. productDetail
    print("\n=== 2. productDetail ===")
    try:
        detail_r = client.jtd_product_detail(product_id, "", {"productDomain": "sojourn_route"})
    except FlatTalkError as e:
        print(f"调用失败: {e}")
        detail_r = {}

    print(f"ok: {detail_r.get('ok')}")
    if detail_r.get("ok"):
        detail = (detail_r.get("response") or {}).get("data") or {}
        print(f"detail: {json.dumps(detail, ensure_ascii=False, indent=2)[:3000]}")
    else:
        print(f"error: {detail_r.get('error')} msg: {detail_r.get('message')}")
        print(f"response: {json.dumps(detail_r.get('response') or {}, ensure_ascii=False)[:1000]}")

    # 3. checkAvailability
    print("\n=== 3. checkAvailability ===")
    try:
        avail_r = client.jtd_check_availability(payload={
            "productId": product_id,
            "skuId": "",
            "checkIn": "2025-03-15",
            "checkOut": "2025-03-20",
            "quantity": 2,
            "productDomain": "sojourn_route",
        })
    except FlatTalkError as e:
        print(f"调用失败: {e}")
        avail_r = {}

    print(f"ok: {avail_r.get('ok')}")
    if avail_r.get("ok"):
        avail = (avail_r.get("response") or {}).get("data") or {}
        print(f"availability: {json.dumps(avail, ensure_ascii=False, indent=2)[:2000]}")
    else:
        print(f"error: {avail_r.get('error')} msg: {avail_r.get('message')}")
        print(f"response: {json.dumps(avail_r.get('response') or {}, ensure_ascii=False)[:1000]}")

    # 4. 构造 H5 URL（按接口文档 handoff 模板）
    print("\n=== 4. H5 地址构造（接口文档模板）===")
    h5_base = os.environ.get("JTD_H5_BASE_URL", "https://lvjutest.jtdcn.cn/h5")
    route_product = product.get("routeProduct") or {}
    sku_id = route_product.get("skuId") or product.get("skuId") or ""
    h5_product_url = f"{h5_base}/pages/product/detail?productId={product_id}"
    if sku_id:
        h5_product_url += f"&skuId={sku_id}"
    h5_order_url = f"{h5_base}/pages/order/index?productId={product_id}"
    if sku_id:
        h5_order_url += f"&skuId={sku_id}"
    h5_order_url += "&checkIn=2025-03-15&checkOut=2025-03-20"
    h5_order_list_url = f"{h5_base}/pages/order/index"

    print(f"h5Base: {h5_base}")
    print(f"h5ProductUrl: {h5_product_url}")
    print(f"h5OrderUrl: {h5_order_url}")
    print(f"h5OrderListUrl: {h5_order_list_url}")

    # 5. 验证 H5 URL 可访问性
    print("\n=== 5. H5 URL 可访问性验证 ===")
    for name, url in [("h5ProductUrl", h5_product_url), ("h5OrderUrl", h5_order_url)]:
        try:
            resp = requests.head(url, allow_redirects=True, timeout=10)
            print(f"{name}: HTTP {resp.status_code}, Content-Type: {resp.headers.get('content-type')}")
            xfo = resp.headers.get("x-frame-options")
            print(f"  X-Frame-Options: {xfo or '未设置（可嵌入iframe）'}")
        except Exception as e:
            print(f"{name}: 请求失败 - {e}")


if __name__ == "__main__":
    main()
