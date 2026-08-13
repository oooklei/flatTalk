#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试脚本：验证 nearby-augmentor 富化
（test-nearby-augmentor.mjs 的 Python 等价实现）

用法：python scripts/test-nearby-augmentor.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient, FlatTalkError  # noqa: E402


def main() -> None:
    client = FlatTalkClient()

    # 富化前清除上次缓存（对应原脚本的 clearCache()）
    try:
        client._call_fn("nearbyClearCache", {})
    except FlatTalkError as e:
        print("警告: nearbyClearCache 调用失败 —", e)

    f = client.get_jialu_facilities(type="", max_distance=0, limit=0)
    c = client.get_jialu_center()
    print("Input:", len(f), "POIs")
    # 环境变量由 Node.js 服务端进程持有；Python 侧仅在本地显式设置时可见。
    print("TENCENT_MAP_KEY:", os.environ.get("TENCENT_MAP_KEY"))

    # 周边资源富化（对应原脚本 enrich(facilities, center, 'all')）
    try:
        r = client._call_fn("nearbyEnrich", {"facilities": f, "center": c, "intent": "all"})
    except FlatTalkError as e:
        print("Error: 桥端点 nearbyEnrich 不可用 —", e)
        return

    facilities = r.get("facilities", []) if isinstance(r, dict) else []
    print("Output:", len(facilities), "POIs")
    print("Stats:", json.dumps(r.get("stats"), ensure_ascii=False))

    enriched = [x for x in facilities if x.get("enriched_description")]
    print("Enriched POIs:", len(enriched))
    if enriched:
        first = enriched[0]
        print("Sample:", first.get("name"), "|", (first.get("enriched_description") or "")[:80])

    # 检查腾讯补充的POI
    tencent = [x for x in facilities if x.get("_source") == "tencent"]
    if tencent:
        print("\nTencent supplemented:")
        for t in tencent[:3]:
            print(" ", t.get("name"), "|", t.get("address"))


if __name__ == "__main__":
    main()
