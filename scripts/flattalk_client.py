#!/usr/bin/env python3
"""flatTalk Python 客户端：通过 /api/debug/fn/* 桥端点调用 Node.js 内部函数。

设计目标：让 Python 脚本无需 import Node.js 模块，改用 HTTP 调用
开发模式下暴露的函数桥，从而支持技术栈向 Python 统一迁移。

用法：
    from flattalk_client import FlatTalkClient
    client = FlatTalkClient()  # 默认 localhost:5298
    result = client.fill_template_slots(message="帮我规划巴马路线")
    scene = client.identify_scene(text="推荐养老服务")

依赖：requests
"""
import json
import os
import sys
from typing import Any

import requests

# Windows 控制台默认 GBK，会导致中文/emoji 输出 UnicodeEncodeError。
# 导入本模块的脚本统一切到 UTF-8 输出，避免每个脚本各自处理。
for _stream in (sys.stdout, sys.stderr):
    try:
        if hasattr(_stream, "reconfigure") and (_stream.encoding or "").lower() != "utf-8":
            _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError, ValueError):
        pass


class FlatTalkError(Exception):
    """flatTalk 调试端点返回的错误。"""

    def __init__(self, message: str, status: int = 0, payload: dict | None = None):
        super().__init__(message)
        self.status = status
        self.payload = payload or {}


