#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
端到端测试：完整调用链 buildRouteProductContext → LLM 补字段 → fillTemplateSlots → sojourn_route 渲染
（test-e2e-route.mjs 的 Python 等价实现）

用法：python scripts/test-e2e-route.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402


def _to_str(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def render_html(template_path: Path, data: dict | None) -> str:
    html = template_path.read_text(encoding="utf-8")
    # 三重花括号：不转义
    for key, value in (data or {}).items():
        html = html.replace(f"{{{{{{{key}}}}}}}", _to_str(value))
    # 双花括号：HTML 转义
    for key, value in (data or {}).items():
        escaped = (
            _to_str(value)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        html = html.replace(f"{{{{{key}}}}}", escaped)
    return html


def main() -> None:
    client = FlatTalkClient()

    scenarios = [
        {"name": "0730测试产品_LLM补字段", "message": "帮我规划0730测试旅居路线5天4日游"},
        {"name": "七洞乡产品_真实地名", "message": "帮我规划七洞乡线路产品旅居路线"},
        {"name": "自在港湾基地_LLM补字段", "message": "帮我预订自在港湾旅居基地"},
        {"name": "默认推荐_降级", "message": "帮我规划旅居路线"},
    ]

    output_dir = _ROOT / "scripts" / "test-output"
    output_dir.mkdir(parents=True, exist_ok=True)
    tpl_dir = _ROOT / "src" / "skills" / "travel_route" / "templates" / "html"
    route_tpl = tpl_dir / "sojourn_route.html"
    base_tpl = tpl_dir / "sojourn_base.html"
    results = []

    for sc in scenarios:
        print(f"\n========== {sc['name']} ==========")
        print("message:", sc["message"])
        try:
            # 1. 调用 jtd service 获取产品（含 LLM 补字段）
            t0 = time.time()
            ctx = client.jtd_build_route_product_context(request={"message": sc["message"]}) or {}
            elapsed = int((time.time() - t0) * 1000)
            selected = ctx.get("selected_product") or {}
            print(
                f"[jtd] elapsed={elapsed}ms data_source={ctx.get('data_source')} "
                f'selected.destination="{selected.get("destination")}"'
            )

            # 2. 用 business_data 注入模板
            result = client.fill_template_slots(
                template_id="sojourn_route",
                message=sc["message"],
                business_data={
                    "jtd": {
                        "products": ctx.get("products"),
                        "selected_product": ctx.get("selected_product"),
                        "source_status": ctx.get("source_status"),
                        "ok": True,
                        "product_domain": ctx.get("product_domain"),
                    },
                },
            ) or {}

            tid = result.get("template_id") or "sojourn_route"
            tpl = base_tpl if tid == "sojourn_base" else route_tpl
            data = result.get("data") or {}
            print(
                f"[render] template_id={tid} destination={data.get('destination')} "
                f"waypoints={len(data.get('waypoints') or [])} "
                f"polyline={len(data.get('polyline_path') or [])}"
            )

            html = render_html(tpl, data)
            out_file = output_dir / f"e2e-{sc['name']}.html"
            out_file.write_text(html, encoding="utf-8")
            print(f"[output] {out_file}")
            results.append({"sc": sc, "tid": tid, "result": result})
        except Exception as e:
            print(f"[error] {sc['name']}:", e, file=sys.stderr)

    # 汇总页面
    cards_list = []
    for item in results:
        sc = item["sc"]
        tid = item["tid"]
        tpl = base_tpl if tid == "sojourn_base" else route_tpl
        html = render_html(tpl, item["result"].get("data") or {})
        cards_list.append(
            f'<section style="margin-bottom:30px"><h2 style="color:#FF7826">{sc["name"]} '
            f'<span style="font-size:12px;color:#666;font-weight:normal">[{tid}]</span></h2>'
            f'<div style="border:1px solid #ddd;border-radius:8px;overflow:hidden">{html}</div></section>'
        )
    cards = "\n".join(cards_list)

    summary_html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>端到端测试：金跳动真实接口 × LLM补字段 × sojourn_route 走线</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
h1 {{ color: #FF7826; }}
.summary {{ background: #fff; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; line-height: 1.7; }}
.summary b {{ color: #FF7826; }}
</style>
</head>
<body>
<h1>端到端测试：金跳动真实接口 × LLM 补字段 × sojourn_route 走线</h1>
<div class="summary">
<b>数据源链路：</b> 实时金跳动接口 → 本地知识库 → mock<br/>
<b>模板分流：</b> sojourn_route（走线） / sojourn_base（点位）<br/>
<b>地图能力：</b> TMap.Polyline 走线 + MultiMarker 途经点 + SVG 静态降级<br/>
<b>LLM 补字段：</b> destination 为空时用 GLM-4-Flash 推理（产品名→广西地名）<br/>
<b>测试场景：</b> {len(results)} 个
</div>
{cards}
</body>
</html>"""
    summary_file = output_dir / "e2e-summary.html"
    summary_file.write_text(summary_html, encoding="utf-8")
    print(f"\n汇总页面: {summary_file}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
