#!/usr/bin/env python3
"""用不同城市和参数搜索金跳动产品。

Python 版，替代 test-jtd-search.mjs。
用法: python scripts/test-jtd-search.py
"""
import json
import re
from pathlib import Path

from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path(__file__).resolve().parent.parent


def load_env():
    """从 .env 文件加载环境变量（不覆盖已有的）。"""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    text = env_path.read_text(encoding="utf-8")
    for line in text.splitlines():
        m = re.match(r"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$", line)
        if m:
            key, val = m.group(1), m.group(2)
            if key not in __import__("os").environ:
                __import__("os").environ[key] = val


def main():
    load_env()
    client = FlatTalkClient()

    # 尝试不同搜索参数
    searches = [
        {"tenantId": "042788", "productDomain": "sojourn_route", "pageSize": 10},
        {"tenantId": "042788", "productDomain": "sojourn_base", "pageSize": 10},
        {"tenantId": "042788", "productDomain": "sojourn_route", "destinationCity": "广西", "pageSize": 10},
        {"tenantId": "042788", "productDomain": "sojourn_route", "destinationCity": "巴马", "pageSize": 10},
        {"tenantId": "042788", "productDomain": "sojourn_route", "keyword": "康养", "pageSize": 10},
    ]

    for q in searches:
        print(f"\n--- 搜索: {json.dumps(q, ensure_ascii=False)} ---")
        try:
            r = client.jtd_search_products(query=q)
        except FlatTalkError as e:
            print(f"调用失败: {e}")
            continue

        print(f"ok: {r.get('ok')} source: {r.get('source_status')}")
        if not r.get("ok"):
            print(f"error: {r.get('error')} msg: {r.get('message')}")
            continue

        data = (r.get("response") or {}).get("data") or {}
        if isinstance(data, dict):
            items = data.get("items") or data.get("list") or data.get("result") or []
        elif isinstance(data, list):
            items = data
        else:
            items = []

        print(f"items count: {len(items)}")
        if items:
            first = items[0]
            print(f"first product: {json.dumps(first, ensure_ascii=False, indent=2)[:3000]}")
            break
        else:
            print(f"data keys: {list(data.keys()) if isinstance(data, dict) else 'n/a'}")
            print(f"data preview: {json.dumps(data, ensure_ascii=False)[:500]}")


if __name__ == "__main__":
    main()
