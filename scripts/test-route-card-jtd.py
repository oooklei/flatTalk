#!/usr/bin/env python3
"""route_card 金跳动产品组合展示测试。

Python 版，替代 test-route-card-jtd.mjs。
用法: python scripts/test-route-card-jtd.py
"""
import json
from pathlib import Path

from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path(__file__).resolve().parent.parent

# 金跳动 mock 产品数据（与 jtd-service.js MOCK_PRODUCTS 一致）
BAMA_PRODUCT = {
    "product_id": "jtd_mock_bama_001",
    "sku_id": "sku_bama_3d",
    "product_name": "广西巴马康养旅居三日体验",
    "destination": "广西巴马",
    "city": "巴马",
    "price_amount": 1680,
    "price_label": "约1680元/人",
    "stock": 6,
    "inventory_status": "available",
    "tags": ["慢病友好", "低强度", "医疗可达"],
    "handoff_urls": {"h5_product_url": "https://lvjutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001"},
    "vendor_trace_id": "mock_vendor_bama_001",
}

BEIHAI_PRODUCT = {
    "product_id": "jtd_mock_beihai_001",
    "sku_id": "sku_beihai_4d",
    "product_name": "广西北海暖冬海滨旅居四日",
    "destination": "广西北海",
    "city": "北海",
    "price_amount": 1380,
    "price_label": "约1380元/人",
    "stock": 3,
    "inventory_status": "available",
    "tags": ["海滨慢行", "家属陪同", "交通便利"],
    "handoff_urls": {"h5_product_url": "https://lvjutest.jtdcn.cn/mock/sojourn/product/jtd_mock_beihai_001"},
    "vendor_trace_id": "mock_vendor_beihai_001",
}


def test_scenario(client, name, message, product):
    business_data = {}
    if product:
        business_data = {
            "jtd": {
                "products": [product],
                "selected_product": product,
                "source_status": "mock_vendor_data",
                "ok": True,
            }
        }

    result = client.fill_template_slots(
        template_id="route_card",
        message=message,
        business_data=business_data,
    )

    print(f"\n=== {name} ===")
    print(f"template_id: {result.get('template_id')}")
    data = result.get("data") or {}
    print(f"destination: {data.get('destination')}")
    print(f"routeTitle: {data.get('routeTitle')}")
    print(f"priceLabel: {data.get('priceLabel')}")
    print(f"productId: {data.get('productId')}")
    print(f"days: {data.get('days')}")
    map_key = data.get("map_key")
    print(f"map_key: {'YES (' + str(map_key)[:12] + '...)' if map_key else 'NO'}")
    print(f"centerLat: {data.get('centerLat')}")
    print(f"centerLng: {data.get('centerLng')}")
    print(f"centerName: {data.get('centerName')}")
    static_map_url = data.get("static_map_url")
    print(f"static_map_url: {'YES (' + str(static_map_url)[:50] + '...)' if static_map_url else 'NO'}")
    print(f"markers count: {len(data.get('map_markers') or [])}")
    print(f"answer_text: {result.get('answer_text')}")
    return result


def render_html(template_path, data):
    html = template_path.read_text(encoding="utf-8")
    # 替换三重花括号（不转义）
    for key, value in (data or {}).items():
        if value is None:
            str_val = ""
        elif isinstance(value, (dict, list)):
            str_val = json.dumps(value, ensure_ascii=False)
        else:
            str_val = str(value)
        html = html.replace(f"{{{{{key}}}}}", str_val)
    # 替换双花括号（转义 HTML）
    for key, value in (data or {}).items():
        if value is None:
            str_val = ""
        elif isinstance(value, (dict, list)):
            str_val = json.dumps(value, ensure_ascii=False)
        else:
            str_val = str(value)
        escaped = str_val.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
        html = html.replace(f"{{{{{key}}}}}", escaped)
    return html


def generate_summary_page(results, template_path):
    cards = []
    for r in results:
        html = render_html(template_path, r["result"].get("data") or {})
        cards.append(
            f'<section style="margin-bottom:30px"><h2 style="color:#FF7826">{r["label"]}</h2>'
            f'<div style="border:1px solid #ddd;border-radius:8px;overflow:hidden">{html}</div></section>'
        )
    cards_html = "\n".join(cards)

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>route_card 金跳动产品组合展示测试</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
h1 {{ color: #FF7826; }}
</style>
</head>
<body>
<h1>route_card 模板 × 金跳动产品 组合展示测试</h1>
<p>测试场景：巴马产品、北海产品、无产品降级。验证地图数据注入和产品信息填充。</p>
{cards_html}
</body>
</html>"""


def main():
    client = FlatTalkClient()

    scenarios = [
        {"name": "bama", "label": "巴马产品", "message": "帮我规划巴马旅居路线", "product": BAMA_PRODUCT},
        {"name": "beihai", "label": "北海产品", "message": "帮我规划北海旅居路线", "product": BEIHAI_PRODUCT},
        {"name": "fallback", "label": "无产品降级", "message": "帮我规划旅居路线", "product": None},
    ]

    template_path = ROOT / "src" / "skills" / "travel_route" / "templates" / "html" / "route_card.html"
    output_dir = ROOT / "scripts" / "test-output"
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for scenario in scenarios:
        try:
            result = test_scenario(client, scenario["label"], scenario["message"], scenario["product"])
        except FlatTalkError as e:
            print(f"渲染 {scenario['name']} 失败: {e}")
            continue
        r = {**scenario, "result": result}
        results.append(r)

        # 渲染 HTML
        try:
            html = render_html(template_path, result.get("data") or {})
            out_file = output_dir / f"route-card-{scenario['name']}.html"
            out_file.write_text(html, encoding="utf-8")
            print(f"HTML 已保存: {out_file}")
        except Exception as e:
            print(f"渲染 {scenario['name']} 失败: {e}")

    # 生成汇总页面
    if results:
        summary_html = generate_summary_page(results, template_path)
        summary_file = output_dir / "route-card-summary.html"
        summary_file.write_text(summary_html, encoding="utf-8")
        print(f"\n汇总页面: {summary_file}")


if __name__ == "__main__":
    main()
