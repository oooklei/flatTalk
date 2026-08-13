#!/usr/bin/env python3
"""Bootstrap FlyAI KB docs for sojourn-map seeds.

Python 版，替代 flyai-bootstrap-19.mjs。

用法:
    python scripts/flyai-bootstrap-19.py
    python scripts/flyai-bootstrap-19.py --only=bama_5d4n
    python scripts/flyai-bootstrap-19.py --dry-run
"""
import json
import sys
import time
from pathlib import Path

from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path(__file__).resolve().parent.parent
SEEDS_PATH = ROOT / "data" / "flyai-kb" / "seeds.json"
KB_BASE_DIR = str(ROOT / "data" / "flyai-kb")


def parse_args(argv):
    opts = {"dry_run": False, "only": None}
    for arg in argv:
        if arg == "--dry-run":
            opts["dry_run"] = True
        elif arg.startswith("--only="):
            opts["only"] = arg[len("--only="):].strip() or None
    return opts


def as_markdown(data):
    if isinstance(data, str):
        return data
    if data is None:
        return ""
    if isinstance(data, dict):
        for key in ("markdown", "content", "result"):
            if isinstance(data.get(key), str):
                return data[key]
    return ""


def as_item_list(data):
    if not data:
        return []
    if isinstance(data, dict) and "itemList" in data:
        return data["itemList"]
    if isinstance(data, list):
        return data
    return []


def bootstrap_one(client, seed, dry_run):
    started = time.time()
    linked_route_id = seed.get("linked_route_id", "")
    destination = seed.get("destination", "")
    city_name = seed.get("city_name", "")
    keywords = seed.get("keywords", [])
    query = seed.get("query", "")

    # 并行调用三个 flyai 接口（通过桥端点，HTTP 层并行由 requests 处理）
    ai_res = client.flyai_ai_search(query)
    poi_res = client.flyai_search_poi(keyword=destination, city_name=city_name)
    kw_res = client.flyai_keyword_search(query)

    failures = []
    if not ai_res.get("ok"):
        failures.append(f"aiSearch:{ai_res.get('error', 'failed')}")
    if not poi_res.get("ok"):
        failures.append(f"searchPoi:{poi_res.get('error', 'failed')}")
    if not kw_res.get("ok"):
        failures.append(f"keywordSearch:{kw_res.get('error', 'failed')}")

    ai_markdown = as_markdown(ai_res.get("data"))
    poi_list = as_item_list(poi_res.get("data"))
    products = as_item_list(kw_res.get("data"))

    if not ai_markdown and len(failures) == 3:
        raise RuntimeError("; ".join(failures))

    doc = client.normalize_flyai_doc(
        linked_route_id=linked_route_id,
        query=query,
        ai_markdown=ai_markdown,
        poi_list=poi_list,
        products=products,
        keywords=keywords,
    )
    doc["destination"] = destination
    doc["city_name"] = city_name

    written = None
    if not dry_run:
        written = client.flyai_kb_upsert_doc(doc, base_dir=KB_BASE_DIR)

    elapsed_ms = int((time.time() - started) * 1000)
    return {
        "linked_route_id": linked_route_id,
        "ok": True,
        "dry_run": dry_run,
        "waypoints": len(doc.get("waypoints") or []),
        "products": len(doc.get("products") or []),
        "content_hash": doc.get("content_hash", ""),
        "path": written.get("path") if written else None,
        "partial_errors": failures if failures else None,
        "ms": elapsed_ms,
    }


def main():
    opts = parse_args(sys.argv[1:])
    seeds_file = json.loads(SEEDS_PATH.read_text(encoding="utf-8"))
    seeds = seeds_file.get("seeds", []) if isinstance(seeds_file, dict) else []

    if opts["only"]:
        seeds = [s for s in seeds if s.get("linked_route_id") == opts["only"]]
        if not seeds:
            summary = {
                "ok": False,
                "error": f"seed_not_found:{opts['only']}",
                "total": 0,
                "succeeded": 0,
                "failed": 0,
                "results": [],
            }
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            sys.exit(1)

    client = FlatTalkClient()
    results = []
    for seed in seeds:
        try:
            row = bootstrap_one(client, seed, opts["dry_run"])
            results.append(row)
        except Exception as err:
            results.append({
                "linked_route_id": seed.get("linked_route_id"),
                "ok": False,
                "dry_run": opts["dry_run"],
                "error": str(err),
            })

    succeeded = sum(1 for r in results if r.get("ok"))
    failed = len(results) - succeeded
    summary = {
        "ok": failed == 0,
        "dry_run": opts["dry_run"],
        "only": opts["only"],
        "total": len(results),
        "succeeded": succeeded,
        "failed": failed,
        "results": results,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(json.dumps({
            "ok": False,
            "error": str(err),
            "total": 0,
            "succeeded": 0,
            "failed": 0,
            "results": [],
        }, ensure_ascii=False, indent=2))
        sys.exit(1)
