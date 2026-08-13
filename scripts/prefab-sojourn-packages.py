#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量预制 sojourn-maps 资源包（FCG + Dashboard Excel + 金跳动）
同义合并：dashboard FCG ↔ fcg_route_*；巴马 excel/JTD mock → bama_5d4n
（prefab-sojourn-packages.mjs 的 Python 等价实现）

用法：python scripts/prefab-sojourn-packages.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient  # noqa: E402

ROOT = _ROOT
MAPS = ROOT / "data" / "sojourn-maps"
DASH = ROOT.parent / "flatTalk-dashboard" / "data"
FCG_FILE = ROOT / "data" / "fangchenggang-routes.json"

CITY_COORDS = {
    "桂林": [25.274, 110.29], "永福": [24.98, 109.983], "阳朔": [24.778, 110.489],
    "恭城": [24.833, 110.83], "荔浦": [24.489, 110.397], "贺州": [24.414, 111.552],
    "昭平": [24.17, 110.81], "钟山": [24.52, 111.3], "富川": [24.82, 111.28],
    "南宁": [22.817, 108.366], "上林": [23.43, 108.6], "马山": [23.71, 108.18],
    "崇左": [22.4, 107.37], "扶绥": [22.63, 107.9], "天等": [23.08, 107.14],
    "大新": [22.83, 107.2], "龙州": [22.34, 106.85], "防城港": [21.69, 108.35],
    "东兴": [21.54, 107.97], "北海": [21.48, 109.12], "钦州": [21.98, 108.62],
    "宁明": [22.13, 107.07], "巴马": [24.12, 107.25], "南丹": [24.98, 107.54],
    "三江": [25.78, 109.61], "龙胜": [25.8, 110.01], "柳州": [24.326, 109.428],
    "金秀": [24.13, 110.19], "平乐": [24.63, 110.64], "来宾": [23.75, 109.23],
    "七洞乡": [23.6817, 109.0512], "兴宾": [23.73, 109.22],
}

_client = FlatTalkClient()


def _is_finite(value) -> bool:
    """等价 JS Number.isFinite：排除 None/bool/NaN/Infinity/非数字。"""
    if value is None or isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def _to_number(value) -> float:
    """等价 JS Number(x)：无法转换时返回 NaN。"""
    if value is None or isinstance(value, bool):
        return float("nan")
    if isinstance(value, (int, float)):
        return float(value)
    try:
        text = str(value).strip()
        if text == "":
            return 0.0
        return float(text)
    except (TypeError, ValueError):
        return float("nan")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uniq(items) -> list:
    """等价 [...new Set(items)]：去重并保持插入顺序。"""
    return list(dict.fromkeys(items))


def _find_city_key(name: str):
    """等价 Object.keys(CITY_COORDS).find((k) => name.includes(k))。"""
    for key in CITY_COORDS:
        if key in name:
            return key
    return None


def _read_json(file_path: Path):
    return json.loads(Path(file_path).read_text(encoding="utf-8"))


def _write_json(file_path: Path, data) -> None:
    Path(file_path).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def ensureDir(p) -> None:
    Path(p).mkdir(parents=True, exist_ok=True)


def inferProductType(text="") -> str:
    t = str(text)
    if re.search(r"滨海|海滩|银滩|京族|口岸|边境|涠洲|海滨|跨境|芒街", t):
        return "coastal"
    if re.search(r"文化|非遗|古镇|侗|瑶|壮|花山|风雨桥|民俗", t):
        return "culture"
    if re.search(r"生态|山水|梯田|溶洞|森林|喀斯特|德天|漂流", t):
        return "ecology"
    return "wellness"


def mergePublish(routeId: str, patch: dict) -> dict:
    f = MAPS / routeId / "publish.json"
    cur = {}
    if f.exists():
        cur = _read_json(f)
    dest = _uniq([x for x in [*(cur.get("destination") or []), *(patch.get("destination") or [])] if x])
    kw = _uniq([x for x in [*(cur.get("keywords") or []), *(patch.get("keywords") or [])] if x])
    out = {**cur, **patch}
    out["route_id"] = routeId
    out["status"] = patch.get("status") or cur.get("status") or "published"
    out["destination"] = dest
    out["keywords"] = kw
    out["product_type"] = patch.get("product_type") or cur.get("product_type") or "wellness"
    out["title"] = patch.get("title") or cur.get("title") or routeId
    out["updated_at"] = _now_iso()
    out["aliases"] = _uniq([*(cur.get("aliases") or []), *(patch.get("aliases") or [])])
    ensureDir(f.parent)
    _write_json(f, out)
    return out