class FlatTalkClient:
    """封装 /api/debug/fn/* 端点的 Python 客户端。"""

    def __init__(self, base_url: str | None = None, timeout: int = 60):
        env_url = os.environ.get("FLATTALK_BASE_URL")
        self.base_url = (base_url or env_url or "http://127.0.0.1:5298").rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})

    # ── 底层调用 ──────────────────────────────────────────────────
    def _call_fn(self, fn_name: str, body: dict | None = None) -> Any:
        """POST /api/debug/fn/<fn_name>，返回 result 字段。"""
        url = f"{self.base_url}/api/debug/fn/{fn_name}"
        try:
            resp = self._session.post(url, json=body or {}, timeout=self.timeout)
        except requests.RequestException as e:
            raise FlatTalkError(f"HTTP 请求失败: {e}") from e

        try:
            data = resp.json()
        except ValueError:
            raise FlatTalkError(f"非 JSON 响应 (HTTP {resp.status_code}): {resp.text[:200]}", resp.status_code)

        if not data.get("ok"):
            raise FlatTalkError(
                data.get("error", "unknown_error"),
                resp.status_code,
                data,
            )
        return data.get("result")

    def list_endpoints(self) -> list[dict]:
        """GET /api/debug/fn — 返回所有可用的函数桥端点。"""
        try:
            resp = self._session.get(f"{self.base_url}/api/debug/fn", timeout=10)
            return resp.json().get("endpoints", [])
        except (requests.RequestException, ValueError):
            return []

    def health(self) -> dict:
        """GET /api/debug/status — 检查服务状态。"""
        try:
            resp = self._session.get(f"{self.base_url}/api/debug/status", timeout=10)
            return resp.json()
        except (requests.RequestException, ValueError) as e:
            return {"ok": False, "error": str(e)}

    # ── 业务函数桥 ────────────────────────────────────────────────

    def fill_template_slots(
        self,
        message: str = "",
        template_id: str = "",
        template_library: list | None = None,
        business_data: dict | None = None,
        intent_context: dict | None = None,
        **extra,
    ) -> dict:
        """模板填槽：fillTemplateSlots"""
        body = {
            "message": message,
            "template_id": template_id,
            "template_library": template_library or [],
            "business_data": business_data or {},
            "intent_context": intent_context or {},
            **extra,
        }
        return self._call_fn("fillTemplateSlots", body)

    def identify_scene(self, text: str = "", message: str = "", **extra) -> dict:
        """场景识别：identifyScene"""
        body = {"text": text, "message": message, **extra}
        return self._call_fn("identifyScene", body)

    def render_card(self, dir: str = "./cards", json_data: dict | None = None, options: dict | None = None) -> dict:
        """模板渲染：renderCard"""
        body = {"dir": dir, "json": json_data or {}, "options": options or {}}
        return self._call_fn("renderCard", body)

    def discover_templates(self, dir: str = "./cards", raw: bool = False) -> list[dict]:
        """模板发现：discoverTemplates。raw=True 返回完整模板对象（含 description）"""
        return self._call_fn("discoverTemplates", {"dir": dir, "raw": raw})

    def render_preview(self, dir: str = "./cards", template_id: str = "") -> dict:
        """模板预览渲染：renderPreview"""
        return self._call_fn("renderPreview", {"dir": dir, "templateId": template_id})

    def dispatch_action(
        self,
        action_key: str = "",
        params: dict | None = None,
        capture_run_skill: bool = False,
        **extra,
    ) -> dict:
        """动作分发：dispatchAction

        capture_run_skill=True 时，由桥层合成 runSkill 回调并回传 envelope
        （JS 函数无法经 JSON 传入，故用开关标志代替回调注入）。
        """
        body = {"action_key": action_key, "params": params or {}, **extra}
        payload: dict[str, Any] = {"request": body}
        if capture_run_skill:
            payload["captureRunSkill"] = True
        return self._call_fn("dispatchAction", payload)

    def template_id_from_action(self, action_key: str = "", params: dict | None = None) -> dict:
        """动作→模板ID：templateIdFromAction"""
        return self._call_fn("templateIdFromAction", {"actionKey": action_key, "params": params or {}})

    def generate_route_html(self, route_name: str = "", route_description: str = "", **options) -> dict:
        """路线HTML生成：generateRouteHtml"""
        body = {"routeName": route_name, "routeDescription": route_description, "options": options}
        return self._call_fn("generateRouteHtml", body)

    def detect_emergency(self, text: str = "", message: str = "", **extra) -> dict:
        """紧急检测：detectEmergency"""
        return self._call_fn("detectEmergency", {"text": text, "message": message, **extra})

    def generate_svg(
        self,
        waypoints: list | None = None,
        route_id: str = "",
        route_name: str = "",
        version: str = "standard",
        static_map_url: str = "",
        boundary_polygons: list | None = None,
    ) -> dict:
        """SVG生成：generateSvg"""
        body = {
            "waypoints": waypoints or [],
            "routeId": route_id,
            "routeName": route_name,
            "version": version,
            "staticMapUrl": static_map_url,
            "boundaryPolygons": boundary_polygons or [],
        }
        return self._call_fn("generateSvg", body)

    def fetch_district_boundary(self, destination: str = "", route_name: str = "") -> dict:
        """区域边界：fetchDistrictBoundary"""
        return self._call_fn("fetchDistrictBoundary", {"destination": destination, "routeName": route_name})

    def run_local_skill(self, message: str = "", context: dict | None = None, **extra) -> dict:
        """本地技能运行：runLocalSkill"""
        body = {"message": message, "context": context or {}, **extra}
        return self._call_fn("runLocalSkill", {"request": body})

    def make_template_from_html(self, html: str = "", template_id: str = "", layout: str = "card", description: str = "") -> dict:
        """模板制作：makeTemplateFromHtml"""
        return self._call_fn("makeTemplateFromHtml", {
            "html": html, "id": template_id, "layout": layout, "description": description,
        })

    def to_template_id(self, filename: str = "") -> dict:
        """文件名→模板ID：toTemplateId"""
        return self._call_fn("toTemplateId", {"filename": filename})

    def card_needs_iframe_isolation(self, html: str = "") -> dict:
        """iframe 隔离判定：cardNeedsIframeIsolation"""
        return self._call_fn("cardNeedsIframeIsolation", {"html": html})

    def build_html_fallback(self, page_html: str = "") -> dict:
        """HTML 降级包装：buildHtmlFallback"""
        return self._call_fn("buildHtmlFallback", {"pageHtml": page_html})

    def render_template_card_result(self, template_dir: str = "", model_result: dict | None = None, **extra) -> dict:
        """完整模板渲染：renderTemplateCardResult"""
        body = {"templateDir": template_dir, "modelResult": model_result or {}, **extra}
        return self._call_fn("renderTemplateCardResult", body)

    # ── FlyAI 服务桥 ─────────────────────────────────────────────

    def flyai_keyword_search(self, query: str = "", api_key: str = "", timeout_ms: int = 120000) -> dict:
        """flyai 关键词搜索"""
        body = {"query": query, "timeoutMs": timeout_ms}
        if api_key:
            body["apiKey"] = api_key
        return self._call_fn("flyaiKeywordSearch", body)

    def flyai_ai_search(self, query: str = "", api_key: str = "", timeout_ms: int = 120000) -> dict:
        """flyai AI 搜索"""
        body = {"query": query, "timeoutMs": timeout_ms}
        if api_key:
            body["apiKey"] = api_key
        return self._call_fn("flyaiAiSearch", body)

    def flyai_search_poi(self, keyword: str = "", city_name: str = "", api_key: str = "", timeout_ms: int = 120000) -> dict:
        """flyai POI 搜索"""
        body = {"keyword": keyword, "cityName": city_name, "timeoutMs": timeout_ms}
        if api_key:
            body["apiKey"] = api_key
        return self._call_fn("flyaiSearchPoi", body)

    def normalize_flyai_doc(self, input_data: dict | None = None, **extra) -> dict:
        """flyai 文档归一化"""
        body = input_data or {}
        body.update(extra)
        return self._call_fn("normalizeFlyaiDoc", body)

    def flyai_kb_upsert_doc(self, doc: dict, base_dir: str = "") -> dict:
        """flyai KB 写入文档"""
        body = {"doc": doc}
        if base_dir:
            body["baseDir"] = base_dir
        return self._call_fn("flyaiKbUpsertDoc", body)

    def flyai_kb_list_docs(self, base_dir: str = "") -> list:
        """flyai KB 列出所有文档"""
        body = {"baseDir": base_dir} if base_dir else {}
        return self._call_fn("flyaiKbListDocs", body)

    def flyai_kb_get_by_route_id(self, route_id: str, base_dir: str = "") -> dict | None:
        """flyai KB 按 routeId 查询"""
        body = {"id": route_id}
        if base_dir:
            body["baseDir"] = base_dir
        return self._call_fn("flyaiKbGetByRouteId", body)

    def flyai_kb_get_by_keyword(self, keyword: str, base_dir: str = "") -> list:
        """flyai KB 按关键词查询"""
        body = {"keyword": keyword}
        if base_dir:
            body["baseDir"] = base_dir
        return self._call_fn("flyaiKbGetByKeyword", body)

    # ── JTD 金跳动服务桥 ─────────────────────────────────────────

    def jtd_is_configured(self, config: dict | None = None) -> dict:
        """jtd 客户端配置检查"""
        return self._call_fn("jtdIsConfigured", {"config": config or {}})

    def jtd_search_products(self, query: dict | None = None, config: dict | None = None) -> dict:
        """jtd 产品搜索"""
        return self._call_fn("jtdSearchProducts", {"query": query or {}, "config": config or {}})

    def jtd_product_detail(self, product_id: str, sku_id: str = "", extra: dict | None = None, config: dict | None = None) -> dict:
        """jtd 产品详情"""
        return self._call_fn("jtdProductDetail", {
            "productId": product_id, "skuId": sku_id, "extra": extra or {}, "config": config or {},
        })

    def jtd_check_availability(self, payload: dict | None = None, config: dict | None = None) -> dict:
        """jtd 可订校验"""
        return self._call_fn("jtdCheckAvailability", {"payload": payload or {}, "config": config or {}})

    def jtd_build_route_product_context(self, request: dict | None = None, options: dict | None = None) -> dict:
        """jtd 旅居服务完整链路：buildRouteProductContext"""
        return self._call_fn("jtdBuildRouteProductContext", {
            "request": request or {}, "options": options or {},
        })

    # ── trace-logger（查询追踪日志） ─────────────────────────────
    def trace_logger_write(self, entry: dict | None = None) -> dict:
        """写入一条 trace 日志"""
        return self._call_fn("traceLoggerWrite", {"entry": entry or {}})

    def trace_logger_list(self, limit: int = 500) -> dict:
        """读取 trace 日志（倒序，最新在前）"""
        return self._call_fn("traceLoggerList", {"options": {"limit": limit}})

    def trace_logger_clear(self) -> dict:
        """清空 trace 日志"""
        return self._call_fn("traceLoggerClear", {})

    def trace_logger_path(self) -> dict:
        """获取 trace 日志文件路径"""
        return self._call_fn("traceLoggerPath", {})

    # ── 地图艺术底图 ─────────────────────────────────────────────
    def tencent_build_static_map_url(
        self,
        center: dict | None = None,
        markers: list | None = None,
        options: dict | None = None,
        adapter_config: dict | None = None,
    ) -> dict:
        """腾讯地图静态图URL：TencentMapAdapter.buildStaticMapUrl"""
        return self._call_fn("tencentBuildStaticMapUrl", {
            "center": center or {},
            "markers": markers or [],
            "options": options or {},
            "adapterConfig": adapter_config or {},
        })

    def build_route_map_art_background(
        self,
        route_id: str = "",
        route_name: str = "",
        destination: str = "",
        waypoints: list | None = None,
        center_lat: float | None = None,
        center_lng: float | None = None,
        zoom: int = 10,
        size: str = "800*840",
        enable_ai: bool | None = None,
        prefer_model: str | None = None,
        adapter_config: dict | None = None,
    ) -> dict:
        """路线艺术底图：buildRouteMapArtBackground（桥内部提供下载和静态图URL实现）"""
        body: dict[str, Any] = {
            "routeId": route_id,
            "routeName": route_name,
            "destination": destination,
            "waypoints": waypoints or [],
            "zoom": zoom,
            "size": size,
            "adapterConfig": adapter_config or {},
        }
        if center_lat is not None:
            body["centerLat"] = center_lat
        if center_lng is not None:
            body["centerLng"] = center_lng
        if enable_ai is not None:
            body["enableAi"] = enable_ai
        if prefer_model:
            body["preferModel"] = prefer_model
        return self._call_fn("buildRouteMapArtBackground", body)

    # ── H5 嵌入卡 / 周边资源 / 嘉路数据 ──────────────────────────
    def fill_travel_h5_embed_card(self, message: str = "", business_data: dict | None = None) -> dict:
        """H5 嵌入卡：fillTravelH5EmbedCard"""
        return self._call_fn("fillTravelH5EmbedCard", {
            "message": message,
            "business_data": business_data or {},
        })

    def search_category(
        self,
        category: str = "",
        center: dict | None = None,
        timeout_ms: int = 3000,
        options: dict | None = None,
    ) -> dict:
        """Tavily 分类搜索：searchCategory(category, center, timeoutMs, options)"""
        return self._call_fn("searchCategory", {
            "category": category,
            "center": center or {},
            "timeoutMs": timeout_ms,
            "options": options or {},
        })

    def get_jialu_facilities(
        self,
        type: str = "",
        max_distance: float | None = None,
        limit: int = 0,
    ) -> list[dict]:
        """嘉路康养设施列表：getJialuFacilities"""
        body: dict[str, Any] = {"type": type, "limit": limit}
        if max_distance is not None:
            body["maxDistance"] = max_distance
        result = self._call_fn("getJialuFacilities", body)
        return result.get("items", []) if isinstance(result, dict) else (result or [])

    def get_jialu_center(self) -> dict:
        """嘉路康养中心：getJialuCenter"""
        return self._call_fn("getJialuCenter", {})

    def enrich_waypoints_from_dashboard_kb(self, waypoints: list | None = None) -> list[dict]:
        """看板景点图富化：enrichWaypointsFromDashboardKb"""
        result = self._call_fn("enrichWaypointsFromDashboardKb", {"waypoints": waypoints or []})
        return result.get("waypoints", []) if isinstance(result, dict) else (result or [])

    # ── tag-system ───────────────────────────────────────────────
    def humanize_intent_label(self, intent_desc: str = "") -> str:
        """LIS 意图标签清洗：humanizeIntentLabel"""
        result = self._call_fn("humanizeIntentLabel", {"intentDesc": intent_desc})
        return result.get("label", "") if isinstance(result, dict) else str(result or "")

    def tag_system_adapter(self, method: str, args: list | None = None, config: dict | None = None) -> Any:
        """tag-system 适配器方法调用。method ∈ isConfigured|health|getEntityProfile|listEntityTags"""
        result = self._call_fn("tagSystemAdapter", {
            "method": method,
            "args": args or [],
            "config": config or {},
        })
        return result.get("result") if isinstance(result, dict) else result

    def tag_system_biz(self, method: str, args: list | None = None, pg_url: str = "") -> Any:
        """tag-system 业务层方法调用。method ∈ resolveEntityNames|getEvaluationRecords|query"""
        body: dict[str, Any] = {"method": method, "args": args or []}
        if pg_url:
            body["pgUrl"] = pg_url
        result = self._call_fn("tagSystemBiz", body)
        return result.get("result") if isinstance(result, dict) else result


# ── CLI 自检 ──────────────────────────────────────────────────
if __name__ == "__main__":
    client = FlatTalkClient()
    print("=== flatTalk Python 客户端自检 ===")
    print(f"base_url: {client.base_url}")

    print("\n1) 健康检查...")
    health = client.health()
    print(json.dumps(health, ensure_ascii=False, indent=2))

    print("\n2) 可用函数桥端点...")
    endpoints = client.list_endpoints()
    for ep in endpoints:
        print(f"  {ep['method']} {ep['path']}")

    if endpoints:
        print(f"\n共 {len(endpoints)} 个函数桥可用 ✓")
    else:
        print("\n⚠ 未获取到端点列表（服务未启动或非开发模式？）")
