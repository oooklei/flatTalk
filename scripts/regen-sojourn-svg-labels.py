#!/usr/bin/env python3
"""批量刷新 sojourn-maps SVG：
- 去掉「康养旅居 · 精品路线」等副标题
- 按新字号规则重生（缩放后 ≥10）
- 尽量保留已有艺术底图 data:image

Python 版，替代 regen-sojourn-svg-labels.mjs。
用法: python scripts/regen-sojourn-svg-labels.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path.cwd()
MAPS = ROOT / "data" / "sojourn-maps"


def extract_art_bg(svg=""):
    m = re.search(r'<image[^>]+(?:href|xlink:href)="(data:image[^"]+)"', svg or "", re.IGNORECASE)
    return m.group(1) if m else ""


def list_packages():
    if not MAPS.is_dir():
        return []
    return [
        e.name for e in MAPS.iterdir()
        if e.is_dir() and (e / "route_data.json").exists()
    ]


def load_boundary(pkg_dir):
    fp = pkg_dir / "boundary.json"
    if not fp.exists():
        return []
    try:
        raw = json.loads(fp.read_text(encoding="utf-8"))
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict) and isinstance(raw.get("polygons"), list):
            return raw["polygons"]
        return []
    except (json.JSONDecodeError, OSError):
        return []


def main():
    client = FlatTalkClient()
    ok = 0
    fail = 0

    for route_id in list_packages():
        pkg_dir = MAPS / route_id
        try:
            route = json.loads((pkg_dir / "route_data.json").read_text(encoding="utf-8"))
            waypoints = route.get("waypoints") if isinstance(route, dict) else None
            if not isinstance(waypoints, list) or not waypoints:
                print(f"[skip] {route_id} no waypoints")
                continue
            route_name = route.get("route_name", route_id)
            boundary = load_boundary(pkg_dir)

            prev_std = ""
            prev_elder = ""
            std_path = pkg_dir / "map_standard.svg"
            elder_path = pkg_dir / "map_elder.svg"
            if std_path.exists():
                prev_std = std_path.read_text(encoding="utf-8")
            if elder_path.exists():
                prev_elder = elder_path.read_text(encoding="utf-8")
            bg = extract_art_bg(prev_std) or extract_art_bg(prev_elder)

            std_result = client.generate_svg(
                waypoints=waypoints, route_id=route_id, route_name=route_name,
                version="standard", static_map_url=bg, boundary_polygons=boundary,
            )
            svg_std = std_result.get("svg", "")
            elder_result = client.generate_svg(
                waypoints=waypoints, route_id=route_id, route_name=route_name,
                version="elder", static_map_url=bg, boundary_polygons=boundary,
            )
            svg_elder = elder_result.get("svg", "")

            std_path.write_text(svg_std, encoding="utf-8")
            elder_path.write_text(svg_elder, encoding="utf-8")

            flat_std = MAPS / f"{route_id}_standard.svg"
            flat_elder = MAPS / f"{route_id}_elder.svg"
            if flat_std.exists() or prev_std:
                flat_std.write_text(svg_std, encoding="utf-8")
            if flat_elder.exists() or prev_elder:
                flat_elder.write_text(svg_elder, encoding="utf-8")

            has_sub = bool(re.search(r"康养旅居\s*[·•]\s*精品路线", svg_std))
            font_sizes = [float(m.group(1)) for m in re.finditer(r'font-size="(\d+(?:\.\d+)?)"', svg_std)]
            min_fs = min(font_sizes) if font_sizes else 0
            print(f"[ok] {route_id} art={'yes' if bg else 'no'} minFont={min_fs} hasSlogan={has_sub}")
            ok += 1
        except FlatTalkError as e:
            fail += 1
            print(f"[fail] {route_id} {e}")
        except Exception as e:
            fail += 1
            print(f"[fail] {route_id} {e}")

    print(f"done ok={ok} fail={fail}")


if __name__ == "__main__":
    main()
