#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
旅居主流程整合验证：H5嵌入 + 友好降级
（test-h5-integration.mjs 的 Python 等价实现）

用法：python scripts/test-h5-integration.py
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

_pass = 0
_fail = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global _pass, _fail
    if cond:
        _pass += 1
        print(f"  ✓ {name}")
    else:
        _fail += 1
        print(f"  ✗ {name} {detail}")


# ========== 测试1：真实金跳动产品 → H5嵌入卡片 ==========
print("=== 测试1: 真实产品 H5 嵌入 ===")
search_r = client.jtd_search_products(
    query={"tenantId": "042788", "productDomain": "sojourn_route", "pageSize": 10}
)
_resp = (search_r or {}).get("response") or {}
_resp_data = _resp.get("data") or {}
items = _resp_data.get("list") or _resp_data.get("items") or []

if len(items) > 0:
    real_product = items[0]
    product_id = real_product.get("productId")

    # 可订校验
    avail_r = client.jtd_check_availability(
        payload={
            "productId": product_id,
            "checkIn": "2025-03-15",
            "checkOut": "2025-03-20",
            "quantity": 2,
            "productDomain": "sojourn_route",
        }
    )
    avail = ((avail_r or {}).get("response") or {}).get("data") or {}

    # 用 normalizeProduct 处理
    ctx = client.jtd_build_route_product_context(
        request={
            "message": f"推荐{real_product.get('productName')}",
            "context": {
                "action_key": "travel_route.check_availability",
                "check_in": "2025-03-15",
                "check_out": "2025-03-20",
                "people_count": 2,
            },
        }
    )

    # 如果命中了本地线路，用 mock jtd 测试
    if ctx.get("data_source") == "local_routes":
        _order_url = (
            f"https://lvjutest.jtdcn.cn/h5/pages/order/index?productId={product_id}"
            "&checkIn=2025-03-15&checkOut=2025-03-20"
        )
        test_jtd = {
            "data_source": "real_api",
            "selected_product": {
                "product_id": product_id,
                "product_name": real_product.get("productName"),
                "destination": "广西",
                "price_label": f"{real_product.get('minPrice')}元起",
                "handoff_urls": {
                    "h5_product_url": (
                        f"https://lvjutest.jtdcn.cn/h5/pages/product/detail?productId={product_id}"
                    ),
                    "h5_order_url": _order_url if avail.get("available") else "",
                },
            },
            "availability": {
                "normalized": {
                    "available": avail.get("available"),
                    "h5_order_url": (
                        f"https://lvjutest.jtdcn.cn/h5/pages/order/index?productId={product_id}"
                        if avail.get("available")
                        else ""
                    ),
                    "h5_product_url": (
                        f"https://lvjutest.jtdcn.cn/h5/pages/product/detail?productId={product_id}"
                    ),
                }
            },
            "handoff_enabled": avail.get("available"),
        }
    else:
        test_jtd = ctx

    result1 = client.fill_travel_h5_embed_card(business_data={"jtd": test_jtd})
    data1 = result1.get("data") or {}
    check("template_id 正确", result1.get("template_id") == "travel_h5_embed_card")
    check("hasH5Url=true", data1.get("hasH5Url") is True)
    check("h5Url 非空", bool(data1.get("h5Url")))
    _h5url = str(data1.get("h5Url") or "")
    check("h5Url 含 lvjutest.jtdcn.cn", "lvjutest.jtdcn.cn" in _h5url, f"({_h5url})")
    check('answer_text 含"加载"', "加载" in (result1.get("answer_text") or ""))

    # 渲染验证
    template_dir = str(_ROOT / "src" / "skills" / "travel_route" / "templates" / "html")
    render_r = client.render_card(
        dir=template_dir,
        json_data={"templateId": "travel_h5_embed_card", "data": data1},
    )
    _pages = render_r.get("pages") or []
    html = (_pages[0] if _pages else "") or ""
    check("HTML 含 iframe", "<iframe" in html)
    check("HTML 含真实 productId", str(product_id) in html)
    check("HTML 含产品名", str(real_product.get("productName") or "")[:4] in html)
    print(
        f"  ℹ 真实产品: {real_product.get('productName')}, "
        f"productId={product_id}, available={avail.get('available')}"
    )
else:
    print("  ⚠ 无真实产品，跳过")

