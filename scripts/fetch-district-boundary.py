#!/usr/bin/env python3
"""使用腾讯地图 API 获取行政区划边界，生成带真实轮廓的 SVG 地图。

Python 版，替代 fetch-district-boundary.mjs。
通过 /api/debug/fn/fetchDistrictBoundary 桥端点获取边界数据。
用法: python scripts/fetch-district-boundary.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

BAMA_CENTER = {"lat": 24.15, "lng": 107.25}
FCG_CENTER = {"lat": 21.62, "lng": 108.35}


def coords_to_svg(points, center, width, height, scale=0.008):
    half_w = width / 2
    half_h = height / 2
    return [
        {"x": half_w + (p["lng"] - center["lng"]) / scale, "y": half_h - (p["lat"] - center["lat"]) / scale}
        for p in points
    ]


def points_to_path(points):
    if not points:
        return ""
    parts = [f"{'M' if i == 0 else 'L'}{p['x']:.1f},{p['y']:.1f}" for i, p in enumerate(points)]
    return " ".join(parts) + " Z"


def fetch_boundary_and_generate_svg(client, keyword, center, output_file, width=620, height=520):
    print(f"正在获取【{keyword}】行政区划边界...")
    try:
        boundary = client.fetch_district_boundary(destination=keyword)
    except FlatTalkError as e:
        print(f"获取边界失败: {e}")
        return None

    if not boundary.get("ok"):
        print("获取边界失败:", boundary.get("message"))
        return None

    name = boundary.get("name", keyword)
    polygons = boundary.get("polygons") or []
    print(f"成功获取【{name}】边界，adcode: {boundary.get('adcode')}，polygon 数量: {len(polygons)}")

    boundary_file = output_file.replace(".svg", "-boundary.json")
    Path(boundary_file).write_text(json.dumps(boundary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("边界数据已保存到:", boundary_file)

    svg_paths = [points_to_path(coords_to_svg(poly, center, width, height)) for poly in polygons]
    path_tags = "\n    ".join(
        f'<path d="{d}" fill="url(#boundaryGrad)" stroke="#4CAF50" stroke-width="2" stroke-linejoin="round"/>'
        for d in svg_paths
    )

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:{width}px;background:#f5f5f5;border-radius:12px;font-family:'PingFang SC','Microsoft YaHei',sans-serif">
  <defs>
    <linearGradient id="boundaryGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E8F5E9" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#C8E6C9" stop-opacity="0.7"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.1"/>
    </filter>
  </defs>

  <!-- 行政区轮廓 -->
  <g class="district-boundary" filter="url(#shadow)">
    {path_tags}
  </g>

  <!-- 中心标记 -->
  <circle cx="{width/2}" cy="{height/2}" r="8" fill="#FF7826" stroke="#fff" stroke-width="2"/>
  <text x="{width/2}" y="{height/2 + 25}" text-anchor="middle" font-size="14" fill="#333" font-weight="bold">{name}</text>
</svg>"""

    Path(output_file).write_text(svg, encoding="utf-8")
    print("SVG 已保存到:", output_file)
    return {"boundary": boundary, "svg_paths": svg_paths}


def main():
    client = FlatTalkClient()
    output_dir = Path("geographicSVG")
    output_dir.mkdir(parents=True, exist_ok=True)

    fetch_boundary_and_generate_svg(client, "巴马瑶族自治县", BAMA_CENTER, str(output_dir / "巴马县边界.svg"))
    fetch_boundary_and_generate_svg(client, "防城港市", FCG_CENTER, str(output_dir / "防城港市边界.svg"))

    print("\n完成！接下来可以基于这些边界数据生成完整路线图。")


if __name__ == "__main__":
    main()
