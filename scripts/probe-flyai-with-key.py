#!/usr/bin/env python3
"""FlyAI key probe — key via env FLYAI_API_KEY only; never printed.

Python 版，替代 probe-flyai-with-key.mjs。
通过函数桥端点调用 flyai CLI（桥内部 spawn flyai 进程）。
"""
import json
import os
import subprocess
import time
from pathlib import Path

from flattalk_client import FlatTalkClient, FlatTalkError

OUT = Path(__file__).resolve().parent.parent / "scripts" / "test-output" / "flyai-probe"
OUT.mkdir(parents=True, exist_ok=True)

key = os.environ.get("FLYAI_API_KEY", "")
print(f"key_set {bool(key)} key_len {len(key)} key_prefix {key[:5]}...")


def run(client, method, out_name, **kwargs):
    """调用桥端点并保存输出。"""
    print(f"\n=== {method}({kwargs}) ===")
    started = time.time()
    try:
        if method == "keyword_search":
            result = client.flyai_keyword_search(**kwargs)
        elif method == "ai_search":
            result = client.flyai_ai_search(**kwargs)
        elif method == "search_poi":
            result = client.flyai_search_poi(**kwargs)
        else:
            raise ValueError(f"unknown method: {method}")
    except FlatTalkError as e:
        elapsed = int((time.time() - started) * 1000)
        print(f"BRIDGE_ERROR {e} elapsed_ms={elapsed}")
        (OUT / f"{out_name}.error.txt").write_text(str(e), encoding="utf-8")
        return None

    elapsed = int((time.time() - started) * 1000)
    print(f"ok={result.get('ok')} elapsed_ms={elapsed}")

    # 保存原始响应
    (OUT / f"{out_name}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    data = result.get("data") or {}
    if isinstance(data, dict):
        item_list = data.get("itemList") or data.get("items") or data.get("list") or []
    elif isinstance(data, list):
        item_list = data
    else:
        item_list = []

    print(f"itemList {len(item_list) if isinstance(item_list, list) else 'n/a'}")
    if isinstance(item_list, list):
        for i, item in enumerate(item_list[:8]):
            info = item.get("info", item) if isinstance(item, dict) else {}
            print(
                f"  {i+1:02d} | {info.get('title') or info.get('name') or '(no title)'} "
                f"| price={info.get('price')} | lat={info.get('latitude')}"
            )

    sample = json.dumps(result, ensure_ascii=False, indent=2)[:1200]
    print(f"sample:\n{sample}")
    return result


# persist key for CLI config (optional enhanced path)
cfg = subprocess.run(
    ["flyai", "config", "set", "FLYAI_API_KEY", key],
    capture_output=True, text=True, shell=True,
)
cfg_out = (cfg.stderr or cfg.stdout or "")[:200].replace(key, "***")
print(f"config set status {cfg.returncode} {cfg_out}")

client = FlatTalkClient(timeout=180)

run(client, "keyword_search", "withkey-keyword-bama", query="我想去巴马旅游")
run(client, "ai_search", "withkey-ai-bama", query="我想去巴马旅游", timeout_ms=150000)
run(client, "search_poi", "withkey-poi-bama", keyword="巴马", city_name="河池")

print("\n=== done ===")
print(f"out {OUT}")
