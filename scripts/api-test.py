#!/usr/bin/env python3
"""测试广西一码通 /stage-api 接口的签名与调用。

Python 版，替代 api-test.js。
用法: python scripts/api-test.py
"""
import hashlib
import hmac
import json
import sys
import uuid
from time import time

import requests

APP_KEY = "rnOU1BN1qEnK4rlh"
APP_SECRET = "uZBFfcdg8cKcv73uCfYtf9uM"
TIMESTAMP = str(int(time() * 1000))
NONCE = uuid.uuid4().hex

# 签名方式: HMAC-SHA256(appSecret, appKey + timestamp + nonce + body + appSecret)
BODY = "{}"
SIGN_CONTENT = APP_KEY + TIMESTAMP + NONCE + BODY + APP_SECRET
SIGN = hmac.new(APP_SECRET.encode("utf-8"), SIGN_CONTENT.encode("utf-8"), hashlib.sha256).hexdigest()

PATH = "/stage-api/sd/yz365/checkDetail"

headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json",
    "appKey": APP_KEY,
    "timestamp": TIMESTAMP,
    "nonce": NONCE,
    "sign": SIGN,
}

try:
    resp = requests.post(
        f"http://171.111.198.212:9013{PATH}",
        data=BODY,
        headers=headers,
        timeout=30,
    )
    print(resp.text)
except requests.RequestException as e:
    print("Error:", e)
    sys.exit(1)
