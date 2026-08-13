#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
火山引擎豆包调用测试
- 若设置了 FLATTALK_MODEL_VOLCENGINE_API_KEY，走 Bearer（Ark API Key，支持 Model ID 直调）
- 否则回退 AK/SK V4 签名（仅支持 Endpoint ID，Model ID 直调会 401）
（test-volc-doubao.mjs 的 Python 等价实现）

用法：python scripts/test-volc-doubao.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
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

# 环境变量：原脚本手动解析 .env；Python 侧从进程环境读取，
# 若未设置需手动 export / set 对应变量。
ARK_KEY = os.environ.get("FLATTALK_MODEL_VOLCENGINE_API_KEY", "")
AK = os.environ.get("VOLC_ACCESS_KEY_ID")
SK = os.environ.get("VOLC_SECRET_ACCESS_KEY")
BASE = "https://ark.cn-beijing.volces.com/api/v3"

# 待测模型 Model ID
MODELS = [
    "doubao-1-5-pro-32k-250115",
    "doubao-1-5-lite-32k-250115",
    "doubao-1-pro-256k-240628",
]


def _sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _hmac_sha256(key: bytes, msg: str, as_hex: bool = False):
    mac = hmac.new(key, msg.encode("utf-8"), hashlib.sha256)
    return mac.hexdigest() if as_hex else mac.digest()


def _derive_signing_key(secret_key: str, date_short: str, region: str, service: str) -> bytes:
    """派生签名密钥：SecretKey → Date → Region → Service → 'request'"""
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
    extra_headers: dict | None = None,
) -> dict:
    """等价于 src/core/model-runtime/volcengine-signer.js 的 signVolcengineRequest。"""
    if not access_key_id or not secret_access_key:
        raise RuntimeError("VOLC_AK_SK_MISSING: 缺少火山引擎 AK 或 SK")

    extra_headers = extra_headers or {}
    parsed = urlparse(url)
    host = parsed.netloc
    path = parsed.path or "/"
    query = parsed.query

    # 时间戳格式：yyyyMMddTHHmmssZ
    dt = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    date_short = dt[:8]

    hashed_body = _sha256_hex(body)

    # Canonical headers（必须按字典序）
    headers = {
        "content-type": content_type,
        "host": host,
        "x-content-sha256": hashed_body,
        "x-date": dt,
        **extra_headers,
    }
    sorted_keys = sorted(headers.keys())
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted_keys)
    signed_headers = ";".join(sorted_keys)

    # 规范请求
    canonical_request = "\n".join([
        method.upper(),
        path,
        query,
        canonical_headers,
        signed_headers,
        hashed_body,
    ])

    # 待签名字符串（credentialScope 与 JS 实现保持完全一致）
    credential_scope = f"{date_short}/$AWS_us-west-1/{service}/request"
    string_to_sign = "\n".join([
        "HMAC-SHA256",
        dt,
        credential_scope,
        _sha256_hex(canonical_request),
    ])

    # 计算签名
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
            **extra_headers,
        },
    }


mode = "Bearer (Ark API Key)" if ARK_KEY else "AK/SK V4 签名"
print("=== 火山引擎豆包调用测试 ===")
print("鉴权方式:", mode)
if ARK_KEY:
    print("Ark Key:", ARK_KEY[:8] + "..." + ARK_KEY[-3:])
else:
    print("提示: 未设置 FLATTALK_MODEL_VOLCENGINE_API_KEY，AK/SK 直调 Model ID 预期 401")
print("")


def call_once(model_id: str) -> dict:
    endpoint = f"{BASE}/chat/completions"
    body = json.dumps({
        "model": model_id,
        "messages": [{"role": "user", "content": "用一句话介绍广西巴马"}],
        "max_tokens": 100,
        "temperature": 0.3,
        "stream": False,
    })
    if ARK_KEY:
        headers = {
            "authorization": f"Bearer {ARK_KEY}",
            "content-type": "application/json; charset=utf-8",
        }
    else:
        signed = sign_volcengine_request(
            access_key_id=AK or "",
            secret_access_key=SK or "",
            region="cn-beijing",
            service="ark",
            method="POST",
            url=endpoint,
            body=body,
        )
        headers = signed["headers"]

    t0 = time.time()
    resp = requests.post(endpoint, headers=headers, data=body.encode("utf-8"), timeout=120)
    dt = int((time.time() - t0) * 1000)
    text = resp.text
    try:
        obj = json.loads(text)
    except ValueError:
        obj = {"raw": text[:300]}
    return {"status": resp.status_code, "dt": dt, "obj": obj}


for m in MODELS:
    try:
        r = call_once(m)
        ok = r["status"] == 200
        obj = r["obj"] if isinstance(r["obj"], dict) else {}
        choices = obj.get("choices") or []
        content = (choices[0].get("message") or {}).get("content", "") if choices else ""
        print(f"[{'OK' if ok else r['status']}] {m}  ({r['dt']}ms)")
        if ok and content:
            print("  回复:", str(content)[:120].replace("\n", " "))
        else:
            err_msg = (
                (obj.get("error") or {}).get("message")
                or obj.get("message")
                or json.dumps(r["obj"], ensure_ascii=False)[:200]
            )
            print("  错误:", err_msg)
    except Exception as e:  # noqa: BLE001 — 与原脚本 try/catch 语义一致
        print(f"[ERR] {m}: {e}")
    print("")
