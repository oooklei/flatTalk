#!/usr/bin/env python3
"""实测女娲平台 deepseek 调用：直接 HTTP 请求 nuwax agent chat。

Python 版，替代 test-nuwax-chat.mjs（原版依赖 guixiaoyang-chat-system 的 NuwaxClient）。
用法: python scripts/test-nuwax-chat.py
"""
import json
import sys
import time

import requests

BASE_URL = "http://43.138.143.130:9015"
ACCOUNT = "admin@nuwax.com"
PASSWORD = "123456"
SPACE_ID = 23
ROUTER_AGENT_ID = 373

print("=== 测试女娲 agent chat 调用 ===")
print(f"baseUrl: {BASE_URL} spaceId: {SPACE_ID} routerAgentId: {ROUTER_AGENT_ID}")

session = requests.Session()
session.headers.update({"Content-Type": "application/json"})

# 1) 登录拿 token
try:
    login_resp = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"account": ACCOUNT, "password": PASSWORD},
        timeout=15,
    )
    login_resp.raise_for_status()
    login_data = login_resp.json()
    token = login_data.get("data", {}).get("access_token") or login_data.get("access_token")
    if not token:
        print("登录失败，返回体:", json.dumps(login_data, ensure_ascii=False)[:500])
        sys.exit(1)
    session.headers.update({"Authorization": f"Bearer {token}"})
except requests.RequestException as e:
    print(f"登录异常: {e}")
    sys.exit(1)

# 2) 调 agent chat
payload = {
    "space_id": SPACE_ID,
    "agent_id": ROUTER_AGENT_ID,
    "message": "你好，请用一句话介绍广西巴马的特色景点",
    "stream": False,
}

t0 = time.time()
try:
    resp = session.post(f"{BASE_URL}/api/agent/chat", json=payload, timeout=30)
    elapsed = int((time.time() - t0) * 1000)
    print(f"\nelapsed={elapsed}ms status={resp.status_code}")
    try:
        result = resp.json()
        text = (result.get("data") or {}).get("text") or result.get("text") or ""
        print("reply text (前300字):", text[:300])
        if not text:
            print("data:", json.dumps(result, ensure_ascii=False)[:500])
    except ValueError:
        print("Raw:", resp.text[:500])
except requests.RequestException as e:
    elapsed = int((time.time() - t0) * 1000)
    print(f"异常 elapsed={elapsed}ms: {e}")
    sys.exit(1)
