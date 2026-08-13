#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
举一反三刷新 sojourn-maps：
1) 本地景点图
2) 空 highlights/itinerary 从 waypoints 写回（禁止运行时套异地样例）
3) 注入行政区边界后重生 SVG（不嵌光栅底图）

（enrich-sojourn-maps-spot-images.mjs 的 Python 等价实现）

用法：python scripts/enrich-sojourn-maps-spot-images.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

MAPS = _ROOT / "data" / "sojourn-maps"


def build_content_from_waypoints(waypoints: list[dict[str, Any]] | None = None) -> dict[str, list]:
    items = [wp for wp in (waypoints or []) if wp and (wp.get("name") or wp.get("plan"))]
    if not items:
        return {"highlights": [], "itinerary": []}

    highlights: list[str] = []
    seen: set[str] = set()
    for wp in items:
        name = str(wp.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        plan = str(wp.get("plan") or "").strip()
        highlights.append(f"{name}·{plan}" if plan else name)
        if len(highlights) >= 5:
            break

    itinerary: list[dict[str, str]] = []
    for i, wp in enumerate(items):
        day_raw = str(wp.get("day") or "").strip()
        if day_raw:
            if re.match(r"^D\d+", day_raw, re.IGNORECASE):
                day = re.sub(r"^day", "D", day_raw, flags=re.IGNORECASE)
            else:
                day = re.sub(r"^Day\s*", "D", day_raw, flags=re.IGNORECASE)
        else:
            day = f"D{i + 1}"
        name = str(wp.get("name") or "").strip()
        plan = str(wp.get("plan") or "").strip() or f"{wp.get('name') or '途经点'}体验"
        itinerary.append({"day": day, "wp_name": name, "plan": plan})

    return {"highlights": highlights, "itinerary": itinerary}


def main() -> int:
    if not MAPS.exists():
        print(f"[error] 目录不存在: {MAPS}")
        return 1

    client = FlatTalkClient(timeout=180)
    updated = 0
    svg_ok = 0
    boundary_ok = 0

    for pkg_dir in sorted(MAPS.iterdir()):
        if not pkg_dir.is_dir():
            continue
        route_path = pkg_dir / "route_data.json"
        if not route_path.exists():
            continue

        route = json.loads(route_path.read_text(encoding="utf-8"))
        wps = route.get("waypoints") or []
        if not wps:
            continue

        enriched = client.enrich_waypoints_from_dashboard_kb(wps)
        before = sum(1 for w in wps if (w.get("spot_images") or []))
        after = sum(1 for w in enriched if (w.get("spot_images") or []))

        route["waypoints"] = enriched
        route["spot_images_source"] = "dashboard_local_kb"

        # 空亮点/行程：从途经点写回，避免运行时回落巴马样例
        from_wp = build_content_from_waypoints(enriched)
        if not route.get("highlights") and from_wp["highlights"]:
            route["highlights"] = from_wp["highlights"]
        if not route.get("itinerary") and from_wp["itinerary"]:
            route["itinerary"] = from_wp["itinerary"]

        dest_raw = route.get("destination")
        dest = dest_raw[0] if isinstance(dest_raw, list) and dest_raw else dest_raw
        route_name = route.get("route_name") or route.get("title") or pkg_dir.name

        boundary = client.fetch_district_boundary(destination=dest or "", route_name=route_name) or {}
        polys = boundary.get("polygons") or []
        route["boundary_source"] = boundary.get("source")
        route["boundary_name"] = boundary.get("name") or ""
        route["boundary_polygon_count"] = len(polys)
        if boundary.get("source") != "none":
            boundary_ok += 1

        route["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            route_path.write_text(json.dumps(route, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError as e:
            print(f"[write-fail] {pkg_dir.name} route_data: {e}")
            continue
        updated += 1

        route_id = route.get("route_id") or pkg_dir.name
        try:
            svg_std_resp = client.generate_svg(
                waypoints=enriched, route_id=route_id, route_name=route_name,
                version="standard", static_map_url="", boundary_polygons=polys,
            )
            svg_elder_resp = client.generate_svg(
                waypoints=enriched, route_id=route_id, route_name=route_name,
                version="elder", static_map_url="", boundary_polygons=polys,
            )
            svg_std = (svg_std_resp or {}).get("svg", "")
            svg_elder = (svg_elder_resp or {}).get("svg", "")

            (pkg_dir / "map_standard.svg").write_text(svg_std, encoding="utf-8")
            (pkg_dir / "map_elder.svg").write_text(svg_elder, encoding="utf-8")
            try:
                (MAPS / f"{route_id}_standard.svg").write_text(svg_std, encoding="utf-8")
                (MAPS / f"{route_id}_elder.svg").write_text(svg_elder, encoding="utf-8")
            except OSError as e:
                print(f"[flat-svg-fail] {route_id}: {e}")

            svg_ok += 1
            has_bd = "district-boundary" in svg_std
            print(
                f"[ok] {route_id} images {before}->{after} "
                f"boundary={boundary.get('source')}/{len(polys)} svgBoundary={has_bd}"
            )
        except Exception as e:  # noqa: BLE001
            print(f"[svg-fail] {route_id}: {e}")

    print(f"[done] packages={updated} svg={svg_ok} withBoundary={boundary_ok}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
