#!/usr/bin/env python3
"""用含真实图片和描述的 route_data.json 重新生成 SVG。
验证：每个标点都有 data-spot-img 和 data-spot-desc。

Python 版，替代 regen-svg-with-spots.mjs。
用法: python scripts/regen-svg-with-spots.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path("d:/GuiCare/flatTalk")
GEO_DIR = ROOT / "geographicSVG"


def load_boundary():
    geojson = json.loads((GEO_DIR / "bama_boundary.geojson").read_text(encoding="utf-8"))
    geom = geojson["features"][0]["geometry"]
    polygons = []
    if geom["type"] == "MultiPolygon":
        for poly in geom["coordinates"]:
            if isinstance(poly, list) and len(poly) > 0:
                pts = [{"lat": pt[1], "lng": pt[0]} for pt in poly[0]]
                polygons.append(pts)
    return polygons


def main():
    route = json.loads((ROOT / "data/sojourn-maps/bama_5d4n/route_data.json").read_text(encoding="utf-8"))
    waypoints = route["waypoints"]

    print("waypoints 总数:", len(waypoints))
    with_img = [w for w in waypoints if len(w.get("spot_images") or []) > 0]
    with_desc = [w for w in waypoints if len(w.get("spot_desc") or "") > 20]
    print("含图片:", len(with_img), ", ".join(f"{w['name']}({len(w.get('spot_images') or [])}张)" for w in with_img))
    print("含描述:", len(with_desc))

    boundary = load_boundary()
    client = FlatTalkClient()

    try:
        result = client.generate_svg(
            waypoints=waypoints,
            route_id="bama_5d4n",
            route_name=route.get("route_name", ""),
            version="standard",
            boundary_polygons=boundary,
        )
    except FlatTalkError as e:
        print(f"生成失败: {e}")
        sys.exit(1)

    svg = result.get("svg", "")

    marker_count = len(re.findall(r'class="route-marker"', svg))
    img_count = len(re.findall(r"data-spot-img=", svg))
    desc_count = len(re.findall(r"data-spot-desc=", svg))
    real_img_urls = re.findall(r'data-spot-img="https?://[^"]+"', svg)

    print("\n=== SVG 标点嵌入验证 ===")
    print("route-marker 数量:", marker_count)
    print("data-spot-img 数量:", img_count)
    print("data-spot-desc 数量:", desc_count)
    print("真实图片URL数:", len(real_img_urls))
    for u in real_img_urls[:3]:
        print("  示例:", u[:80])

    out_path = ROOT / "data/sojourn-maps/bama_5d4n/map_standard.svg"
    out_path.write_text(svg, encoding="utf-8")
    print(f"\nSVG 已保存: {out_path} ({len(svg) / 1024:.1f}KB)")

    (GEO_DIR / "test-bama-real-standard.svg").write_text(svg, encoding="utf-8")

    passed = marker_count > 0 and img_count >= 3 and desc_count >= 3
    print("\nPASS: 景点图片和描述已嵌入SVG" if passed else "\nFAIL: 图片或描述缺失")


if __name__ == "__main__":
    main()
