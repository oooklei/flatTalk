#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证两处修复：
  1. followup 短路时按 action_key 选对模板（点「生成一周计划」出 weekly_plan）
  2. LIS 次意图按钮 label 不再泄漏内部 description

（verify-followup-fix.mjs 的 Python 等价实现）

用法：python scripts/verify-followup-fix.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

BASE_URL = os.environ.get("FLATTALK_BASE_URL", "http://127.0.0.1:5298").rstrip("/")
OUT_FILE = _ROOT / "build" / "fix-verify.txt"

SAMPLES = [
    "meal_plan / weekly_plan：一周、七天、周计划、本周",
    "meal_plan / overview：总览、概览",
    "dispatch_manage / dispatch_accept：接单、接、确认接",
    "查看派单列表与工单",
    "养老政策补贴适老化咨询",
    "common / elder_policy_benefit：补贴、津贴、长护险、养老金",
    "",
]

CASES = [
    ("meal_plan.generate_weekly_plan", "请基于这份膳食建议生成一周三餐计划", "weekly_plan"),
    ("meal_plan.adjust_for_condition", "请结合老人的健康状况调整这份膳食建议", None),
]


def main() -> int:
    client = FlatTalkClient(timeout=180)
    out: list[str] = []

    # ── 1. label 清洗单元验证 ──
    out.append("=== 1. intent_desc → 按钮文案 清洗 ===")
    for s in SAMPLES:
        r = client.humanize_intent_label(s)
        left = json.dumps(s, ensure_ascii=False).ljust(52)
        out.append(f"  {left} -> {json.dumps(r, ensure_ascii=False)}")

    # ── 2. followup 短路选模板 ──
    out.append("")
    out.append("=== 2. followup 点击 → 模板 ===")

    for action_key, prompt, want_tpl in CASES:
        conversation_id = f"v-{int(time.time() * 1000)}-{random.random()}"
        status, j = post("/api/chat/followup", {
            "message": prompt,
            "conversation_id": conversation_id,
            "role": "elder",
            "skill_key": "meal_plan",
            "context": {"followup_source": "card", "action_key": action_key},
        })
        j = j or {}
        data = j.get("data") or {}
        page_html = j.get("rendered_html") or data.get("rendered_html") or ""
        week_days = len(re.findall(r"周[一二三四五六日]", page_html))
        items = len(((data.get("weekly_plan") or {}).get("items")) or [])
        template_id = j.get("template_id")
        ok = (template_id == want_tpl) if want_tpl else True
        out.append(
            f"  {'OK ' if ok else '!! '}{action_key}"
            f"\n      template_id={template_id} (want {want_tpl or '任意'})"
            f"\n      weekly items={items}  HTML\"周X\"={week_days} 次  http={status}"
        )

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text("\n".join(out), encoding="utf-8")
    print("done")
    print(f"输出: {OUT_FILE}")
    return 0


def post(path: str, body: dict[str, Any]) -> tuple[int, dict | None]:
    try:
        resp = requests.post(
            f"{BASE_URL}{path}",
            json=body,
            headers={"Content-Type": "application/json"},
            timeout=180,
        )
    except requests.RequestException:
        return 0, None
    try:
        return resp.status_code, resp.json()
    except ValueError:
        return resp.status_code, None


if __name__ == "__main__":
    sys.exit(main())