def writePackage(routeId: str, routeData: dict, svgStandard, svgElder, publish: dict) -> None:
    dir_path = MAPS / routeId
    ensureDir(dir_path)
    rd = {**routeData, "route_id": routeId, "updated_at": _now_iso()}
    _write_json(dir_path / "route_data.json", rd)
    if svgStandard:
        (dir_path / "map_standard.svg").write_text(svgStandard, encoding="utf-8")
        (MAPS / f"{routeId}_standard.svg").write_text(svgStandard, encoding="utf-8")
    if svgElder:
        (dir_path / "map_elder.svg").write_text(svgElder, encoding="utf-8")
        (MAPS / f"{routeId}_elder.svg").write_text(svgElder, encoding="utf-8")
    publishOut = {
        "route_id": routeId,
        "status": publish.get("status") or "published",
        "destination": _uniq([x for x in (publish.get("destination") or []) if x]),
        "keywords": _uniq([x for x in (publish.get("keywords") or []) if x]),
        "product_type": publish.get("product_type") or "wellness",
        "title": publish.get("title") or routeId,
        "updated_at": _now_iso(),
        "aliases": _uniq(publish.get("aliases") or []),
    }
    _write_json(dir_path / "publish.json", publishOut)
    print("[ok]", routeId, publishOut["status"], publishOut["product_type"], publishOut["title"])


def buildSvg(waypoints: list, routeId: str, routeName: str) -> dict:
    std = _client.generate_svg(
        waypoints=waypoints, route_id=routeId, route_name=routeName, version="standard"
    )["svg"]
    elder = _client.generate_svg(
        waypoints=waypoints, route_id=routeId, route_name=routeName, version="elder"
    )["svg"]
    return {"svgStandard": std, "svgElder": elder}


def pointsToWaypoints(points=None, fallbackDest=None) -> list:
    points = points or []
    out = []
    for i, p in enumerate(points):
        coord = p.get("coord")
        if isinstance(coord, list):
            lat = _to_number(coord[1] if len(coord) > 1 else None)
            lng = _to_number(coord[0] if len(coord) > 0 else None)
        else:
            lat = _to_number(p.get("lat"))
            lng = _to_number(p.get("lng"))
        if not _is_finite(lat) or not _is_finite(lng):
            key = _find_city_key(str(p.get("name") or p.get("city") or ""))
            if key:
                lat = CITY_COORDS[key][0]
                lng = CITY_COORDS[key][1]
        if not _is_finite(lat) or not _is_finite(lng):
            fb = CITY_COORDS.get(fallbackDest) or CITY_COORDS["南宁"]
            lat = fb[0] + i * 0.02
            lng = fb[1] + i * 0.02
        if i == 0:
            wp_type = "arrival"
        elif i == len(points) - 1:
            wp_type = "departure"
        else:
            wp_type = "spot"
        out.append({
            "id": f"wp{i + 1}",
            "name": p.get("name") or p.get("city") or f"点{i + 1}",
            "type": wp_type,
            "day": f"Day{min(i + 1, 7)}",
            "plan": p.get("plan") or p.get("name") or "",
            "lat": lat,
            "lng": lng,
            "spot_desc": p.get("spot_desc") or "",
        })
    return out


def pathTokensToWaypoints(pathStr, fallbackDest=None) -> list:
    parts = [
        s for s in (
            re.sub(r"^线路\d+_?", "", token).strip()
            for token in re.split(r"→|->|－|-|—|～|,|，", str(pathStr or ""))
        ) if s
    ]
    points = []
    for name in parts:
        key = _find_city_key(name)
        c = CITY_COORDS[key] if key else None
        points.append({"name": name, "lat": c[0] if c else None, "lng": c[1] if c else None})
    return pointsToWaypoints(points, fallbackDest)


