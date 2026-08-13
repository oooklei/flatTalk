#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证所有模板的 JSON 合法性 + discover 加载
（verify-templates.mjs 的 Python 等价实现）

用法：python scripts/verify-templates.py
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

SKILL_DIRS = [
    ("common", "src/skills/common/templates/html"),
    ("dispatch_manage", "src/skills/dispatch_manage/templates/html"),
    ("find_service", "src/skills/find_service/templates/html"),
    ("health_risk_warning", "src/skills/health_risk_warning/templates/html"),
    ("meal_plan", "src/skills/meal_plan/templates/html"),
    ("nearby_resource", "src/skills/nearby_resource/templates/html"),
    ("travel_route", "src/skills/travel_route/templates/html"),
]


def main() -> int:
    client = FlatTalkClient(timeout=120)

    total_loaded = 0
    total_desc = 0
    total_missing: list[str] = []

    for name, rel_dir in SKILL_DIRS:
        try:
            templates = client.discover_templates(dir=str(_ROOT / rel_dir), raw=True)
            if not isinstance(templates, list):
                templates = []
            with_desc = [t for t in templates if t.get("description")]
            without_desc = [t for t in templates if not t.get("description")]
            print(
                f"✅ {name}: {len(templates)} 模板 | "
                f"{len(with_desc)} 有描述 | {len(without_desc)} 缺描述"
            )
            total_loaded += len(templates)
            total_desc += len(with_desc)
            if without_desc:
                ids = ", ".join(str(t.get("id")) for t in without_desc)
                total_missing.append(f"{name}: {ids}")
        except Exception as e:  # noqa: BLE001
            print(f"❌ {name}: {e}")

    print(f"\n总计: {total_loaded} 模板 | {total_desc} 有描述 | {total_loaded - total_desc} 缺描述")
    if total_missing:
        print("\n仍缺 description:")
        for m in total_missing:
            print("  " + m)
    else:
        print("\n🎉 全部模板均有 description!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
