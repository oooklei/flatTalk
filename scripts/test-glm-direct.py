#!/usr/bin/env python3
"""直接测试 GLM 接口响应，定位 LLM 返回为空的根因。

Python 版，替代 test-glm-direct.mjs。
用法: python scripts/test-glm-direct.py
"""
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
REG_PATH = ROOT / "data" / "model-registry.json"

reg = json.loads(REG_PATH.read_text(encoding="utf-8"))
model = next(
    (m for m in reg["models"] if m.get("is_active") and m.get("model_type") == "llm_text" and m.get("is_default")),
    next(m for m in reg["models"] if m.get("model_id") == "glm-4-flash"),
)
print("使用模型:", model["model_id"], "api_base:", model["api_base"])

api_key = model["api_key"]
url = f"{model['api_base'].rstrip('/')}/chat/completions"

prompt = '只回复JSON：{"destination":"广西北海"}'
print("prompt:", prompt)
print("url:", url)

payload = {
    "model": model["model_id"],
    "messages": [{"role": "user", "content": prompt}],
    "max_tokens": 100,
    "temperature": 0.3,
    "stream": False,
}

t0 = time.time()
try:
    resp = requests.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=30,
    )
    elapsed = int((time.time() - t0) * 1000)
    print(f"HTTP={resp.status_code} elapsed={elapsed}ms")
    text = resp.text
    print("原始响应(前1000字符):", text[:1000])

    if resp.ok:
        try:
            data = resp.json()
            print("\n解析后结构:")
            choices = data.get("choices") or []
            print("  choices:", len(choices), "个")
            if choices:
                msg = choices[0].get("message") or {}
                print("  content:", json.dumps(msg.get("content"), ensure_ascii=False))
                print("  finish_reason:", choices[0].get("finish_reason"))
            print("  usage:", data.get("usage"))
        except ValueError as e:
            print("JSON 解析失败:", e)
except requests.RequestException as e:
    print("requests 异常:", e.__class__.__name__, e)
    sys.exit(1)
