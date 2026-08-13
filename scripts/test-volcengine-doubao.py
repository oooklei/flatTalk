#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试火山引擎豆包模型调用（V4 签名）
（test-volcengine-doubao.mjs 的 Python 等价实现）

用法：python scripts/test-volcengine-doubao.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402,F401 (统一 UTF-8 输出)

# 与 src/core/model-runtime/volcengine-signer.js 等价的 V4 签名实现
# （不复用 test-volc-doubao.py，避免导入时触发该脚本的模块级外部 API 调用）。


def _sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _hmac_sha256(key: bytes, msg: str, as_hex: bool = False):
    mac = hmac.new(key, msg.encode("utf-8"), hashlib.sha256)
    return mac.hexdigest() if as_hex else mac.digest()


def _derive_signing_key(secret_key: str, date_short: str, region: str, service: str) -> bytes:
    k_date = _hmac_sha256(secret_key.encode("utf-8"), date_short)
    k_region = _hmac_sha256(k_date, region)
    k_service = _hmac_sha256(k_region, service)
    return _hmac_sha256(k_service, "request")


def sign_volcengine_request(
    access_key_id: str,
    secret_access_key: str,
    url: str,
    body: str = "",
    region: str = "cn-beijing",
    service: str = "ark",
    method: str = "POST",
    content_type: str = "application/json; charset=utf-8",
) -> dict:
    if not access_key_id or not secret_access_key:
        raise RuntimeError("VOLC_AK_SK_MISSING: 缺少火山引擎 AK 或 SK")

    parsed = urlparse(url)
    host = parsed.netloc
    path = parsed.path or "/"
    query = parsed.query

    dt = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    date_short = dt[:8]
    hashed_body = _sha256_hex(body)

    headers = {
        "content-type": content_type,
        "host": host,
        "x-content-sha256": hashed_body,
        "x-date": dt,
    }
    sorted_keys = sorted(headers.keys())
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted_keys)
    signed_headers = ";".join(sorted_keys)

    canonical_request = "\n".join([
        method.upper(), path, query, canonical_headers, signed_headers, hashed_body,
    ])
    credential_scope = f"{date_short}/$AWS_us-west-1/{service}/request"
    string_to_sign = "\n".join([
        "HMAC-SHA256", dt, credential_scope, _sha256_hex(canonical_request),
    ])
    signing_key = _derive_signing_key(secret_access_key, date_short, region, service)
    signature = _hmac_sha256(signing_key, string_to_sign, as_hex=True)
    authorization = (
        f"HMAC-SHA256 Credential={access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "datetime": dt,
        "headers": {
            "Content-Type": content_type,
            "Host": host,
            "X-Date": dt,
            "X-Content-Sha256": hashed_body,
            "Authorization": authorization,
        },
    }


def read_model_registry(registry_path: Path | None = None) -> list[dict]:
    """等价于 readModelRegistry（src/core/model-runtime/model-registry.js:6）。
    该函数只读取本地 data/model-registry.json，Python 侧直接读文件即可。"""
    file_path = registry_path or (Path.cwd() / "data" / "model-registry.json")
    try:
        raw = json.loads(Path(file_path).read_text(encoding="utf-8"))
        models = raw.get("models")
        return models if isinstance(models, list) else []
    except (OSError, ValueError):
        return []


def resolve_model_api_key(model: dict) -> str:
    """等价于 resolveModelApiKey（src/core/model-runtime/model-registry.js:27）。"""
    if model.get("api_key") and str(model["api_key"]).strip():
        return str(model["api_key"])
    provider = re.sub(r"[^A-Z0-9]", "_", str(model.get("provider") or "").upper())
    if provider and os.environ.get(f"FLATTALK_MODEL_{provider}_API_KEY"):
        return os.environ[f"FLATTALK_MODEL_{provider}_API_KEY"]
    return ""


def is_volcengine_ak_sk_mode(model: dict) -> bool:
    """等价于 isVolcengineAkSkMode（src/core/model-runtime/volcengine-signer.js:119）。"""
    if str(model.get("provider") or "").lower() != "volcengine":
        return False
    if str(model.get("auth_mode") or "").lower() != "volcengine_ak_sk":
        return False
    return bool(os.environ.get("VOLC_ACCESS_KEY_ID") and os.environ.get("VOLC_SECRET_ACCESS_KEY"))


