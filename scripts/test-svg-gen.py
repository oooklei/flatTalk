#!/usr/bin/env python3
"""端到端测试：用真实巴马边界GeoJSON + 真实景点数据，生成完整SVG。

Python 版，替代 test-svg-gen.mjs。
通过 /api/debug/fn/generateSvg 桥端点调用 generateSvg。
用法: python scripts/test-svg-gen.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path("d:/GuiCare/flatTalk")
GEO_DIR = ROOT / "geographicSVG"


def load_real_boundary():
    """加载真实巴马行政区边界（MultiPolygon, 750点）"""
    geojson = json.loads((GEO_DIR / "bama_boundary.geojson").read_text(encoding="utf-8"))
    geom = geojson["features"][0]["geometry"]
    polygons = []
    if geom["type"] == "MultiPolygon":
        for poly in geom["coordinates"]:
            if isinstance(poly, list) and len(poly) > 0:
                ring = poly[0]
                pts = [{"lat": pt[1], "lng": pt[0]} for pt in ring]
                polygons.append(pts)
    return polygons


def load_real_spots():
    """加载真实景点数据"""
    data = json.loads((GEO_DIR / "bama-spots-data.json").read_text(encoding="utf-8"))
    spots = data["spots"]
    waypoints = []
    waypoints.append({
        "name": "巴马县城", "lat": 24.12, "lng": 107.25, "type": "base", "day": "Day1", "plan": "抵达巴马，入住康养基地",
    })
    for name, day, plan in [
        ("百魔洞", "Day2", "溶洞观光"),
        ("长寿村", "Day3", "康养体验"),
        ("水晶宫", "Day4", "溶洞奇观"),
        ("赐福湖", "Day5上午", "湖畔康养"),
    ]:
        spot = next((s for s in spots if s["name"] == name), None)
        if spot:
            wp = {
                "name": spot["name"],
                "lat": spot["coordinates"][0],
                "lng": spot["coordinates"][1],
                "type": "wellness" if name == "长寿村" else "spot",
                "day": day,
                "plan": plan,
                "spot_desc": spot.get("spot_desc"),
                "spot_images": spot.get("spot_images"),
            }
            waypoints.append(wp)
    waypoints.append({
        "name": "巴马县城", "lat": 24.12, "lng": 107.25, "type": "departure", "day": "Day5", "plan": "返程",
    })
    return waypoints


def main():
    boundary = load_real_boundary()
    waypoints = load_real_spots()

    print("真实边界 polygons 数:", len(boundary), "总点数:", sum(len(p) for p in boundary))
    print("景点 waypoints 数:", len(waypoints))
    print("含图片的景点数:", sum(1 for w in waypoints if w.get("spot_images")))

    client = FlatTalkClient()

    # 生成标准版 + 适老版
    try:
        std_result = client.generate_svg(
            waypoints=waypoints,
            route_id="bama_5d4n",
            route_name="巴马5天4晚康养旅居",
            version="standard",
            boundary_polygons=boundary,
        )
        svg_std = std_result.get("svg", "")
    except FlatTalkError as e:
        print(f"标准版生成失败: {e}")
        sys.exit(1)

    try:
        eld_result = client.generate_svg(
            waypoints=waypoints,
            route_id="bama_5d4n",
            route_name="巴马5天4晚康养旅居",
            version="elder",
            boundary_polygons=boundary,
        )
        svg_eld = eld_result.get("svg", "")
    except FlatTalkError as e:
        print(f"适老版生成失败: {e}")
        svg_eld = ""

    # 验证清单
    checks = {
        "viewBox 620x850": 'viewBox="0 0 620 850"' in svg_std,
        "无光栅底图 <image>": "<image" not in svg_std,
        "有行政区边界(district-boundary)": "district-boundary" in svg_std,
        "边界path非矩形(点数多)": len((re.search(r'district-boundary[\s\S]*?<path d="([^"]*)"', svg_std) or ["", ""]).group(1).split(" ")) > 20,
        "有河流装饰(rivers)": 'class="rivers"' in svg_std,
        "有山脉装饰(mountains)": 'class="mountains"' in svg_std,
        "前进段橙色#FF7826": "#FF7826" in svg_std,
        "返程段蓝色#1976D2": "#1976D2" in svg_std,
        "有route-marker交互标点": 'class="route-marker"' in svg_std,
        "有data-spot-img景点图": "data-spot-img" in svg_std,
        "有data-spot-desc景点描述": "data-spot-desc" in svg_std,
        "无Tavily字样": "tavily" not in svg_std.lower(),
        '无"数据来源"字样': "数据来源" not in svg_std,
        "有图例(起点/途经/康养/返程)": "起点" in svg_std and "返程" in svg_std and "康养" in svg_std,
        "有康养特色栏": "康养特色" in svg_std,
        "适老版字体放大": 'font-size="28"' in svg_eld or 'font-size="26"' in svg_eld,
    }

    pass_count = 0
    fail_count = 0
    print("\n=== 验证清单 ===")
    for name, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        if ok:
            pass_count += 1
        else:
            fail_count += 1

    # 保存预览
    out_std = GEO_DIR / "test-bama-real-standard.svg"
    out_eld = GEO_DIR / "test-bama-real-elder.svg"
    out_std.write_text(svg_std, encoding="utf-8")
    out_eld.write_text(svg_eld, encoding="utf-8")

    print(f"\n{pass_count}/{pass_count + fail_count} checks passed.")
    print(f"标准版 SVG: {len(svg_std) / 1024:.1f}KB -> {out_std}")
    print(f"适老版 SVG: {len(svg_eld) / 1024:.1f}KB -> {out_eld}")
    sys.exit(1 if fail_count > 0 else 0)


if __name__ == "__main__":
    main()