def inferDestFromText(text) -> str:
    t = str(text or "")
    # 多城线路：优先路径起点（南宁-北海-… → 南宁）
    segments = re.split(r"→|->|－|-|—", t)
    first = segments[0] if segments and segments[0] else t
    order = ["七洞乡", "防城港", "东兴", "北海", "钦州", "巴马", "桂林", "阳朔", "贺州",
             "崇左", "南宁", "柳州", "来宾", "三江", "龙胜"]
    fromFirst = next((c for c in order if c in first), None)
    if fromFirst:
        return fromFirst
    return next((c for c in order if c in t), None) or "广西"


def _flatten(parts) -> list:
    """等价 JS parts.flat()：仅展开一层。"""
    flat = []
    for item in parts:
        if isinstance(item, (list, tuple)):
            flat.extend(item)
        else:
            flat.append(item)
    return flat


def keywordsFrom(*parts) -> list:
    flat = _flatten(parts)
    raw = " ".join(str(x) for x in flat if x)
    prefer = []
    patterns = [
        r"京族滨海文化线|银发爱情边境线|壮村民俗康养线|森林轻氧休闲线|芒街跨境体验线",
        r"南宁-北海-钦州-防城港滨海养老旅居线|边关壮瑶|梯田温泉侗瑶|山水瑶泉|山水温泉长寿",
        r"百魔洞|长寿村|赐福湖|金滩|白浪滩|涠洲岛|德天|花山|风雨桥|银滩",
        r"七洞乡|0730测试|0724测试|5天4晚|三日游",
    ]
    for pattern in patterns:
        m = re.search(pattern, raw)
        if m:
            prefer.append(m.group(0))
    bag = list(dict.fromkeys(prefer))
    for chunk in flat:
        s = str(chunk if chunk is not None else "").strip()
        if 2 <= len(s) <= 14 and s not in bag:
            bag.append(s)
    for stop in ["旅居", "康养", "线路", "路线", "养老", "广西", "市区", "体验", "文化", "休闲", "七日"]:
        if stop in bag:
            bag.remove(stop)
    return bag[:12]


def extractShortTags(name="") -> list:
    t = str(name)
    tags = []
    if re.search(r"京族", t):
        tags.append("京族")
    if re.search(r"银发爱情|边境", t):
        tags.extend(["银发爱情", "边境线"])
    if re.search(r"壮村|民俗", t):
        tags.extend(["壮村", "民俗"])
    if re.search(r"森林|轻氧", t):
        tags.extend(["森林", "轻氧"])
    if re.search(r"芒街|跨境", t):
        tags.extend(["芒街", "跨境"])
    return tags


# ---------- FCG 002-005 from local fangchenggang-routes ----------
def prefabFcg() -> None:
    routes = _read_json(FCG_FILE)
    typeMap = {
        "fcg_route_001": "coastal",
        "fcg_route_002": "culture",
        "fcg_route_003": "culture",
        "fcg_route_004": "ecology",
        "fcg_route_005": "coastal",
    }
    for r in routes:
        routeId = r.get("product_id")
        highlights = r.get("highlights") or []
        waypoints = []
        for i, w in enumerate(r.get("waypoints") or []):
            wp = {
                "id": f"wp{i + 1}",
                "name": w.get("name"),
                "type": w.get("type") or "spot",
                "day": w.get("day") or "Day1",
                "plan": w.get("plan") or "",
                "lat": _to_number(w.get("lat")),
                "lng": _to_number(w.get("lng")),
                "spot_desc": (highlights[i] if i < len(highlights) else None) or "",
            }
            if _is_finite(wp["lat"]) and _is_finite(wp["lng"]):
                waypoints.append(wp)
        svg = buildSvg(waypoints, routeId, r.get("product_name"))
        tags = r.get("tags") or []
        writePackage(
            routeId=routeId,
            routeData={
                "route_name": r.get("product_name"),
                "destination": r.get("destination"),
                "days": 1,
                "summary": r.get("summary"),
                "highlights": highlights,
                "suitable_for": r.get("suitable_for"),
                "tags": tags,
                "waypoints": waypoints,
                "price_label": r.get("price_label"),
                "source": "fangchenggang-routes",
                "aliases": [f"route_dash_fcg_{str(routeId)[-1:]}"],
            },
            svgStandard=svg["svgStandard"],
            svgElder=svg["svgElder"],
            publish={
                "status": "published",
                "destination": [x for x in [r.get("destination"), "东兴"] if x],
                "keywords": [x for x in [
                    r.get("product_name"),
                    *tags[:3],
                    *extractShortTags(r.get("product_name") or ""),
                ] if x],
                "product_type": typeMap.get(routeId) or inferProductType(
                    str(r.get("product_name") or "") + "".join(str(t) for t in tags)
                ),
                "title": r.get("product_name"),
                "aliases": [f"route_dash_fcg_{int(_to_number(str(routeId)[-1:]))}"],
            },
        )


