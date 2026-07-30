#!/usr/bin/env python3
"""Remote-required backend runtime for guixiaoyang_dispatch."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "manifest.json").exists())


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def compact(value, limit=900):
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[:limit] + "..."


def manifest():
    return read_json(ROOT / "manifest.json")


def action_map():
    return read_json(ROOT / "platform" / "action-map.json")


def seed_rows(seed_file):
    path = ROOT / seed_file
    if not path.exists():
        return 0
    data = read_json(path)
    rows = data.get("rows") if isinstance(data, dict) else data
    return len(rows) if isinstance(rows, list) else 0


def audit():
    meta = manifest()
    return {
        "ok": True,
        "packageKey": meta.get("key"),
        "remoteRequired": True,
        "businessLogicPolicy": "remote-execution-required",
        "templateContract": meta.get("templateContract", {}),
        "knowledgeBases": meta.get("knowledgeBases", []),
        "dataTables": [
            {**table, "rows": seed_rows(table.get("seedFile", ""))}
            for table in meta.get("dataTables", [])
        ],
        "workflows": meta.get("workflows", []),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


def render(request):
    meta = manifest()
    actions = action_map().get("actions", [])
    action_keys = {item.get("action_key") for item in actions}
    preferred_action = request.get("action_key") or "guixiaoyang_dispatch.collect_context"
    if preferred_action not in action_keys:
        preferred_action = "guixiaoyang_dispatch.collect_context"

    answer = compact(request.get("answer") or request.get("message") or "远端女娲执行结果为空，已进入调度兜底。")
    return {
        "ok": True,
        "packageKey": meta.get("key"),
        "schema": "guixiaoyang.render-document.v1",
        "skill_key": "guixiaoyang_dispatch",
        "intent_key": request.get("intent_key", "general_dispatch"),
        "template_id": request.get("template_id", "guixiaoyang_dispatch.status.v1"),
        "render_document": {
            "template_id": request.get("template_id", "guixiaoyang_dispatch.status.v1"),
            "slots": request.get("slots", ["intent-summary", "action-bar"]),
            "data": {
                "summary": {
                    "badge": "桂小养调度",
                    "title": request.get("title") or meta.get("name") or meta.get("key"),
                    "text": answer,
                },
                "status": {
                    "level": "执行状态",
                    "title": request.get("title") or "调度结果",
                    "message": answer,
                    "items": ["模板合同已切换为对话内渲染", "动作执行使用注册 action_key"],
                },
                "primary_action": {
                    "label": "继续处理",
                    "action_key": preferred_action,
                },
                "secondary_action": {
                    "label": "语音播报",
                    "action_key": "guixiaoyang_dispatch.voice_broadcast",
                },
            },
        },
        "actions": [
            {"action_key": preferred_action, "label": "继续处理"},
            {"action_key": "guixiaoyang_dispatch.voice_broadcast", "label": "语音播报"},
        ],
    }


def page(request):
    rendered = render(request)
    doc = rendered.get("render_document", {})
    data = doc.get("data", {})
    summary = data.get("summary", {})
    status = data.get("status", {})
    text = compact(request.get("text") or request.get("answer") or request.get("message") or status.get("message") or "")
    return {
        "ok": True,
        "packageKey": manifest().get("key"),
        "page": {
            "schema": "guixiaoyang.chat-template.v1",
            "title": request.get("title") or summary.get("title") or manifest().get("name") or manifest().get("key"),
            "blocks": [
                {
                    "type": "render_document",
                    "document": doc,
                }
            ],
            "outputs": [
                {
                    "id": "voice_broadcast",
                    "type": "speech",
                    "action_key": "guixiaoyang_dispatch.voice_broadcast",
                    "text": text,
                    "lang": request.get("lang", "zh-CN"),
                }
            ],
        },
    }


def speech(request):
    return {
        "ok": True,
        "packageKey": manifest().get("key"),
        "output": {
            "type": "speech",
            "action_key": "guixiaoyang_dispatch.voice_broadcast",
            "text": compact(request.get("text") or request.get("message") or ""),
            "lang": request.get("lang", "zh-CN"),
            "engine": "browser-speech-synthesis",
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["audit", "render", "page", "speech"])
    args = parser.parse_args()
    raw = sys.stdin.read().strip()
    request = json.loads(raw) if raw else {}
    payload = audit() if args.command == "audit" else render(request) if args.command == "render" else page(request) if args.command == "page" else speech(request)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
