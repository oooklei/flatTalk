#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LongCat 端到端测试：通过 flatTalk 调用链验证 Anthropic 适配器
（test-longcat-e2e.mjs 的 Python 等价实现）

用法：python scripts/test-longcat-e2e.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）

注意：本脚本依赖的模型运行时函数尚未暴露为 HTTP 函数桥端点，
需先在 src/api/debug.js 中新增对应端点后才能实际运行。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402


def main() -> int:
    client = FlatTalkClient()

    # 1. 验证 pickChatModel 选中 LongCat
    model = client._call_fn("pickChatModel", {})
    model_name = client._call_fn("publicModelName", {"model": model})

    print("=== LongCat 端到端测试 ===")
    print(
        "pickChatModel 选中:",
        model_name,
        f"(id={(model or {}).get('id')}, provider={(model or {}).get('provider')})",
    )

    if not model:
        print("ERROR: 未选中模型")
        return 1

    # 2. 测试简单对话
    print("\n--- 测试1: 简单对话 ---")
    r1 = client._call_fn("callOpenAiCompatibleModel", {
        "model": model,
        "messages": [
            {"role": "user", "content": "用一句话介绍广西巴马长寿村"},
        ],
        "options": {"maxTokens": 200, "temperature": 0.6},
    }) or {}

    print("状态:", "OK" if r1.get("ok") else f"FAIL({r1.get('status')})", r1.get("http_status") or "")
    if r1.get("ok"):
        print("回复:", (r1.get("content") or "").replace("\n", " ")[:200])
    else:
        print("错误:", r1.get("error"))

    # 3. 测试 system + user（验证 system 分离逻辑）
    print("\n--- 测试2: system + user ---")
    r2 = client._call_fn("callOpenAiCompatibleModel", {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是一个康养旅居助手，回答简洁。"},
            {"role": "user", "content": "北海适合老人过冬吗？"},
        ],
        "options": {"maxTokens": 200, "temperature": 0.5},
    }) or {}

    print("状态:", "OK" if r2.get("ok") else f"FAIL({r2.get('status')})", r2.get("http_status") or "")
    if r2.get("ok"):
        print("回复:", (r2.get("content") or "").replace("\n", " ")[:200])
    else:
        print("错误:", r2.get("error"))

    print("\n=== 测试完成 ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
