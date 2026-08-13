#!/usr/bin/env python3
"""直接调用金跳动真实接口，列出所有旅居产品。

Python 版，替代 test-jtd-list-all.mjs。
用法: python scripts/test-jtd-list-all.py
"""
import json
import os
import time

from flattalk_client import FlatTalkClient, FlatTalkError


def main():
    client = FlatTalkClient()

    # 先检查配置
    try:
        cfg_result = client.jtd_is_configured()
    except FlatTalkError as e:
        print(f"[FATAL] 桥端点调用失败: {e}")
        return

    configured = cfg_result.get("configured")
    if not configured:
        print(f"[FATAL] JTD client not configured. config={json.dumps(cfg_result.get('config', {}), ensure_ascii=False)[:200]}")
        return

    print("=== 金跳动接口配置 ===")
    config = cfg_result.get("config", {})
    print(f"baseUrl: {config.get('baseUrl')}")
    print(f"pathPrefix: {config.get('pathPrefix')}")
    print(f"appId: {config.get('appId')}")
    print(f"tenantId: {os.environ.get('JTD_TENANT_ID', '042788')}")
    print(f"timeoutMs: {config.get('timeoutMs', 15000)}")
    print(f"isConfigured: {configured}")
    print("")

    # 多种 productDomain / productType 组合试探
    tenant_id = os.environ.get("JTD_TENANT_ID", "042788")
    scenarios = [
        {"name": "sojourn_route 旅居线路 pageSize=50",
         "query": {"tenantId": tenant_id, "productDomain": "sojourn_route", "product_type": "旅居线路", "pageNum": 1, "pageSize": 50}},
        {"name": "sojourn_base 旅居基地 pageSize=50",
         "query": {"tenantId": tenant_id, "productDomain": "sojourn_base", "product_type": "旅居基地", "pageNum": 1, "pageSize": 50}},
        {"name": "不限 domain pageSize=100",
         "query": {"tenantId": tenant_id, "pageNum": 1, "pageSize": 100}},
        {"name": "空查询 pageSize=100",
         "query": {"tenantId": tenant_id, "pageNum": 1, "pageSize": 100, "productDomain": ""}},
    ]

    for sc in scenarios:
        print(f"\n========== {sc['name']} ==========")
        print(f"request body: {json.dumps(sc['query'], ensure_ascii=False)}")
        try:
            t0 = time.time()
            res = client.jtd_search_products(query=sc["query"])
            elapsed = int((time.time() - t0) * 1000)
        except FlatTalkError as e:
            print(f"EXCEPTION: {e}")
            continue

        print(f"elapsed={elapsed}ms ok={res.get('ok')} http={res.get('httpStatus')} "
              f"source={res.get('source_status')} error={res.get('error', '-')} "
              f"business_code={res.get('business_code')} msg={res.get('message', '-')}")

        # 兼容多种返回结构
        data = (res.get("response") or {}).get("data") or (res.get("response") or {}).get("result") or res.get("response") or {}
        if isinstance(data, dict):
            records = data.get("records") or data.get("list") or data.get("items") or data.get("products") or []
        elif isinstance(data, list):
            records = data
        else:
            records = []

        print(f"返回产品数: {len(records)}")
        if isinstance(data, dict):
            print(f"total/count 字段:", {
                "total": data.get("total") or data.get("totalCount") or data.get("total_count") or "-",
                "count": data.get("count", "-"),
                "pageNum": data.get("pageNum") or data.get("page", "-"),
                "pageSize": data.get("pageSize") or data.get("size", "-"),
                "pages": data.get("pages") or data.get("totalPages", "-"),
            })

        if not records:
            raw = json.dumps(res.get("response"), ensure_ascii=False)
            print(f"raw response (前 800 字符): {raw[:800]}")
        else:
            for i, p in enumerate(records):
                pid = p.get("product_id") or p.get("productId") or p.get("outProductId") or p.get("id") or "-"
                name = p.get("product_name") or p.get("productName") or p.get("routeName") or p.get("name") or "-"
                dest = p.get("destination") or p.get("destinationCity") or p.get("city") or p.get("routeCity") or "-"
                price = p.get("price_amount") or p.get("priceAmount") or (p.get("price", {}) or {}).get("amount") or p.get("salePrice") or p.get("minPrice") or "-"
                stock = p.get("stock") or p.get("inventory") or p.get("inventoryStock") or "-"
                print(f"  [{i+1}] id={pid} | name={name} | dest={dest} | price={price} | stock={stock}")


if __name__ == "__main__":
    main()
