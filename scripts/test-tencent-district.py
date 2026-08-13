#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试腾讯地图行政区划 API
（test-tencent-district.mjs 的 Python 等价实现）

用法：python scripts/test-tencent-district.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlencode

import requests

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402,F401 (统一 UTF-8 输出)

# 环境变量：原脚本用 dotenv 加载 .env；Python 侧从进程环境读取，
# 若未设置需手动 export / set TENCENT_MAP_KEY / TENCENT_MAP_SK。
KEY = os.environ.get("TENCENT_MAP_KEY", "")
SK = os.environ.get("TENCENT_MAP_SK", "")


def sign(endpoint: str, params: dict) -> str:
    if not SK:
        return ""
    sign_params = {**params, "key": KEY}
    sign_params.pop("sig", None)

    sorted_query = "&".join(f"{k}={sign_params[k]}" for k in sorted(sign_params.keys()))

    raw = f"/ws{endpoint}?{sorted_query}{SK}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def get(endpoint: str, params: dict) -> dict:
    sig = sign(endpoint, params)
    qs = urlencode({**params, "key": KEY, "sig": sig})
    url = f"https://apis.map.qq.com/ws{endpoint}?{qs}"
    print("URL:", url)

    resp = requests.get(url, timeout=60)
    data = resp.text
    try:
        return json.loads(data)
    except ValueError:
        raise RuntimeError(f"JSON parse failed: {data[:200]}")


def test() -> None:
    print("KEY:", "SET" if KEY else "NOT SET")
    print("SK:", "SET" if SK else "NOT SET")

    # 测试 1：获取广西壮族自治区的区县列表
    print("\n=== 测试 1: 获取广西区县列表 ===")
    result1 = get("/district/v1/list", {"id": "450000", "sub_district": 3})
    print("Status:", result1.get("status"))
    nested = result1.get("result") or []
    districts = None
    if nested and nested[0] and isinstance(nested[0], list) and nested[0][0]:
        districts = (nested[0][0] or {}).get("districts")
    if districts:
        print("找到区县:", len(districts))
        bama = next((d for d in districts if "巴马" in (d.get("name") or "")), None)
        if bama:
            print("巴马:", bama.get("name"), "adcode:", bama.get("adcode"))

    # 测试 2：直接搜索巴马县
    print("\n=== 测试 2: 搜索巴马瑶族自治县 ===")
    result2 = get("/district/v1/list", {"keywords": "巴马瑶族自治县"})
    print("Status:", result2.get("status"))
    print("Result:", json.dumps(result2, ensure_ascii=False, indent=2)[:500])


if __name__ == "__main__":
    try:
        test()
    except Exception as e:  # noqa: BLE001 — 与原脚本 .catch(console.error) 语义一致
        print(e, file=sys.stderr)