# 采用 Python 直调实现（OpenAI 兼容 /chat/completions），逻辑与 JS 版本保持一致。
# 说明：桥端点 callOpenAiCompatibleModel 亦可用，但本脚本需要验证签名与鉴权细节，
# 直调可避免服务端持有的环境变量掩盖 API Key 缺失问题。
def call_openai_compatible_model(model: dict, messages: list, options: dict | None = None) -> dict:
    options = options or {}
    api_key = resolve_model_api_key(model)
    missing = []
    if not model.get("api_base"):
        missing.append("api_base")
    if not model.get("model_id"):
        missing.append("model_id")
    use_volc_sign = is_volcengine_ak_sk_mode(model)
    if not use_volc_sign and not api_key:
        missing.append("api_key")
    if missing:
        return {"ok": False, "status": "config_error", "error": f"模型配置不完整：{'、'.join(missing)}"}

    timeout_ms = int(options.get("timeoutMs") or os.environ.get("FLATTALK_MODEL_TIMEOUT_MS") or 45000)
    endpoint = f"{str(model['api_base']).rstrip('/')}/chat/completions"
    body = json.dumps({
        "model": model["model_id"],
        "messages": messages,
        "max_tokens": int(options.get("maxTokens") or model.get("max_tokens") or 4000),
        "temperature": float(
            options["temperature"] if options.get("temperature") is not None
            else (model.get("temperature") if model.get("temperature") is not None else 0.3)
        ),
        "stream": False,
    })

    if use_volc_sign:
        signed = sign_volcengine_request(
            access_key_id=os.environ.get("VOLC_ACCESS_KEY_ID", ""),
            secret_access_key=os.environ.get("VOLC_SECRET_ACCESS_KEY", ""),
            region="cn-beijing",
            service="ark",
            method="POST",
            url=endpoint,
            body=body,
        )
        headers = signed["headers"]
    else:
        headers = {
            "authorization": f"Bearer {api_key}",
            "content-type": "application/json; charset=utf-8",
        }

    try:
        response = requests.post(
            endpoint, headers=headers, data=body.encode("utf-8"), timeout=timeout_ms / 1000
        )
    except requests.Timeout:
        return {"ok": False, "status": "timeout", "error": f"模型调用超时({timeout_ms}ms)"}
    except requests.RequestException as e:
        return {"ok": False, "status": "request_error", "error": str(e)}

    body_text = response.text
    try:
        body_obj = json.loads(body_text) if body_text else {}
    except ValueError:
        body_obj = {"raw": body_text}
    if not response.ok:
        error = (
            (body_obj.get("error") or {}).get("message")
            or body_obj.get("message")
            or response.reason
        )
        return {"ok": False, "status": "http_error", "http_status": response.status_code,
                "error": error, "raw": body_obj}
    choices = body_obj.get("choices") or []
    first = choices[0] if choices else {}
    content = (first.get("message") or {}).get("content") or (first.get("delta") or {}).get("content") or ""
    if not str(content).strip():
        return {"ok": False, "status": "empty_reply", "error": "模型返回为空", "raw": body_obj}
    return {"ok": True, "status": "success", "content": content, "raw": body_obj}


models = read_model_registry()
volc_models = [m for m in models if m.get("provider") == "volcengine" and m.get("is_active")]

print("=== 火山引擎豆包模型测试 ===")
ak = os.environ.get("VOLC_ACCESS_KEY_ID")
print("VOLC_ACCESS_KEY_ID:", f"{ak[:10]}..." if ak else "MISSING")
print("VOLC_SECRET_ACCESS_KEY:", "SET" if os.environ.get("VOLC_SECRET_ACCESS_KEY") else "MISSING")
print("已配置豆包模型:", ", ".join(f"{m.get('name')}({m.get('model_id')})" for m in volc_models))
print("")

prompt = "你是旅居产品数据分析助手。请用一句话介绍广西巴马的特色景点。"
print("测试 prompt:", prompt)
print("")

for model in volc_models:
    print(f"\n========== {model.get('display_name')} ==========")
    print(f"model_id: {model.get('model_id')}")
    print(f"api_base: {model.get('api_base')}")
    t0 = time.time()
    try:
        result = call_openai_compatible_model(
            model,
            [{"role": "user", "content": prompt}],
            {"maxTokens": 200, "timeoutMs": 20000},
        )
        elapsed = int((time.time() - t0) * 1000)
        if result.get("ok"):
            print(f"✅ 成功 ({elapsed}ms)")
            print("回复:", (result.get("content") or "")[:300])
            print("tokens:", (result.get("raw") or {}).get("usage"))
        else:
            print(f"❌ 失败 [{result.get('status')}] HTTP={result.get('http_status') or '-'}")
            print("错误:", result.get("error"))
            raw_error = (result.get("raw") or {}).get("error")
            if raw_error:
                print("详情:", json.dumps(raw_error, ensure_ascii=False)[:400])
    except Exception as e:  # noqa: BLE001 — 与原脚本 try/catch 语义一致
        print(f"💥 异常: {e}")
