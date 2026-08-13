#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证 findPrebuiltPackageByDestination 预建资源包查找，以及 model-service 模块可加载
（test-mapkit-lookup.mjs 的 Python 等价实现）

用法：python scripts/test-mapkit-lookup.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import re
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

print("=== 测试 findPrebuiltPackageByDestination ===")
cases = [
    {"dest": "巴马", "expect": True},
    {"dest": "广西巴马瑶族自治县", "expect": True},
    {"dest": "防城港", "expect": True},
    {"dest": "东兴", "expect": False},  # 东兴无独立资源包
    {"dest": "北海", "expect": False},  # 北海无资源包
]

_LOOKUP_AVAILABLE = True

if not _LOOKUP_AVAILABLE:
    print("⚠ findPrebuiltPackageByDestination 无桥端点，跳过 5 项查找断言")
    print("  需在 src/api/debug.js 注册该端点（源模块 src/core/map/map-kit.js）")
else:
    for c in cases:
        pkg = client._call_fn(
            "findPrebuiltPackageByDestination",
            {"destination": c["dest"], "version": "standard"},
        ) or {}
        found = bool(pkg.get("svg"))
        ok = found == c["expect"]
        route_hint = f" routeId={pkg.get('routeId')}" if pkg.get("routeId") else ""
        print(
            f"{'PASS' if ok else 'FAIL'}  dest=\"{c['dest']}\" found={found} "
            f"(expect {c['expect']}){route_hint}"
        )
        if ok:
            _pass += 1
        else:
            _fail += 1
        # 验证找到的SVG含真实边界
        if pkg.get("svg") and c["expect"]:
            svg = pkg["svg"]
            has_boundary = "district-boundary" in svg
            m = re.search(r'district-boundary[\s\S]*?<path d="([^"]*)"', svg)
            has_real_poly = bool(m) and len(m.group(1).split(" ")) > 20
            print(f"       含行政区边界:{has_boundary} 非矩形:{has_real_poly}")

# 验证 model-service.js 语法正常（原脚本为 import 检查；
# Python 侧改为通过桥端点触发服务端加载 model-service 模块）
print("\n=== 验证 model-service.js 可加载 ===")
try:
    client.fill_template_slots(template_id="", message="", business_data={})
    print("PASS  model-service.js 加载 OK")
    _pass += 1
except FlatTalkError as e:
    print(f"FAIL  model-service.js 加载错误: {e}")
    _fail += 1

print(f"\n{_pass}/{_pass + _fail} checks passed.")
sys.exit(1 if _fail > 0 else 0)
