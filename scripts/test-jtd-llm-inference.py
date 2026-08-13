#!/usr/bin/env python3
"""完整流程测试：JtdTravelService.buildRouteProductContext + LLM 补字段。

Python 版，替代 test-jtd-llm-inference.mjs。
用法: python scripts/test-jtd-llm-inference.py
"""
import json
import time

from flattalk_client import FlatTalkClient, FlatTalkError


def main():
    client = FlatTalkClient()

    # 先检查配置
    try:
        cfg_result = client.jtd_is_configured()
        print("=== JtdTravelService 配置 ===")
        print(f"configured: {cfg_result.get('configured')}")
    except FlatTalkError as e:
        print(f"配置检查失败: {e}")
    print("")

    # 测试场景：用产品名无法提取地名的产品，验证 LLM 补字段
    scenarios = [
        {"name": "0730测试产品", "message": "帮我规划0730测试旅居路线5天4日游"},
        {"name": "自在港湾基地", "message": "帮我预订自在港湾旅居基地"},
        {"name": "健康旅居7天", "message": "帮我看看健康旅居7天优品产品"},
        {"name": "七洞乡线路(有地名)", "message": "帮我规划七洞乡线路产品旅居路线"},
    ]

    for sc in scenarios:
        print(f"\n========== {sc['name']} ==========")
        print(f"message: {sc['message']}")
        try:
            t0 = time.time()
            ctx = client.jtd_build_route_product_context(request={"message": sc["message"]})
            elapsed = int((time.time() - t0) * 1000)
            print(f"elapsed={elapsed}ms data_source={ctx.get('data_source')} source_status={ctx.get('source_status')}")
            print(f"product_domain: {ctx.get('product_domain')}")
            print(f"products count: {len(ctx.get('products') or [])}")
            sp = ctx.get("selected_product")
            if sp:
                print("selected_product:")
                print(f"  product_id: {sp.get('product_id')}")
                print(f"  product_name: {sp.get('product_name')}")
                dest_label = sp.get("destination", "")
                if sp.get("llm_inferred"):
                    dest_label += " (LLM推理)"
                else:
                    dest_label += " (接口/兜底)"
                print(f"  destination: {dest_label}")
                print(f"  price_label: {sp.get('price_label')}")
            else:
                print("selected_product: null")
        except FlatTalkError as e:
            print(f"EXCEPTION: {e}")
        except Exception as e:
            print(f"EXCEPTION: {e}")


if __name__ == "__main__":
    main()
