#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
临时验证：实体回写创建链路 + tag-system HTTP API 创建端点探测
（verify-entity-writeback.mjs 的 Python 等价实现）

用法：python scripts/verify-entity-writeback.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import requests

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

PG_URL = "postgresql://postgres:123456@localhost:5432/tag_system"
API_URL = "http://localhost:5173"
TEST_ENTITY_ID = "ELDER_VERIFY_TEST_001"

INSERT_SQL = """
  INSERT INTO entity_record (entity_type, entity_id, entity_name, basic_info, status, tags_count, created_by)
  VALUES ('ELDER', $1, '验证测试老人', '{"source":"flattalk_verify"}'::json, 'ACTIVE', 0, 'flattalk')
  RETURNING id, entity_id, entity_name, status, basic_info
"""

UPSERT_SQL = """
  INSERT INTO entity_record (entity_type, entity_id, entity_name, basic_info, status, tags_count, created_by)
  VALUES ('ELDER', $1, '验证测试老人_更新', '{"source":"flattalk_verify","v":2}'::json, 'ACTIVE', 0, 'flattalk')
  ON CONFLICT (entity_type, entity_id)
  DO UPDATE SET entity_name = EXCLUDED.entity_name, basic_info = EXCLUDED.basic_info, updated_at = CURRENT_TIMESTAMP
  RETURNING id, entity_id, entity_name, status
"""

ENDPOINTS = [
    ("POST", "/api/v1/tags/entities"),
    ("POST", "/api/v1/entities"),
    ("POST", "/api/v1/tag-system/entities"),
]


def main() -> int:
    client = FlatTalkClient(timeout=120)

    def query(sql: str, params: list | None = None) -> dict:
        args = [sql] if params is None else [sql, params]
        return client.tag_system_biz("query", args=args, pg_url=PG_URL) or {}

    print("\n" + "═" * 55)
    print("  实体回写创建链路验证")
    print("═" * 55 + "\n")

    # ---------- 1. 清理可能残留的测试数据 ----------
    print("── [1] 清理残留测试数据 ──")
    cleanup = query("DELETE FROM entity_record WHERE entity_id = $1", [TEST_ENTITY_ID])
    print("  结果:", cleanup.get("ok"), "删除:", cleanup.get("rowCount"))

    # ---------- 2. INSERT 创建实体 ----------
    print(f"\n── [2] INSERT 创建实体 ({TEST_ENTITY_ID}) ──")
    insert_res = query(INSERT_SQL, [TEST_ENTITY_ID])
    print("  请求: INSERT INTO entity_record ... entity_id =", TEST_ENTITY_ID)
    print("  响应:", indent(json.dumps(insert_res, ensure_ascii=False, indent=2, default=str)))
    print("  ", "✓ PASS" if insert_res.get("ok") else "✗ FAIL")

    # ---------- 3. 验证写入成功（SELECT 回读） ----------
    print("\n── [3] SELECT 回读验证 ──")
    select_res = query(
        "SELECT id, entity_id, entity_name, status, tags_count FROM entity_record WHERE entity_id = $1",
        [TEST_ENTITY_ID],
    )
    rows = select_res.get("rows") or []
    print("  请求: SELECT ... WHERE entity_id =", TEST_ENTITY_ID)
    print("  响应:", indent(json.dumps(rows, ensure_ascii=False, indent=2, default=str)))
    print("  ", "✓ PASS" if select_res.get("ok") and len(rows) == 1 else "✗ FAIL")

    # ---------- 4. 重复 INSERT 应触发唯一约束冲突 ----------
    print("\n── [4] 重复 INSERT 触发 UNIQUE 约束冲突 ──")
    dup_res = query(INSERT_SQL, [TEST_ENTITY_ID])
    print("  响应:", json.dumps({
        "ok": dup_res.get("ok"),
        "error": dup_res.get("error"),
        "code": dup_res.get("code"),
    }, ensure_ascii=False, indent=2))
    constraint_hit = (
        not dup_res.get("ok")
        and bool(re.search(r"unique|duplicate", str(dup_res.get("error") or ""), re.IGNORECASE))
    )
    print("  ", "✓ PASS (约束生效)" if constraint_hit else "✗ FAIL")

    # ---------- 5. UPSERT 模式（ON CONFLICT 更新） ----------
    print("\n── [5] UPSERT 模式 (ON CONFLICT 更新 entity_name) ──")
    upsert_res = query(UPSERT_SQL, [TEST_ENTITY_ID])
    upsert_rows = upsert_res.get("rows") or []
    print("  请求: INSERT ... ON CONFLICT (entity_type, entity_id) DO UPDATE ...")
    print("  响应:", indent(json.dumps(upsert_rows, ensure_ascii=False, indent=2, default=str)))
    upsert_ok = (
        upsert_res.get("ok")
        and upsert_rows
        and upsert_rows[0].get("entity_name") == "验证测试老人_更新"
    )
    print("  ", "✓ PASS" if upsert_ok else "✗ FAIL")

    # ---------- 6. tag-system HTTP API 创建端点探测 ----------
    print("\n── [6] tag-system HTTP API 创建端点探测 (需 token, 预期 401) ──")
    for method, path in ENDPOINTS:
        try:
            r = requests.request(
                method,
                f"{API_URL}{path}",
                json={"entity_type": "ELDER", "entity_id": TEST_ENTITY_ID, "entity_name": "test"},
                headers={"Content-Type": "application/json"},
                timeout=3,
            )
            print(f"  {method} {path} → {r.status_code} {r.text[:100]}")
        except requests.RequestException as e:
            print(f"  {method} {path} → ERR {e}")

    # ---------- 7. 清理测试数据 ----------
    print("\n── [7] 清理测试数据 ──")
    final_cleanup = query("DELETE FROM entity_record WHERE entity_id = $1", [TEST_ENTITY_ID])
    print("  删除:", final_cleanup.get("rowCount"), "✓" if final_cleanup.get("ok") else "✗")

    print("\n" + "═" * 55)
    print("  验证完成")
    print("═" * 55 + "\n")
    return 0


def indent(text: str) -> str:
    return re.sub(r"^", "  ", text, flags=re.MULTILINE)


if __name__ == "__main__":
    sys.exit(main())
