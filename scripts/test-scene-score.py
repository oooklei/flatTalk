#!/usr/bin/env python3
"""测试场景识别打分。

Python 版，替代 test-scene-score.mjs。
通过 /api/debug/fn/identifyScene 桥端点调用 identifyScene。
用法: python scripts/test-scene-score.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

TESTS = [
    "旅居规划",
    "帮我规划旅居路线",
    "推荐适合老人的早餐",
    "查看派单列表",
    "老人有什么补贴",
    "推荐养老服务",
    "老人健康风险预警",
]


def main():
    client = FlatTalkClient()
    for text in TESTS:
        try:
            r = client.identify_scene(text=text)
            candidates = r.get("candidates") or []
            top3 = [
                {
                    "scene": c.get("scene_key"),
                    "conf": f"{c.get('confidence', 0):.2f}",
                    "score": f"{c.get('score', 0):.1f}",
                    "dec": c.get("decision"),
                }
                for c in candidates[:3]
            ]
            routed = r.get("routed")
            scene = r.get("scene_key")
            intent = r.get("intent")
            conf = r.get("confidence", 0)
            print(f"[{text}] → routed={routed} scene={scene} intent={intent} conf={conf:.2f} top3={json.dumps(top3, ensure_ascii=False)}")
        except FlatTalkError as e:
            print(f"[{text}] → ERROR: {e}")


if __name__ == "__main__":
    main()
