#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试腾讯地图签名修复：地理编码 + 周边搜索
（test-tencent-sign.mjs 的 Python 等价实现）

用法：python scripts/test-tencent-sign.py
前提：需设置环境变量 TENCENT_MAP_KEY / TENCENT_MAP_SK

注意：原 .mjs 手动读取项目根 .env 加载密钥；Python 进程不会自动加载 .env，
      运行前请手动设置环境变量，例如（PowerShell）：
        $env:TENCENT_MAP_KEY="..."; $env:TENCENT_MAP_SK="..."

说明：TencentMapAdapter 目前无 HTTP 桥端点（geocode / searchNearby），
      因此此处按 src/services/map/tencent-key-pool.js:119 signWsRequest 的
      算法在 Python 侧等价实现签名，并直接调用腾讯地图 WebService API。
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

import requests

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402,F401  (统一 UTF-8 stdout 修复)

BASE_URL = "https://apis.map.qq.com/ws"

KEY = os.environ.get("TENCENT_MAP_KEY", "")
SK = os.environ.get("TENCENT_MAP_SK", "")

print("TENCENT_MAP_KEY:", KEY)
print("TENCENT_MAP_SK:", (SK[:8] + "...") if SK else "None")


def sign_ws_request(ws_path: str, params: dict, key: str, sk: str) -> str:
    """等价于 signWsRequest(wsPath, params, { key, sk })。

    算法：/ws<endpoint>?<按 key 名排序的 k=v 未编码串><SK> → MD5 hex
    """
    if not sk:
        return ""
    sign_params = {k: v for k, v in params.items() if k != "sig"}
    sign_params["key"] = key
    sorted_query = "&".join(f"{k}={sign_params[k]}" for k in sorted(sign_params))
    raw = f"{ws_path}?{sorted_query}{sk}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def build_url(endpoint: str, params: dict) -> str:
    """等价于 TencentMapAdapter._buildUrl(endpoint, params)。"""
    usable = {k: v for k, v in params.items() if v is not None}
    param_str = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in usable.items())
    if param_str:
        url = f"{BASE_URL}{endpoint}?{param_str}&key={KEY}"
    else:
        url = f"{BASE_URL}{endpoint}?key={KEY}"
    sig = sign_ws_request(f"/ws{endpoint}", usable, KEY, SK)
    if sig:
        url += "&sig=" + sig
    return url


def ws_get(endpoint: str, params: dict) -> dict:
    """等价于 TencentMapAdapter._get(endpoint, params)（不含多 Key 轮换）。"""
    if not KEY:
        raise RuntimeError("未配置 TENCENT_MAP_KEY")
    resp = requests.get(build_url(endpoint, params), timeout=30)
    data = resp.json()
    if data.get("status") != 0:
        raise RuntimeError(f"腾讯地图API错误: status={data.get('status')} {data.get('message')}")
    return data


def geocode(address: str) -> dict:
    """等价于 adapter.geocode(address)。"""
    result = ws_get("/geocoder/v1/", {"address": address})
    r = result.get("result") or {}
    loc = r.get("location") or {}
    return {
        "lat": loc.get("lat"),
        "lng": loc.get("lng"),
        "formatted_address": r.get("address") or address,
        "precision": r.get("precision") or 0,
    }


def search_nearby(keyword: str, lat: float, lng: float, radius: int = 1000, page_size: int = 10) -> list[dict]:
    """等价于 adapter.searchNearby(keyword, lat, lng, radius, pageSize)。"""
    result = ws_get(
        "/place/v1/search",
        {
            "keyword": keyword,
            "boundary": f"nearby({lat},{lng},{radius})",
            "page_size": page_size,
            "page_index": 1,
        },
    )
    pois = result.get("data") or []
    out = []
    for poi in pois:
        loc = poi.get("location") or {}
        out.append(
            {
                "id": poi.get("id") or "",
                "title": poi.get("title") or "",
                "address": poi.get("address") or "",
                "tel": poi.get("tel") or "",
                "type": poi.get("type") or "",
                "category": poi.get("category") or "",
                "location": {"lat": loc.get("lat") or 0, "lng": loc.get("lng") or 0},
            }
        )
    return out


# 测试1: 地理编码
try:
    print('\n--- Test 1: Geocode "防城港" ---')
    result = geocode("防城港")
    print("✅ Geocode OK:", json.dumps(result, ensure_ascii=False))
except Exception as err:
    print("❌ Geocode failed:", err)

# 测试2: 周边搜索（wellness 补充场景）
try:
    print('\n--- Test 2: searchNearby "医院 药店" ---')
    pois = search_nearby("医院 药店", 21.527905, 108.166816, 15000, 5)
    print("✅ searchNearby OK:", len(pois), "POIs")
    if pois:
        print("  Sample:", pois[0]["title"], "|", pois[0]["address"])
except Exception as err:
    print("❌ searchNearby failed:", err)
