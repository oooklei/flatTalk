#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试：点"检查可订状态"按钮时，金跳动 checkAvailability 接口被调用
（test-availability.mjs 的 Python 等价实现）

用法：python scripts/test-availability.py
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

from flattalk_client import FlatTalkClient  # noqa: E402

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


def main() -> int:
    client = FlatTalkClient()

    # ========== 测试1：普通查询 → 本地线路命中，不调 checkAvailability ==========
    print("=== 测试1: 普通查询不调可订接口 ===")
    ctx1 = client.jtd_build_route_product_context(
        request={"message": "推荐防城港京族滨海文化线"},
    ) or {}
    check("命中本地线路", ctx1.get("data_source") == "local_routes")
    check("selected_product 非空", bool(ctx1.get("selected_product")))
    availability1 = ctx1.get("availability")
    normalized1 = (availability1 or {}).get("normalized") if isinstance(availability1, dict) else None
    check(
        "availability 为 null（未触发可订查询）",
        not availability1 or availability1 is None or len(availability1 or {}) == 0,
        f"(got {json.dumps(normalized1 or 'null', ensure_ascii=False)[:60]})",
    )

    # ========== 测试2：点"检查可订状态"按钮 → 触发 checkAvailability ==========
    print('\n=== 测试2: check_availability 动作触发金跳动接口 ===')
    ctx2 = client.jtd_build_route_product_context(
        request={
            "message": "推荐防城港京族滨海文化线",
            "context": {
                "action_key": "travel_route.check_availability",
                "check_in": "2025-03-01",
                "check_out": "2025-03-05",
                "people_count": 2,
            },
        },
    ) or {}
    selected2 = ctx2.get("selected_product") or {}
    availability2 = ctx2.get("availability")
    calls2 = ctx2.get("calls")

    check("命中本地线路", ctx2.get("data_source") == "local_routes")
    check(
        "product_id 非空（传给 checkAvailability）",
        bool(selected2.get("product_id")),
        f"(got {selected2.get('product_id')})",
    )
    check(
        "availability 已填充",
        bool(availability2),
        f"(availability={json.dumps((availability2 or {}).get('normalized') or {}, ensure_ascii=False)[:80]})",
    )
    check(
        "calls 包含 checkAvailability",
        isinstance(calls2, list)
        and any(
            (c or {}).get("endpoint") == "checkAvailability"
            or "vailability" in ((c or {}).get("endpoint") or "")
            for c in calls2
        ),
        f"(calls={json.dumps(calls2, ensure_ascii=False)[:100]})",
    )

    # 如果金跳动配置完整，availability.normalized 应该有值
    normalized = (availability2 or {}).get("normalized") if isinstance(availability2, dict) else None
    if normalized:
        check("normalized.available 是布尔", isinstance(normalized.get("available"), bool))
        check("normalized.source_status 有值", bool(normalized.get("source_status")))
        stock = normalized.get("stock")
        print(
            f"  ℹ 可订校验结果: available={normalized.get('available')}, "
            f"stock={stock if stock is not None else 'null'}, status={normalized.get('source_status')}"
        )
    else:
        print("  ℹ 金跳动未配置或不可达，availability 为接口返回的 unavailable")

    # ========== 测试3：用户消息含"可订"关键词 → 也触发 ==========
    print('\n=== 测试3: 消息含"可订"关键词自动触发 ===')
    ctx3 = client.jtd_build_route_product_context(
        request={"message": "京族滨海文化线最近可订吗？还有余量吗？"},
    ) or {}
    check("命中本地线路", ctx3.get("data_source") == "local_routes")
    check("availability 已填充", bool(ctx3.get("availability")))

    # ========== 测试4：fillTravelAvailabilityCard 使用带 availability 的 jtd ==========
    print("\n=== 测试4: fillTravelAvailabilityCard 消费 availability ===")
    result4 = client.fill_template_slots(
        message="京族滨海文化线是否可订",
        template_id="travel_availability_card",
        business_data={
            "primary_city": "防城港",
            "jtd": ctx2,  # 用上面带 availability 的 context
        },
    ) or {}
    d4 = result4.get("data") or {}
    check("template_id=travel_availability_card", result4.get("template_id") == "travel_availability_card")
    check("availabilityStatus 非空", bool(d4.get("availabilityStatus")), f"(got \"{d4.get('availabilityStatus')}\")")
    check("availabilityLevel 非空", bool(d4.get("availabilityLevel")), f"(got \"{d4.get('availabilityLevel')}\")")
    check(
        "productName 包含线路名",
        "京族" in (d4.get("productName") or "") or "防城港" in (d4.get("destination") or ""),
    )
    check("productId 有值", bool(d4.get("productId")))

    print(f"\n=== 结果: {_pass} 通过 / {_fail} 失败 ===")
    return 1 if _fail > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
