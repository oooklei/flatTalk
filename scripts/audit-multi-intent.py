#!/usr/bin/env python3
"""核查「多意图 → 1 模板」在各层的真实情况。

Python 版，替代 audit-multi-intent.mjs。
用法: python scripts/audit-multi-intent.py
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
BUILD_DIR.mkdir(parents=True, exist_ok=True)

lines = []
client = FlatTalkClient()

# ── 层 1：catalog 静态绑定 ──
catalog = json.loads((ROOT / "config" / "intent-catalog.json").read_text(encoding="utf-8"))
by_tpl = defaultdict(list)
for i in catalog.get("intents", []):
    t = (i.get("entry") or {}).get("template_id") or ""
    if not t:
        continue
    by_tpl[t].append(i.get("intent_id"))

dup_catalog = [(t, ids) for t, ids in by_tpl.items() if len(ids) > 1]
lines.append("=== 层1: catalog entry.template_id ===")
lines.append(f"  意图 {len(catalog.get('intents', []))}，模板 {len(by_tpl)}，多对一 {len(dup_catalog)}")
for t, ids in dup_catalog:
    lines.append(f"    {t} <- {', '.join(ids)}")

# ── 层 2：followups 的 action_key -> template_id ──
lines.append("")
lines.append("=== 层2: followups JSON 里 action_key -> template_id ===")
action_to_tpl = defaultdict(set)
fu_root = ROOT / "src" / "skills"
for skill_dir in fu_root.iterdir():
    fu_dir = skill_dir / "templates" / "followups"
    if not fu_dir.is_dir():
        continue
    for f in fu_dir.glob("*.json"):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for b in (j.get("followup_suggestions") or j.get("followups") or []):
            ak = b.get("action_key") or ""
            if not ak:
                continue
            try:
                result = client.template_id_from_action(action_key=ak)
                derived = result.get("template_id", "")
            except FlatTalkError:
                derived = ""
            action_to_tpl[derived].add(ak)

dup_action = [(t, aks) for t, aks in action_to_tpl.items() if len(aks) > 1]
lines.append(f"  action_key 去重后映射到 {len(action_to_tpl)} 个模板，多对一 {len(dup_action)}")
for t, aks in sorted(dup_action, key=lambda x: -len(x[1])):
    lines.append(f"    {t}  <- {', '.join(aks)}")

# ── 层 3：followups 的 user_prompt 是否够区分 ──
lines.append("")
lines.append("=== 层3: followups 的 user_prompt 是否够区分 ===")
prompts = defaultdict(list)
for skill_dir in fu_root.iterdir():
    fu_dir = skill_dir / "templates" / "followups"
    if not fu_dir.is_dir():
        continue
    for f in fu_dir.glob("*.json"):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for b in (j.get("followup_suggestions") or j.get("followups") or []):
            p = str(b.get("user_prompt") or "").strip()
            if not p:
                continue
            prompts[p].append(f"{f.name}:{b.get('action_key') or b.get('label') or ''}")

dup_prompt = [(p, where) for p, where in prompts.items() if len(where) > 1]
lines.append(f"  不同按钮共用同一 user_prompt: {len(dup_prompt)} 组")
for p, where in dup_prompt[:12]:
    lines.append(f'    "{p[:40]}"  <- {len(where)} 处: {" | ".join(where[:3])}')

# ── 层 4：无 action_key 的按钮 ──
lines.append("")
lines.append("=== 层4: 缺 action_key 的追问按钮（全靠语义重识别）===")
no_ak = 0
total = 0
for skill_dir in fu_root.iterdir():
    fu_dir = skill_dir / "templates" / "followups"
    if not fu_dir.is_dir():
        continue
    for f in fu_dir.glob("*.json"):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for b in (j.get("followup_suggestions") or j.get("followups") or []):
            total += 1
            if not b.get("action_key"):
                no_ak += 1

lines.append(f"  按钮总数 {total}，其中无 action_key {no_ak}")

output = "\n".join(lines)
(BUILD_DIR / "multi-intent-audit.txt").write_text(output, encoding="utf-8")
print("done")
