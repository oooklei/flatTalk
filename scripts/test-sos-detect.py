#!/usr/bin/env python3
"""测试 SOS 紧急检测全链路。

Python 版，替代 test-sos-detect.mjs。
通过 /api/debug/fn/detectEmergency 桥端点调用 detectEmergency。
用法: python scripts/test-sos-detect.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

TEST_CASES = [
    {"text": "救命！我摔倒了", "expect": "SOS"},
    {"text": "快打120", "expect": "SOS"},
    {"text": "SOS", "expect": "SOS"},
    {"text": "胸痛，不能呼吸", "expect": "SOS"},
    {"text": "叫救护车", "expect": "SOS"},
    {"text": "急救", "expect": "SOS"},
    {"text": "今天天气不错", "expect": False},
    {"text": "帮我推荐膳食", "expect": False},
]


def main():
    client = FlatTalkClient()
    pass_count = 0
    fail_count = 0

    for tc in TEST_CASES:
        try:
            result = client.detect_emergency(text=tc["text"])
            is_sos = result.get("matched") and result.get("intent_type") == "SOS"
            ok = (tc["expect"] == "SOS") == is_sos
            keyword_match = result.get("keyword_match") or []
            kw_str = f"[{','.join(keyword_match)}]" if keyword_match else ""
            if ok:
                pass_count += 1
                status = "SOS" if is_sos else "正常"
                print(f'✅ "{tc["text"]}" → {status} {kw_str}')
            else:
                fail_count += 1
                actual = "SOS" if is_sos else "正常"
                intent_type = result.get("intent_type") or "none"
                print(f'❌ "{tc["text"]}" → 期望 {tc["expect"]}，实际 {actual} ({intent_type})')
        except FlatTalkError as e:
            fail_count += 1
            print(f'❌ "{tc["text"]}" → ERROR: {e}')

    print(f"\n{pass_count}/{pass_count + fail_count} 通过")
    sys.exit(1 if fail_count > 0 else 0)


if __name__ == "__main__":
    main()