# ---------- Dashboard excel 10 (+ merge FCG aliases already handled) ----------
def prefabDashboardExcel() -> None:
    knowledge = _read_json(DASH / "travel-routes-knowledge.json")
    geo = _read_json(DASH / "travelRouteGeo.json")
    geoById = {g.get("id"): g for g in geo}

    for idx, r in enumerate(knowledge, start=1):
        if "docx_fcg" in str(r.get("source") or "") or "route_dash_fcg" in str(r.get("id")):
            # 同义：合并到已有 fcg_route_00x
            m = re.search(r"fcg_(\d)", str(r.get("id")))
            n = m.group(1) if m else None
            if n:
                target = f"fcg_route_00{n}"
                mergePublish(target, {
                    "aliases": [r.get("id")],
                    "keywords": [x for x in [r.get("name")] if x],
                    "destination": ["防城港"],
                })
                print("[merge]", r.get("id"), "→", target)
            continue

        # 巴马长寿线 → 合并进 bama_5d4n
        combined = str(r.get("id")) + str(r.get("name"))
        if re.search(r"巴马|长寿", combined) and re.search(r"线路7|巴马_南丹|南丹长寿", combined):
            mergePublish("bama_5d4n", {
                "aliases": [r.get("id")],
                "keywords": ["南丹", "南丹长寿", "巴马南丹", "长寿养老旅居线"],
                "destination": ["巴马", "南丹", "河池"],
                "title": "巴马5天4晚康养旅居",
                "status": "published",
                "product_type": "wellness",
            })
            print("[merge]", r.get("id"), "→ bama_5d4n")
            continue

        routeId = f"gx_excel_{str(idx).zfill(2)}"
        g = geoById.get(r.get("id"))
        waypoints = pointsToWaypoints(
            (g.get("points") if g else None) or r.get("points") or [],
            inferDestFromText(r.get("route_path") or r.get("name")),
        )
        # 线路10 geo 误用巴马点：按路径名重建
        if idx == 10 or (
            re.search(r"柳州|金秀|平乐", str(r.get("id")))
            and any(re.search(r"巴马|南丹|盘阳", str(w.get("name"))) for w in waypoints)
        ):
            waypoints = pathTokensToWaypoints("柳州-金秀-荔浦-平乐", "柳州")
        if len(waypoints) < 2:
            waypoints = pathTokensToWaypoints(
                r.get("route_path") or r.get("name"), inferDestFromText(r.get("name"))
            )

        dest = inferDestFromText(
            r.get("route_path") or r.get("name") or (waypoints[0].get("name") if waypoints else None)
        )
        title = re.sub(r"^线路\d+_?", "", str(r.get("route_path") or r.get("name") or routeId))[:40]
        itinerary = r.get("itinerary") if isinstance(r.get("itinerary"), list) else []
        if r.get("highlights"):
            highlights = r.get("highlights")
        else:
            highlights = [
                x for x in (it.get("theme") or it.get("day") for it in itinerary) if x
            ][:6]
        # 把行程主题写进 waypoint.spot_desc，便于 SVG/卡片展示
        merged = []
        for i, wp in enumerate(waypoints):
            it = itinerary[i] if i < len(itinerary) else None
            if it is None:
                it = next((x for x in itinerary if wp.get("name") in str(x.get("day") or "")), None)
            desc = " · ".join([
                x for x in [
                    (it or {}).get("theme"),
                    (it or {}).get("plan"),
                    wp.get("spot_desc"),
                ] if x
            ])[:120]
            merged.append({**wp, "spot_desc": desc or wp.get("spot_desc") or ""})
        waypoints = merged
        svg = buildSvg(waypoints, routeId, title)
        path_keywords = [
            s for s in (t.strip() for t in re.split(r"→|->|－|-|—", str(r.get("route_path") or title)))
            if 2 <= len(s) <= 12
        ][:6]
        writePackage(
            routeId=routeId,
            routeData={
                "route_name": title,
                "destination": dest,
                "days": r.get("days") or 7,
                "summary": r.get("description") or r.get("summary") or "",
                "highlights": highlights,
                "suitable_for": r.get("suitable_for") or "",
                "medical_support": r.get("medical_support") or "",
                "accommodation_standard": r.get("accommodation_standard") or "",
                "meal_standard": r.get("meal_standard") or "",
                "transport": r.get("transport") or "",
                "waypoints": waypoints,
                "itinerary": itinerary,
                "source": "flatTalk-dashboard",
                "dashboard_id": r.get("id"),
            },
            svgStandard=svg["svgStandard"],
            svgElder=svg["svgElder"],
            publish={
                "status": "published",
                "destination": [dest],
                "keywords": [title, *path_keywords],
                "product_type": inferProductType(title + str(r.get("description") or "")),
                "title": title,
                "aliases": [r.get("id")],
            },
        )


