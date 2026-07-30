#!/usr/bin/env python3
"""Render-document backend runtime for meal_plan."""
from __future__ import annotations
import argparse, json, sys
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
        "businessLogicPolicy": "local-materials-validation-and-remote-execution-required",
        "knowledgeBases": meta.get("knowledgeBases", []),
        "dataTables": [{**table, "rows": seed_rows(table.get("seedFile", ""))} for table in meta.get("dataTables", [])],
        "workflows": meta.get("workflows", []),
        "templateContract": meta.get("templateContract", {}),
        "generatedAt": datetime.now(timezone.utc).isoformat()
    }

def render(request):
    meta = manifest()
    registry = read_json(ROOT / "templates" / "registry.json")
    action_map = read_json(ROOT / "platform" / "action-map.json")
    requested_template = request.get("template_id") or "meal_plan.plan.v1"
    templates = {item.get("template_id"): item for item in registry.get("templates", [])}
    template = templates.get(requested_template) or templates.get("meal_plan.plan.v1") or next(iter(templates.values()))
    action_keys = {item.get("action_key") for item in action_map.get("actions", [])}
    requested_action = request.get("action_key")
    selected_action = requested_action if requested_action in action_keys else None
    followup_path = template.get("followup_suggestions")
    followups = read_json(ROOT / followup_path).get("suggestions", []) if followup_path and (ROOT / followup_path).exists() else []
    answer = compact(request.get("answer") or request.get("message") or "Remote Nuwax execution is required.")
    return {
        "ok": True,
        "packageKey": meta.get("key"),
        "document": {
            "schema": "guixiaoyang.render-document.v1",
            "skill_key": meta.get("key"),
            "template_id": template.get("template_id"),
            "template_html": "templates/html/" + str(template.get("html")),
            "title": request.get("title") or template.get("name") or meta.get("name") or meta.get("key"),
            "answer": answer,
            "action_key": selected_action,
            "actions": template.get("actions", []),
            "followup_suggestions": followups,
            "bff_validation": [
                "template_id_registered",
                "template_html_exists",
                "action_key_registered",
                "followup_action_key_registered"
            ]
        }
    }

def page(request):
    rendered = render(request)
    document = rendered.get("document", {})
    text = compact(request.get("text") or request.get("answer") or request.get("message") or document.get("answer") or "")
    return {
        "ok": True,
        "packageKey": manifest().get("key"),
        "page": {
            "schema": "guixiaoyang.chat-template.v1",
            "title": request.get("title") or document.get("title") or manifest().get("name") or manifest().get("key"),
            "blocks": [
                {
                    "type": "render_document",
                    "document": document,
                }
            ],
            "outputs": [
                {
                    "id": "voice_broadcast",
                    "type": "speech",
                    "action_key": "meal_plan.voice_broadcast",
                    "text": text,
                    "lang": request.get("lang", "zh-CN"),
                }
            ],
        },
    }

def speech(request):
    return {"ok": True, "packageKey": manifest().get("key"), "output": {"type": "speech", "text": compact(request.get("text") or request.get("message") or ""), "lang": request.get("lang", "zh-CN"), "engine": "browser-speech-synthesis"}}

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
