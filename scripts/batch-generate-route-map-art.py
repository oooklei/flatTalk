#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量生成全部 sojourn-maps 资源包的艺术底图 SVG
（batch-generate-route-map-art.mjs 的 Python 等价实现）

用法：
  python scripts/batch-generate-route-map-art.py
环境变量：
  FLATTALK_ROUTE_MAP_AI=1（默认）；=0 仅地理底图
  FLATTALK_BASE_URL（默认 http://127.0.0.1:5298）

差异说明：
  - 原版 JS 直接 import mapstudio 和 route-map-art 模块；
  - Python 版通过 /api/debug/fn/* 桥端点调用 generateSvg、fetchDistrictBoundary、
    buildRouteMapArtBackground，避免在 Python 侧重新实现 SVG 生成逻辑。
  - 桥端点内部提供默认的图片下载和静态图URL实现，Python 无需传回调。
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

MAPS_DIR = _ROOT / "data" / "sojourn-maps"
REPORT = _ROOT / "data" / "sojourn-map-art-batch-report.json"


def main() -> None:
    enable_ai = os.environ.get("FLATTALK_ROUTE_MAP_AI", "1") != "0"
    packages = list_packages()
    print(f"[batch-art] packages={len(packages)}")
    print(f"[batch-art] AI={'1' if enable_ai else '0'}")

    client = FlatTalkClient(timeout=300)  # 艺术底图生成可能较慢
    report: dict[str, Any] = {"started_at": datetime.utcnow().isoformat(), "items": []}

    for i, route_id in enumerate(packages):
        print(f"[{i + 1}/{len(packages)}] {route_id} ... ", end="", flush=True)
        try:
            r = process_one(route_id, client, enable_ai)
            report["items"].append(r)
            if r["ok"]:
                print(
                    f"ok source={r.get('art_source', '')} cached={r.get('cached', False)} "
                    f"{r.get('elapsed_ms', 0)}ms"
                )
            else:
                print(f"fail {r.get('error', '')}")
        except Exception as err:  # noqa: BLE001
            item = {"routeId": route_id, "ok": False, "error": f"{type(err).__name__}: {err}"}
            report["items"].append(item)
            print(f"error {item['error']}")

        # 轻微限速，避免 Seedream / 腾讯连打
        time.sleep(0.8)

    report["finished_at"] = datetime.utcnow().isoformat()
    report["ok"] = sum(1 for x in report["items"] if x.get("ok"))
    report["fail"] = sum(1 for x in report["items"] if not x.get("ok"))
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[batch-art] done ok={report['ok']} fail={report['fail']}")
    print(f"[batch-art] report {REPORT}")


def list_packages() -> list[str]:
    if not MAPS_DIR.exists():
        return []
    names: list[str] = []
    for entry in sorted(MAPS_DIR.iterdir()):
        if entry.is_dir() and (entry / "route_data.json").exists():
            names.append(entry.name)
    return names


def calc_zoom(waypoints: list[dict[str, Any]]) -> tuple[int, float, float]:
    lats = [float(w["lat"]) for w in waypoints if _is_num(w.get("lat"))]
    lngs = [float(w["lng"]) for w in waypoints if _is_num(w.get("lng"))]
    if not lats or not lngs:
        return 10, 23.5, 109.0
    center_lat = (min(lats) + max(lats)) / 2
    center_lng = (min(lngs) + max(lngs)) / 2
    span = max(max(lats) - min(lats), max(lngs) - min(lngs))
    if span > 1.5:
        zoom = 8
    elif span > 0.8:
        zoom = 9
    elif span > 0.4:
        zoom = 10
    elif span > 0.15:
        zoom = 11
    elif span > 0.06:
        zoom = 12
    else:
        zoom = 13
    return zoom, center_lat, center_lng


def process_one(route_id: str, client: FlatTalkClient, enable_ai: bool) -> dict[str, Any]:
    pkg_dir = MAPS_DIR / route_id
    route_data = json.loads((pkg_dir / "route_data.json").read_text(encoding="utf-8"))
    waypoints = route_data.get("waypoints") or []
    route_name = route_data.get("route_name") or route_id
    destination = route_data.get("destination") or ""

    if not waypoints:
        return {"routeId": route_id, "ok": False, "error": "no_waypoints"}

    zoom, center_lat, center_lng = calc_zoom(waypoints)
    t0 = time.perf_counter()

    # 边界：通过桥端点获取
    boundary: list[Any] = []
    try:
        bd_resp = client.fetch_district_boundary(destination=destination, route_name=route_name)
        if isinstance(bd_resp, dict):
            boundary = bd_resp.get("polygons") or []
    except Exception:  # noqa: BLE001
        boundary = []

    # 艺术底图：通过桥端点生成（桥内部使用 TencentMapAdapter 和默认下载器）
    art = client.build_route_map_art_background(
        route_id=route_id,
        route_name=route_name,
        destination=destination,
        waypoints=waypoints,
        center_lat=center_lat,
        center_lng=center_lng,
        zoom=zoom,
        size="800*840",
        enable_ai=enable_ai,
    )
    if not isinstance(art, dict):
        art = {}

    bg = art.get("data_uri") or ""

    # SVG：通过桥端点生成
    svg_std_resp = client.generate_svg(
        waypoints=waypoints,
        route_id=route_id,
        route_name=route_name,
        version="standard",
        static_map_url=bg,
        boundary_polygons=boundary,
    )
    svg_elder_resp = client.generate_svg(
        waypoints=waypoints,
        route_id=route_id,
        route_name=route_name,
        version="elder",
        static_map_url=bg,
        boundary_polygons=boundary,
    )
    svg_std = svg_std_resp.get("svg", "") if isinstance(svg_std_resp, dict) else ""
    svg_elder = svg_elder_resp.get("svg", "") if isinstance(svg_elder_resp, dict) else ""

    (pkg_dir / "map_standard.svg").write_text(svg_std, encoding="utf-8")
    (pkg_dir / "map_elder.svg").write_text(svg_elder, encoding="utf-8")

    # 同步扁平文件
    (MAPS_DIR / f"{route_id}_standard.svg").write_text(svg_std, encoding="utf-8")
    (MAPS_DIR / f"{route_id}_elder.svg").write_text(svg_elder, encoding="utf-8")

    # 记录 art meta
    meta = {
        "route_id": route_id,
        "art_source": art.get("source") or "none",
        "maptype": art.get("maptype") or "",
        "model": art.get("model") or "",
        "cached": bool(art.get("cached")),
        "features": (art.get("features") or {}).get("topLabels", []) if isinstance(art.get("features"), dict) else [],
        "error": art.get("error") or "",
        "elapsed_ms": round((time.perf_counter() - t0) * 1000),
        "updated_at": datetime.utcnow().isoformat(),
    }
    (pkg_dir / "art_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "routeId": route_id,
        "ok": True,
        **meta,
        "hasBg": bool(bg),
        "svgBytes": len(svg_std),
    }


def _is_num(value: Any) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    main()
