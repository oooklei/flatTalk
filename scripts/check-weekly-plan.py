#!/usr/bin/env python3
"""常驻校验：一周膳食计划是否真的生成 7 天数据（而非退化成单日 diet_card / 占位串）。

Python 版，替代 check-weekly-plan.mjs。
通过 /api/debug/fn/fillTemplateSlots 桥端点调用 fillTemplateSlots。
用法: python scripts/check-weekly-plan.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

LIBRARY = [
    {"id": "diet_card", "match": "diet meal 膳食 饮食 早餐 午餐 晚餐"},
    {"id": "weekly_plan", "match": "weekly 一周 周计划 膳食"},
    {"id": "route_card", "match": "travel 路线 行程"},
]


def main():
    client = FlatTalkClient()
    failed = 0

    def assert_cond(cond, msg):
        nonlocal failed
        if cond:
            print("  ✓ " + msg)
        else:
            print("  ✗ " + msg)
            failed += 1

    # 1) 含"一周"字样的请求必须命中 weekly_plan 且 7 天
    try:
        r1 = client.fill_template_slots(
            message="帮我做一份一周控糖膳食计划",
            template_library=LIBRARY,
        )
        assert_cond(r1.get("template_id") == "weekly_plan", '含"一周"的请求命中 weekly_plan（而非 diet_card）')
        items1 = (r1.get("data") or {}).get("weekly_plan", {}).get("items") or []
        assert_cond(isinstance(items1, list) and len(items1) == 7, "weekly_plan 含 7 天（数组）")
        assert_cond(
            all(isinstance(d.get("meals"), list) and len(d["meals"]) == 3 for d in items1),
            "每天含早/午/晚 3 餐",
        )
        assert_cond(
            all(isinstance(d["meals"][0].get("foods"), str) and len(d["meals"][0]["foods"]) > 0 for d in items1),
            "餐食为真实文本（非占位串）",
        )
    except FlatTalkError as e:
        print(f"  ✗ 测试1失败: {e}")
        failed += 1

    # 2) 直接粘贴"周一…周二…周三"结构化数据也必须命中 weekly_plan
    structured = """🗓️
周一
约1200kcal
控糖低盐
🌅
早餐
燕麦粥一碗、水煮蛋一个、凉拌黄瓜少许
约350千卡
☀️
午餐
杂粮饭半碗、清蒸鲈鱼、清炒时蔬、冬瓜汤
约500千卡
🌙
晚餐
小米粥一碗、蒸蛋羹、清炒丝瓜
约400千卡
🗓️
周二
全麦馒头一个、无糖豆浆一杯、煮鸡蛋一个
🗓️
周三
增加豆制品"""
    try:
        r2 = client.fill_template_slots(message=structured, template_library=LIBRARY)
        assert_cond(
            r2.get("template_id") == "weekly_plan",
            '结构化"周一…周三"粘贴数据命中 weekly_plan（不依赖"一周"二字）',
        )
        items2 = (r2.get("data") or {}).get("weekly_plan", {}).get("items") or []
        mon = next((d for d in items2 if d.get("dayName") == "周一"), None)
        assert_cond(
            bool(mon) and any("燕麦粥" in (m.get("foods") or "") for m in mon.get("meals", [])),
            "周一数据来自用户真实输入（燕麦粥）",
        )
    except FlatTalkError as e:
        print(f"  ✗ 测试2失败: {e}")
        failed += 1

    if failed:
        print(f"\n一周膳食计划校验未通过（{failed} 项）✗")
        sys.exit(1)
    print("\n一周膳食计划校验通过 ✓")


if __name__ == "__main__":
    main()