# ========== 测试2：本地线路（防城港5条）→ 友好降级 ==========
print("\n=== 测试2: 本地线路降级提示 ===")
result2 = client.fill_travel_h5_embed_card(
    business_data={
        "jtd": {
            "data_source": "local_routes",
            "selected_product": {
                "product_id": "fcg_route_001",
                "product_name": "京族滨海文化线",
                "destination": "防城港",
                "handoff_urls": {},
            },
        },
    }
)
data2 = result2.get("data") or {}
check("hasH5Url=false", data2.get("hasH5Url") is False)
check("isLocalRoute=true", data2.get("isLocalRoute") is True)
check("reasonText=官方认证线路", data2.get("reasonText") == "官方认证线路")
check('answer_text 含"官方推荐"', "官方推荐" in (result2.get("answer_text") or ""))
check(
    'answer_text 含"尚未接入"',
    "尚未接入在线预订" in (result2.get("answer_text") or ""),
)

# 渲染降级
template_dir2 = str(_ROOT / "src" / "skills" / "travel_route" / "templates" / "html")
render_r2 = client.render_card(
    dir=template_dir2,
    json_data={"templateId": "travel_h5_embed_card", "data": data2},
)
_pages2 = render_r2.get("pages") or []
html2 = (_pages2[0] if _pages2 else "") or ""
check("HTML 不含 iframe", "<iframe" not in html2)
check("HTML 含 no-h5-block", "no-h5-block" in html2)
check('HTML 含"官方认证线路"标签', "官方认证线路" in html2)
check("HTML 含产品名", "京族" in html2)

# ========== 测试3：可订校验未通过 → 降级 ==========
print("\n=== 测试3: 不可订降级提示 ===")
result3 = client.fill_travel_h5_embed_card(
    business_data={
        "jtd": {
            "data_source": "real_api",
            "selected_product": {
                "product_id": "jtd_002",
                "product_name": "广西巴马康养三日",
                "destination": "广西巴马",
                "handoff_urls": {},
            },
            "availability": {"normalized": {"available": False}},
        },
    }
)
data3 = result3.get("data") or {}
check("hasH5Url=false", data3.get("hasH5Url") is False)
check("isUnavailable=true", data3.get("isUnavailable") is True)
check("reasonText=当前日期不可订", data3.get("reasonText") == "当前日期不可订")
check(
    'answer_text 含"更换入住日期"',
    "更换入住日期" in (result3.get("answer_text") or ""),
)

# ========== 测试4：普通产品无URL → 通用降级 ==========
print("\n=== 测试4: 通用降级提示 ===")
result4 = client.fill_travel_h5_embed_card(
    business_data={
        "jtd": {
            "selected_product": {
                "product_id": "jtd_unknown",
                "product_name": "某旅居产品",
                "destination": "某地",
                "handoff_urls": {},
            },
        },
    }
)
data4 = result4.get("data") or {}
check("hasH5Url=false", data4.get("hasH5Url") is False)
check("reasonText=暂未开放在线预订", data4.get("reasonText") == "暂未开放在线预订")
check(
    'answer_text 含"联系旅居顾问"',
    "联系旅居顾问" in (result4.get("answer_text") or ""),
)

# ========== 测试5：buildRouteProductContext 真实接口 H5 URL ==========
print("\n=== 测试5: buildRouteProductContext 真实接口构造 H5 ===")
ctx5 = client.jtd_build_route_product_context(request={"message": "推荐旅居线路"})
if ctx5.get("data_source") in ("real_data", "local_kb_cache"):
    product5 = ctx5.get("selected_product") or {}
    handoff5 = product5.get("handoff_urls") or {}
    check("product_id 非空", bool(product5.get("product_id")))
    check(
        "handoff_urls.h5_product_url 非空",
        bool(handoff5.get("h5_product_url")),
        f"({handoff5.get('h5_product_url')})",
    )
    check(
        "h5_product_url 含 lvjutest.jtdcn.cn",
        "lvjutest.jtdcn.cn" in str(handoff5.get("h5_product_url") or ""),
    )
    print(f"  ℹ 产品: {product5.get('product_name')}, H5: {handoff5.get('h5_product_url')}")
else:
    print(f"  ℹ data_source={ctx5.get('data_source')}（本地线路或mock）")
    check("buildRouteProductContext 正常返回", bool(ctx5.get("selected_product")))

print(f"\n=== 结果: {_pass} 通过 / {_fail} 失败 ===")
sys.exit(1 if _fail > 0 else 0)
