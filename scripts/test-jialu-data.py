#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试 getJialuFacilities 是否返回数据
（test-jialu-data.mjs 的 Python 等价实现）

用法：python scripts/test-jialu-data.py
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


def main() -> None:
    client = FlatTalkClient()
    try:
        facilities = client.get_jialu_facilities(type="", max_distance=0, limit=0)
        print("Facilities count:", len(facilities))
        if len(facilities) > 0:
            print("First 3:", json.dumps(facilities[:3], ensure_ascii=False, indent=2))
        center = client.get_jialu_center()
        print("Center:", json.dumps(center, ensure_ascii=False))
    except FlatTalkError as e:
        print("Error:", e)


if __name__ == "__main__":
    main()
