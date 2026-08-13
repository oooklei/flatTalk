#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
真实金跳动接口数据 × route_card 模板组合展示测试
（test-route-card-real.mjs 的 Python 等价实现）

用法：python scripts/test-route-card-real.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）

注意：原脚本用 jtd-service 的 normalizeSearchRecords 归一化搜索结果，
该函数尚未暴露为函数桥端点，需先新增端点后本脚本才能完整运行。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

TENANT_ID = os.environ.get("JTD_TENANT_ID") or "042788"

TEMPLATE_FILE_MAP = {
    "sojourn_route": "sojourn_route.html",
    "sojourn_base": "sojourn_base.html",
    "route_card": "route_card.html",
    "travel_base_card": "travel_base_card.html",
}


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


def fetch_all_real_products(client: FlatTalkClient) -> tuple[list[dict], list[dict]]:
    print("=== 拉取金跳动真实接口全部产品 ===")
    # 同时拉 sojourn_route 和 sojourn_base
    route_res = client.jtd_search_products(query={
        "tenantId": TENANT_ID,
        "productDomain": "sojourn_route",
        "product_type": "旅居线路",
        "pageNum": 1,
        "pageSize": 50,
    })
    base_res = client.jtd_search_products(query={
        "tenantId": TENANT_ID,
        "productDomain": "sojourn_base",
        "product_type": "旅居基地",
        "pageNum": 1,
        "pageSize": 50,
    })

    def extract(res, domain: str) -> list[dict]:
        # 用 jtd-service 的 normalizeSearchRecords 归一化，确保字段名一致（product_id/price_label/destination 等）
        records = client._call_fn("normalizeSearchRecords", {"apiResult": res}) or []
        # 补充 productDomain（归一化函数不保留此字段）
        return [{**r, "product_domain": domain} for r in records]

    routes = extract(route_res, "sojourn_route")
    bases = extract(base_res, "sojourn_base")
    print(f"线路产品: {len(routes)} 个，基地产品: {len(bases)} 个")
    # 打印归一化后的字段，验证 destination 兜底是否生效
    for i, p in enumerate([*routes, *bases]):
        print(
            f"  [{i + 1}] id={p.get('product_id')} | name={p.get('product_name')} | "
            f"dest={p.get('destination')} | price={p.get('price_amount')} | domain={p.get('product_domain')}"
        )
    return routes, bases


def render_scenario(client: FlatTalkClient, output_dir: Path, scenario: dict) -> dict:
    name = scenario["name"]
    label = scenario["label"]
    message = scenario["message"]
    product = scenario["product"]
    product_domain = scenario["productDomain"]

    business_data = {
        "jtd": {
            "products": [product],
            "selected_product": product,
            "source_status": "real_data",
            "ok": True,
            "product_domain": product_domain,
        },
    } if product else {}

    result = client.fill_template_slots(
        template_id="route_card",
        message=message,
        business_data=business_data,
    ) or {}

    # 根据返回的 template_id 动态选择模板文件
    tid = result.get("template_id") or "route_card"
    template_file = TEMPLATE_FILE_MAP.get(tid) or "sojourn_route.html"
    actual_template_path = _ROOT / "src" / "skills" / "travel_route" / "templates" / "html" / template_file

    data = result.get("data") or {}
    print(f"\n=== {label} ===")
    print("  template_id:", tid)
    print("  destination:", data.get("destination"))
    print("  routeTitle:", data.get("routeTitle"))
    print("  title:", data.get("title"))
    print("  priceLabel:", data.get("priceLabel"))
    print("  productId:", data.get("productId"))
    print("  days:", data.get("days"))
    bases = data.get("bases")
    print("  bases count:", len(bases) if isinstance(bases, list) else "-")
    print("  map_key:", "YES" if data.get("map_key") else "NO")
    print("  centerLat/Lng:", data.get("centerLat"), "/", data.get("centerLng"))
    print("  centerName:", data.get("centerName"))
    print("  static_map_url:", "YES" if data.get("static_map_url") else "NO")

    try:
        html = render_html(actual_template_path, data)
        out_file = output_dir / f"route-card-real-{name}.html"
        out_file.write_text(html, encoding="utf-8")
        print("  HTML:", out_file)
    except Exception as e:
        print("  渲染失败:", e, file=sys.stderr)
    return result


def main() -> None:
    client = FlatTalkClient()

    configured = client.jtd_is_configured() or {}
    if not configured.get("configured"):
        print("[FATAL] JTD client not configured", file=sys.stderr)
        sys.exit(1)

    routes, bases = fetch_all_real_products(client)
    all_products = [*routes, *bases]

    output_dir = _ROOT / "scripts" / "test-output"
    output_dir.mkdir(parents=True, exist_ok=True)

    scenarios = []
    # 每个真实产品一个场景
    for p in all_products:
        pid = str(p.get("product_id") or p.get("productId") or p.get("id") or "")
        pname = p.get("product_name") or p.get("productName") or p.get("name") or ""
        domain = p.get("product_domain") or p.get("productDomain") or "sojourn_route"
        scenarios.append({
            "name": f"{domain}_{pid}",
            "label": f"[{'基地' if domain == 'sojourn_base' else '线路'}] {pname}",
            "message": f"帮我规划{pname}旅居路线",
            "product": p,
            "productDomain": domain,
        })
    # 降级场景
    scenarios.append({
        "name": "fallback_no_product",
        "label": "[降级] 无产品",
        "message": "帮我规划旅居路线",
        "product": None,
        "productDomain": "sojourn_route",
    })

    results = []
    for sc in scenarios:
        r = render_scenario(client, output_dir, sc)
        results.append({**sc, "result": r})

    # 汇总页面
    tpl_dir = _ROOT / "src" / "skills" / "travel_route" / "templates" / "html"
    route_template = tpl_dir / "sojourn_route.html"
    base_template = tpl_dir / "sojourn_base.html"
    cards_list = []
    for item in results:
        result = item["result"]
        tid = result.get("template_id") or "sojourn_route"
        tpl = base_template if tid == "sojourn_base" else route_template
        html = render_html(tpl, result.get("data") or {})
        cards_list.append(
            f'<section style="margin-bottom:30px"><h2 style="color:#FF7826">{item["label"]} '
            f'<span style="font-size:12px;color:#666;font-weight:normal">[{tid}]</span></h2>'
            f'<div style="border:1px solid #ddd;border-radius:8px;overflow:hidden">{html}</div></section>'
        )
    cards = "\n".join(cards_list)

    summary_html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>route_card × 金跳动真实产品 组合展示测试</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
h1 {{ color: #FF7826; }}
.summary {{ background: #fff; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; line-height: 1.6; }}
</style>
</head>
<body>
<h1>route_card × 金跳动真实接口产品 组合展示</h1>
<div class="summary">
数据源：金跳动测试环境 {os.environ.get('JTD_BASE_URL') or ''}<br/>
租户：{TENANT_ID}<br/>
线路产品：{len(routes)} 个 / 基地产品：{len(bases)} 个 / 共 {len(all_products)} 个真实产品 + 1 降级场景
</div>
{cards}
</body>
</html>"""
    summary_file = output_dir / "route-card-real-summary.html"
    summary_file.write_text(summary_html, encoding="utf-8")
    print(f"\n汇总页面: {summary_file}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
