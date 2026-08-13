#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
天气风险按钮完整链路测试
（test-weather-risk.mjs 的 Python 等价实现）

用法：python scripts/test-weather-risk.py
前提：flatTalk 服务以开发模式运行（默认 127.0.0.1:5298）

说明：测试3 使用合成天气数据驱动填槽（避免腾讯付费接口）；
测试4 仅校验编排器桥端点可达，不驱动完整付费链路。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from flattalk_client import FlatTalkClient, FlatTalkError  # noqa: E402

client = FlatTalkClient()

_pass = 0
_fail = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global _pass, _fail
    if cond:
        _pass += 1
        print(f"  ✓ {name}")
    else:
        _fail += 1
        print(f"  ✗ {name} {detail}")


# ========== 测试1：天气服务可用性 ==========
print("=== 测试1: 天气服务 ===")
# 说明：tencentGetWeather 桥端点已可用，但每次调用均产生腾讯地图 API 计费。
# 此处只对 1 个城市做真实连通性校验，其余 3 个城市不重复计费。
test_cities = ["防城港", "北海", "桂林", "巴马"]
try:
    _w = client._call_fn("tencentGetWeather", {"city": test_cities[0], "days": 2})
    _w_ok = isinstance(_w, dict) and (_w.get("ok") is True or bool(_w.get("daily")))
    check(f"tencentGetWeather({test_cities[0]}) 可用", _w_ok,
          f"(ok={_w.get('ok') if isinstance(_w, dict) else None})")
except FlatTalkError as e:
    # 未配置 TENCENT_MAP_KEY 等环境依赖时视为跳过，不判失败
    print(f"  ⚠ 天气服务不可用（环境依赖缺失）：{e}")
for city in test_cities[1:]:
    print(f"    ℹ {city}: 跳过（避免重复计费）")

# ========== 测试2：resolveWeatherCity 城市提取 ==========
print("\n=== 测试2: resolveWeatherCity 城市提取 ===")


def resolve_weather_city_test(request: dict, business_data: dict) -> list[str]:
    """原脚本内联的纯逻辑函数，Python 等价实现。"""
    context = request.get("context") or {}
    params = context.get("action_params") or {}
    from_params = params.get("city") or context.get("city")
    if from_params and str(from_params).strip():
        return [str(from_params).strip()]
    bd = business_data or {}
    cities = bd.get("cities")
    if isinstance(cities, list) and cities:
        return cities
    jtd = bd.get("jtd") or {}
    product = jtd.get("selected_product")
    if not product:
        _products = jtd.get("products")
        product = _products[0] if isinstance(_products, list) and _products else None
    route = bd.get("route")
    if not route:
        _routes = bd.get("routes")
        route = _routes[0] if isinstance(_routes, list) and _routes else None
    product = product or {}
    route = route or {}
    fallback = str(
        product.get("destination")
        or product.get("city")
        or route.get("destination")
        or bd.get("primary_city")
        or bd.get("destination")
        or ""
    ).strip()
    return [fallback] if fallback else []


# 场景A：action_params 有 city
cities_a = resolve_weather_city_test({"context": {"action_params": {"city": "防城港"}}}, {})
check(
    "action_params.city 提取",
    (cities_a[0] if cities_a else None) == "防城港",
    f"(got {cities_a[0] if cities_a else None})",
)

# 场景B：从 jtd 产品提取
cities_b = resolve_weather_city_test(
    {"context": {}},
    {"jtd": {"selected_product": {"destination": "广西防城港"}}},
)
check(
    "jtd.destination 提取",
    (cities_b[0] if cities_b else None) == "广西防城港",
    f"(got {cities_b[0] if cities_b else None})",
)

# 场景C：从 primary_city 提取
cities_c = resolve_weather_city_test({"context": {}}, {"primary_city": "防城港"})
check(
    "primary_city 提取",
    (cities_c[0] if cities_c else None) == "防城港",
    f"(got {cities_c[0] if cities_c else None})",
)

# 场景D：无城市信息
cities_d = resolve_weather_city_test({"context": {}}, {})
check("无城市→空数组", len(cities_d) == 0)

# ========== 测试3：fillTravelWeatherRisk 填充 ==========
print("\n=== 测试3: fillTravelWeatherRisk 填充 ===")
# 说明：原脚本用 weatherService.getWeather('防城港') 取真实天气（会调用腾讯付费接口）。
# 此处改用等价结构的合成天气数据驱动填槽逻辑，避免产生外部 API 费用；
# 真实天气适配器另有 tencentGetWeather 桥端点可单独验证。
_SYNTHETIC_WEATHER = {
    "ok": True,
    "city": "防城港",
    "source": "synthetic_for_test",
    "daily": [
        {"date": "2026-08-11", "text": "雷阵雨", "max_temp": 33, "min_temp": 26,
         "wind": "东南风3级", "humidity": 85},
        {"date": "2026-08-12", "text": "多云", "max_temp": 32, "min_temp": 26,
         "wind": "南风2级", "humidity": 80},
    ],
}

# 场景A：有天气数据
result3 = client._call_fn("fillTravelWeatherRisk", {
    "city": "防城港",
    "weather": _SYNTHETIC_WEATHER,
    "business_data": {"primary_city": "防城港"},
})
check("template_id=travel_weather_risk_card",
      result3.get("template_id") == "travel_weather_risk_card",
      f"(got {result3.get('template_id')})")
check("answer_text 非空",
      bool(result3.get("answer_text")) or bool(result3.get("answer")),
      f"({str(result3.get('answer_text'))[:40]})")
_d3 = result3.get("data") or {}
check("data.city 非空", bool(_d3.get("city")))
check("data.riskTips 是数组", isinstance(_d3.get("riskTips"), list),
      f"(got {len(_d3.get('riskTips') or [])})")

# 场景B：天气查询失败
result3b = client._call_fn("fillTravelWeatherRisk", {
    "city": "未知城市",
    "weather": {"ok": False, "error": "test"},
    "business_data": {},
})
check("失败时仍返回模板",
      result3b.get("template_id") == "travel_weather_risk_card",
      f"(got {result3b.get('template_id')})")

# ========== 测试4：通过编排器完整流程 ==========
print("\n=== 测试4: 编排器完整流程 ===")
# 说明：编排器完整流程会真实调用大模型与天气等付费外部接口，
# 且原脚本依赖 JS 回调注入 weatherService/modelService（HTTP 桥无法传函数）。
# 此处仅校验 chatOrchestratorRun 桥端点可达，不驱动完整付费链路。
_ACTION_REQUEST = {
    "message": "检查老人旅居路线天气风险",
    "context": {
        "action_key": "travel_route.check_weather_risk",
        "action_params": {"city": "防城港", "destination": "防城港"},
        "followup_source": "action_button",
    },
    "skill_key": "travel_route",
}
try:
    client._call_fn("chatOrchestratorRun", {"probeOnly": True})
    _orch_reachable = True
except FlatTalkError as e:
    # 端点存在但参数不足会报 500/业务错误；只有 404 才说明未注册
    _orch_reachable = "404" not in str(e)
check("chatOrchestratorRun 桥端点已注册", _orch_reachable)
print(f"  ℹ 完整流程请求体（需付费接口，未实际驱动）: "
      f"{json.dumps(_ACTION_REQUEST, ensure_ascii=False)}")

print(f"\n=== 结果: {_pass} 通过 / {_fail} 失败 ===")
sys.exit(1 if _fail > 0 else 0)
