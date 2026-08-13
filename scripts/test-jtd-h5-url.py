#!/usr/bin/env python3
"""调金跳动真实接口，查看返回的H5地址。

Python 版，替代 test-jtd-h5-url.mjs。
用法: python scripts/test-jtd-h5-url.py
"""
import json
import os
import re
from pathlib import Path

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

    # 先检查配置
    try:
        cfg_result = client.jtd_is_configured()
    except FlatTalkError as e:
        print(f"[FATAL] 桥端点调用失败: {e}")
        return
    print("=== 金跳动客户端配置 ===")
    print(f"configured: {cfg_result.get('configured')}")

    # 1. 搜索产品
    print("\n=== 1. searchProducts ===")
    try:
        search_result = client.jtd_search_products(query={"city": "防城港", "days": 5})
    except FlatTalkError as e:
        print(f"调用失败: {e}")
        return

    print(f"ok: {search_result.get('ok')}")
    print(f"source_status: {search_result.get('source_status')}")

    if not search_result.get("ok"):
        print(f"error: {search_result.get('error')}")
        print(f"response: {json.dumps(search_result.get('response') or {}, ensure_ascii=False)[:2000]}")
    else:
        data = (search_result.get("response") or {}).get("data") or {}
        if isinstance(data, dict):
            items = data.get("items") or data.get("result") or []
        elif isinstance(data, list):
            items = data
        else:
            items = []
        print(f"items count: {len(items)}")

        if items:
            first = items[0]
            print("\n--- 第一条产品原始数据 ---")
            print(json.dumps(first, ensure_ascii=False, indent=2))

            # 找 H5 URL
            print("\n--- H5 地址查找 ---")
            print(f"h5_product_url: {first.get('h5_product_url') or first.get('h5ProductUrl') or first.get('h5Url') or first.get('productUrl') or '❌ 无'}")
            print(f"h5_order_url: {first.get('h5_order_url') or first.get('h5OrderUrl') or first.get('orderUrl') or '❌ 无'}")
            print(f"mini_program_url: {first.get('mini_program_url') or first.get('miniProgramUrl') or first.get('miniUrl') or '❌ 无'}")
            print(f"handoff_urls: {json.dumps(first.get('handoff_urls') or first.get('handoffUrls') or {}, ensure_ascii=False)}")

            # 2. 查产品详情
            product_id = first.get("productId") or first.get("product_id") or ""
            if product_id:
                print(f"\n=== 2. productDetail (productId={product_id}) ===")
                try:
                    detail_result = client.jtd_product_detail(product_id)
                except FlatTalkError as e:
                    print(f"调用失败: {e}")
                    detail_result = {}

                print(f"ok: {detail_result.get('ok')}")
                if detail_result.get("ok"):
                    detail = (detail_result.get("response") or {}).get("data") or {}
                    print(f"detail: {json.dumps(detail, ensure_ascii=False, indent=2)[:3000]}")
                    print("\n--- 详情页 H5 地址 ---")
                    print(f"h5_product_url: {detail.get('h5_product_url') or detail.get('h5ProductUrl') or '❌ 无'}")
                    print(f"h5_order_url: {detail.get('h5_order_url') or detail.get('h5OrderUrl') or '❌ 无'}")
                    print(f"handoff_urls: {json.dumps(detail.get('handoff_urls') or detail.get('handoffUrls') or {}, ensure_ascii=False)}")
                else:
                    print(f"error: {detail_result.get('error')}")
                    print(f"response: {json.dumps(detail_result.get('response') or {}, ensure_ascii=False)[:1000]}")

                # 3. 查可订状态
                print(f"\n=== 3. checkAvailability (productId={product_id}) ===")
                try:
                    avail_result = client.jtd_check_availability(payload={
                        "productId": product_id,
                        "checkIn": "2025-03-15",
                        "checkOut": "2025-03-20",
                        "peopleCount": 2,
                    })
                except FlatTalkError as e:
                    print(f"调用失败: {e}")
                    avail_result = {}

                print(f"ok: {avail_result.get('ok')}")
                if avail_result.get("ok"):
                    avail = (avail_result.get("response") or {}).get("data") or {}
                    print(f"availability: {json.dumps(avail, ensure_ascii=False, indent=2)[:2000]}")
                    print("\n--- 可订校验 H5 地址 ---")
                    print(f"h5_order_url: {avail.get('h5_order_url') or avail.get('h5OrderUrl') or avail.get('orderUrl') or '❌ 无'}")
                    print(f"h5_product_url: {avail.get('h5_product_url') or avail.get('h5ProductUrl') or '❌ 无'}")
                    print(f"handoff_urls: {json.dumps(avail.get('handoff_urls') or avail.get('handoffUrls') or {}, ensure_ascii=False)}")
                else:
                    print(f"error: {avail_result.get('error')}")
                    print(f"response: {json.dumps(avail_result.get('response') or {}, ensure_ascii=False)[:1000]}")

    # 4. jtd-service.buildRouteProductContext 完整链路
    print("\n\n=== 4. jtd-service.buildRouteProductContext 完整链路 ===")
    try:
        ctx = client.jtd_build_route_product_context(request={"message": "推荐防城港旅居线路"})
    except FlatTalkError as e:
        print(f"调用失败: {e}")
        return

    product = ctx.get("selected_product") or {}
    print(f"data_source: {ctx.get('data_source')}")
    print(f"product_name: {product.get('product_name')}")
    print(f"product_id: {product.get('product_id')}")
    print(f"handoff_urls: {json.dumps(product.get('handoff_urls') or {}, ensure_ascii=False)}")
    avail = (ctx.get("availability") or {}).get("normalized") or {}
    print(f"availability.available: {avail.get('available')}")
    print(f"availability.h5_order_url: {avail.get('h5_order_url') or '❌ 无'}")
    print(f"availability.h5_product_url: {avail.get('h5_product_url') or '❌ 无'}")
    print(f"availability.handoff_urls: {json.dumps(avail.get('handoff_urls') or {}, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
