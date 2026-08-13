#!/usr/bin/env python3
"""Nightly refresh of FlyAI KB docs — re-fetch live data and upsert when content_hash changes.

Python 版，替代 flyai-nightly-refresh.mjs。

Cron (daily at midnight):
    0 0 * * * cd /path/to/flatTalk && python scripts/flyai-nightly-refresh.py

用法:
    python scripts/flyai-nightly-refresh.py
    python scripts/flyai-nightly-refresh.py --dry-run
    python scripts/flyai-nightly-refresh.py --only=bama_5d4n
"""
import json
import sys
import time
from pathlib import Path

from flattalk_client import FlatTalkClient

ROOT = Path(__file__).resolve().parent.parent
SEEDS_PATH = ROOT / "data" / "flyai-kb" / "seeds.json"
SUMMARY_PATH = Path(__file__).resolve().parent / "test-output" / "flyai-probe" / "nightly-last.json"
KB_BASE_DIR = str(ROOT / "data" / "flyai-kb")


def parse_args(argv):
    opts = {"dry_run": False, "only": None}
    for arg in argv:
        if arg == "--dry-run":
            opts["dry_run"] = True
        elif arg.startswith("--only="):
            opts["only"] = arg[len("--only="):].strip() or None
    return opts


def load_seeds_map(seeds_path=SEEDS_PATH):
    seeds_file = json.loads(seeds_path.read_text(encoding="utf-8"))
    seeds = seeds_file.get("seeds", []) if isinstance(seeds_file, dict) else []
    return {s["linked_route_id"]: s for s in seeds if "linked_route_id" in s}


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


def should_skip_refresh(previous_hash, next_hash):
    return bool(previous_hash and next_hash and previous_hash == next_hash)


def refresh_one_doc(client, existing_doc, seed, dry_run=False):
    started = time.time()
    linked_route_id = existing_doc.get("linked_route_id")

    if not linked_route_id:
        return {
            "linked_route_id": None,
            "ok": False,
            "error": "missing_linked_route_id",
            "ms": int((time.time() - started) * 1000),
        }

    if not seed:
        return {
            "linked_route_id": linked_route_id,
            "ok": False,
            "error": "seed_not_found",
            "ms": int((time.time() - started) * 1000),
        }

    destination = seed.get("destination", "")
    city_name = seed.get("city_name", "")
    keywords = seed.get("keywords", [])
    query = seed.get("query", "")
    search_query = query or existing_doc.get("query", "") or (keywords[0] if keywords else "") or destination

    ai_res = client.flyai_ai_search(search_query)
    poi_res = client.flyai_search_poi(
        keyword=destination or existing_doc.get("destination", "") or (keywords[0] if keywords else ""),
        city_name=city_name or existing_doc.get("city_name", ""),
    )
    kw_res = client.flyai_keyword_search(search_query)

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
        query=search_query,
        ai_markdown=ai_markdown,
        poi_list=poi_list,
        products=products,
        keywords=keywords or existing_doc.get("keywords", []),
    )
    doc["destination"] = destination or existing_doc.get("destination", "")
    doc["city_name"] = city_name or existing_doc.get("city_name", "")

    previous_hash = existing_doc.get("content_hash")
    content_hash = doc.get("content_hash", "")

    if should_skip_refresh(previous_hash, content_hash):
        return {
            "linked_route_id": linked_route_id,
            "ok": True,
            "action": "skipped",
            "content_hash": content_hash,
            "dry_run": dry_run,
            "partial_errors": failures if failures else None,
            "ms": int((time.time() - started) * 1000),
        }

    if dry_run:
        return {
            "linked_route_id": linked_route_id,
            "ok": True,
            "action": "would_update",
            "content_hash": content_hash,
            "previous_hash": previous_hash or None,
            "dry_run": True,
            "partial_errors": failures if failures else None,
            "ms": int((time.time() - started) * 1000),
        }

    written = client.flyai_kb_upsert_doc(doc, base_dir=KB_BASE_DIR)
    return {
        "linked_route_id": linked_route_id,
        "ok": True,
        "action": "updated",
        "content_hash": content_hash,
        "previous_hash": previous_hash or None,
        "path": written.get("path") if written else None,
        "dry_run": False,
        "partial_errors": failures if failures else None,
        "ms": int((time.time() - started) * 1000),
    }


def run_nightly_refresh(dry_run=False, only=None, client=None):
    client = client or FlatTalkClient()
    seeds_map = load_seeds_map()
    docs = client.flyai_kb_list_docs(base_dir=KB_BASE_DIR)

    if only:
        docs = [d for d in docs if d.get("linked_route_id") == only]
        if not docs:
            summary = {
                "ok": False,
                "error": f"doc_not_found:{only}",
                "dry_run": dry_run,
                "only": only,
                "total": 0,
                "succeeded": 0,
                "failed": 0,
                "skipped": 0,
                "updated": 0,
                "results": [],
                "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
            SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return summary

    results = []
    for existing_doc in docs:
        seed = seeds_map.get(existing_doc.get("linked_route_id"))
        try:
            row = refresh_one_doc(client, existing_doc, seed, dry_run)
            results.append(row)
        except Exception as err:
            results.append({
                "linked_route_id": existing_doc.get("linked_route_id"),
                "ok": False,
                "dry_run": dry_run,
                "error": str(err),
            })

    succeeded = sum(1 for r in results if r.get("ok"))
    failed = len(results) - succeeded
    skipped = sum(1 for r in results if r.get("ok") and r.get("action") == "skipped")
    updated = sum(1 for r in results if r.get("ok") and r.get("action") in ("updated", "would_update"))

    summary = {
        "ok": failed == 0,
        "dry_run": dry_run,
        "only": only,
        "total": len(results),
        "succeeded": succeeded,
        "failed": failed,
        "skipped": skipped,
        "updated": updated,
        "results": results,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main():
    opts = parse_args(sys.argv[1:])
    summary = run_nightly_refresh(opts["dry_run"], opts["only"])
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if summary.get("failed", 0) > 0 or summary.get("error"):
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
            "skipped": 0,
            "updated": 0,
            "results": [],
        }, ensure_ascii=False, indent=2))
        sys.exit(1)