# ---------- 金跳动 3 条真实接口产品 ----------
def prefabJtd() -> None:
    search = _client.jtd_search_products(query={
        "tenantId": "042788",
        "productDomain": "sojourn_route",
        "pageNum": 1,
        "pageSize": 50,
    })
    search = search or {}
    response = search.get("response") or {}
    resp_data = response.get("data") or {}
    records = (
        resp_data.get("records")
        or resp_data.get("list")
        or response.get("records")
        or (search.get("data") or {}).get("records")
        or []
    )
    print("[jtd] records", len(records), "ok", search.get("ok"))

    presets = {
        "2070305000000000240": {
            "title": "七洞乡线路产品",
            "destination": "七洞乡",
            "product_type": "wellness",
            "waypoints": [
                {"name": "七洞乡政府", "lat": 23.6817, "lng": 109.0512, "type": "arrival", "day": "Day1", "plan": "抵达办理入住"},
                {"name": "七洞乡康养基地", "lat": 23.6852, "lng": 109.0491, "type": "wellness", "day": "Day2", "plan": "康养体验"},
                {"name": "七洞乡生态园", "lat": 23.6781, "lng": 109.0568, "type": "spot", "day": "Day3", "plan": "生态游憩"},
                {"name": "七洞乡政府", "lat": 23.6817, "lng": 109.0512, "type": "departure", "day": "Day3", "plan": "返程"},
            ],
        },
        "2070305000000000271": {
            "title": "0730测试旅居路线5天4日游",
            "destination": "七洞乡",
            "product_type": "wellness",
            "waypoints": [
                {"name": "七洞乡抵达点", "lat": 23.6817, "lng": 109.0512, "type": "arrival", "day": "Day1", "plan": "抵达入住"},
                {"name": "七洞乡Day2体验点", "lat": 23.7197, "lng": 109.0388, "type": "spot", "day": "Day2", "plan": "康养体验"},
                {"name": "七洞乡Day3体验点", "lat": 23.7052, "lng": 109.0836, "type": "spot", "day": "Day3", "plan": "康养体验"},
                {"name": "七洞乡Day4体验点", "lat": 23.6582, "lng": 109.0836, "type": "spot", "day": "Day4", "plan": "康养体验"},
                {"name": "七洞乡返程点", "lat": 23.6817, "lng": 109.0512, "type": "departure", "day": "Day5", "plan": "返程"},
            ],
        },
        "2070305000000000266": {
            "title": "0724测试旅居路线",
            "destination": "巴马",
            "product_type": "wellness",
            # 同义巴马：不单独抢流量，仍建包但 keywords 偏产品名；并把别名合并进 bama_5d4n
            "waypoints": [
                {"name": "巴马县城", "lat": 24.12, "lng": 107.25, "type": "arrival", "day": "Day1", "plan": "抵达"},
                {"name": "百魔洞", "lat": 24.15, "lng": 107.05, "type": "spot", "day": "Day2", "plan": "负氧磁疗"},
                {"name": "长寿村", "lat": 24.10, "lng": 107.15, "type": "wellness", "day": "Day3", "plan": "长寿文化"},
                {"name": "巴马县城", "lat": 24.12, "lng": 107.25, "type": "departure", "day": "Day3", "plan": "返程"},
            ],
            "mergeInto": "bama_5d4n",
        },
    }

    if records:
        listing = records
    else:
        listing = [{"productId": pid, "productName": presets[pid]["title"]} for pid in presets]

    for raw in listing[:3]:
        pid = str(raw.get("productId") or raw.get("product_id") or raw.get("id") or "")
        name = (
            raw.get("productName") or raw.get("product_name") or raw.get("name")
            or (presets.get(pid) or {}).get("title") or pid
        )
        preset = presets.get(pid) or {
            "title": name,
            "destination": inferDestFromText(name),
            "product_type": inferProductType(name),
            "waypoints": pathTokensToWaypoints(name, inferDestFromText(name)),
        }
        # 注：原 .mjs 此处字符串被污染（jtd_$836739851904_AWS_us-west-1），
        # 按上下文语义修正为 jtd_836739851904_AWS_us-west-1
        routeId = "jtd_836739851904_AWS_us-west-1"
        waypoints = [
            {"id": f"wp{i + 1}", **w, "lat": _to_number(w.get("lat")), "lng": _to_number(w.get("lng"))}
            for i, w in enumerate(preset.get("waypoints") or [])
        ]
        svg = buildSvg(waypoints, routeId, preset.get("title") or name)

        # 巴马同义：主流量归 bama_5d4n；JTD 包仍 published 但 keywords 带产品 ID，避免完全丢包
        if preset.get("mergeInto"):
            mergePublish(preset["mergeInto"], {
                "aliases": [routeId, pid, "jtd_mock_bama_001"],
                "keywords": keywordsFrom(name, "0724", "测试旅居"),
                "destination": ["巴马"],
            })
            print("[merge]", routeId, "→", preset["mergeInto"])

        routeData = {
            "route_name": preset.get("title") or name,
            "destination": preset.get("destination"),
            "days": len(waypoints),
            "summary": re.sub(r"^金跳动产品\s*", "", str(name or preset.get("title") or "")),
            "highlights": [],
            "waypoints": waypoints,
            "source": "jintiaodong",
            "jtd_product_id": pid,
        }
        if raw.get("price") is not None:
            routeData["price_label"] = f"约{raw.get('price')}元/人"

        writePackage(
            routeId=routeId,
            routeData=routeData,
            svgStandard=svg["svgStandard"],
            svgElder=svg["svgElder"],
            publish={
                "status": "published",
                "destination": [preset.get("destination")],
                "keywords": keywordsFrom(
                    name, preset.get("title"), preset.get("destination"), pid[-4:], "旅居"
                ),
                "product_type": preset.get("product_type"),
                "title": preset.get("title") or name,
                "aliases": [pid],
            },
        )

    # mock 巴马保持 draft，避免与 published 抢命中
    if (MAPS / "jtd_mock_bama_001" / "route_data.json").exists():
        mergePublish("jtd_mock_bama_001", {
            "status": "draft",
            "aliases": ["jtd_mock_bama_001"],
            "keywords": ["草稿勿命中"],
        })
    # mock 北海若无包则补一个 published（接口仅 3 条真实产品；mock 北海作为补充不强制）


def updateIndex() -> None:
    dirs = [d for d in MAPS.iterdir() if d.is_dir()]
    index = []
    for d in dirs:
        rdFile = MAPS / d.name / "route_data.json"
        pubFile = MAPS / d.name / "publish.json"
        if not rdFile.exists():
            continue
        rd = _read_json(rdFile)
        pub = None
        try:
            pub = _read_json(pubFile)
        except Exception:
            pass
        index.append({
            "route_id": d.name,
            "route_name": rd.get("route_name"),
            "destination": rd.get("destination"),
            "status": (pub or {}).get("status") or "draft",
            "product_type": (pub or {}).get("product_type") or None,
            "updated_at": (pub or {}).get("updated_at") or rd.get("updated_at"),
        })
    _write_json(MAPS / "index.json", index)
    print("[index]", len(index), "packages")


def main() -> None:
    ensureDir(MAPS)
    print("=== FCG ===")
    prefabFcg()
    print("=== Dashboard Excel ===")
    prefabDashboardExcel()
    print("=== JTD ===")
    prefabJtd()
    updateIndex()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
