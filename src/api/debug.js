// /api/debug/* 调试端点：运行状态 + 日志 + 内部函数桥（供 Python 脚本通过 HTTP 调用）。
//
// 安全策略：函数桥端点（/api/debug/fn/*）仅在非生产模式放行；
// 生产模式（runtimeMode === 'production' || 'prod'）返回 403。
// status / logs / logs/clear 三个原有端点保持不变，所有模式可用。
//
// 函数桥使用动态 import，避免在启动时加载重量级模块（model-service、mapstudio 等）。

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB

// ── 工具：读取 JSON 请求体（与 app.js readJson 同模式） ─────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        rejected = true;
        reject(new Error('request_body_too_large'));
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

// ── 工具：非生产模式守卫 ────────────────────────────────────────────
function isDevMode(env) {
  const mode = env?.runtimeMode || 'local';
  return mode !== 'production' && mode !== 'prod';
}

// ── 函数桥端点表 ────────────────────────────────────────────────────
// 每个条目：{ path, method, handler(env, body) => result }
// handler 内部用动态 import 按需加载模块。
const FUNCTION_BRIDGES = [
  // 模板填槽：fillTemplateSlots({ message, template_id, template_library, ... })
  {
    path: '/api/debug/fn/fillTemplateSlots',
    method: 'POST',
    handler: async (_env, body) => {
      const { fillTemplateSlots } = await import('../core/model-service.js');
      return await fillTemplateSlots(body || {});
    },
  },
  // 场景识别：identifyScene({ text, message, ... })
  {
    path: '/api/debug/fn/identifyScene',
    method: 'POST',
    handler: async (_env, body) => {
      const { identifyScene } = await import('../core/scene-router/index.js');
      return identifyScene(body || {}, body?.options || {});
    },
  },
  // 模板渲染：renderCard({ dir, json, options })
  {
    path: '/api/debug/fn/renderCard',
    method: 'POST',
    handler: async (_env, body) => {
      const { renderCard } = await import('../template-card/index.js');
      return renderCard(body?.dir || './cards', body?.json || {}, body?.options || {});
    },
  },
  // 模板发现：discoverTemplates({ dir, raw })
  // raw=true 返回完整模板对象（含 description）；默认经 describeLibrary 精简为 {id,layout,match}
  {
    path: '/api/debug/fn/discoverTemplates',
    method: 'POST',
    handler: async (_env, body) => {
      const { discoverTemplates, describeLibrary } = await import('../template-card/discover.js');
      const templates = discoverTemplates(body?.dir || './cards');
      return body?.raw ? templates : describeLibrary(templates);
    },
  },
  // 模板预览：renderPreview({ dir, templateId })
  {
    path: '/api/debug/fn/renderPreview',
    method: 'POST',
    handler: async (_env, body) => {
      const { renderPreview } = await import('../template-card/index.js');
      return { html: renderPreview(body?.dir || './cards', body?.templateId || '') };
    },
  },
  // 动作分发：dispatchAction({ action_key, params, ... })
  {
    path: '/api/debug/fn/dispatchAction',
    method: 'POST',
    handler: async (_env, body) => {
      const { dispatchAction } = await import('../core/actions/action-dispatcher.js');
      // JS 回调无法经 JSON 传入：captureRunSkill=true 时由桥层合成一个
      // runSkill 处理器，把 envelope 原样回传，供 Python 侧断言。
      const handlers = { ...(body?.handlers || {}) };
      let captured = null;
      if (body?.captureRunSkill) {
        handlers.runSkill = async (envelope) => {
          captured = envelope;
          return envelope;
        };
      }
      const result = await dispatchAction(body?.request || body || {}, handlers);
      if (body?.captureRunSkill) {
        return { ...(result || {}), envelope: captured ?? result?.envelope ?? null };
      }
      return result;
    },
  },
  // 动作→模板ID：templateIdFromAction(actionKey, params)
  {
    path: '/api/debug/fn/templateIdFromAction',
    method: 'POST',
    handler: async (_env, body) => {
      const { templateIdFromAction } = await import('../core/actions/action-dispatcher.js');
      return { template_id: templateIdFromAction(body?.actionKey || body?.action_key, body?.params || {}) };
    },
  },
  // 路线HTML生成：generateRouteHtml(routeName, routeDescription, options)
  {
    path: '/api/debug/fn/generateRouteHtml',
    method: 'POST',
    handler: async (_env, body) => {
      const { generateRouteHtml } = await import('../core/route-svg-generator.js');
      return await generateRouteHtml(body?.routeName || '', body?.routeDescription || '', body?.options || {});
    },
  },
  // 紧急检测：detectEmergency({ text, message, ... })
  {
    path: '/api/debug/fn/detectEmergency',
    method: 'POST',
    handler: async (_env, body) => {
      const { detectEmergency } = await import('../core/intent-classifier/emergency-detector.js');
      return detectEmergency(body || {});
    },
  },
  // SVG生成：generateSvg(waypoints, routeId, routeName, version, staticMapUrl, boundaryPolygons)
  {
    path: '/api/debug/fn/generateSvg',
    method: 'POST',
    handler: async (_env, body) => {
      const { generateSvg } = await import('../admin/mapstudio.js');
      return {
        svg: generateSvg(
          body?.waypoints || [],
          body?.routeId || '',
          body?.routeName || '',
          body?.version || 'standard',
          body?.staticMapUrl || '',
          body?.boundaryPolygons || [],
        ),
      };
    },
  },
  // 区域边界：fetchDistrictBoundary(destination, routeName)
  {
    path: '/api/debug/fn/fetchDistrictBoundary',
    method: 'POST',
    handler: async (_env, body) => {
      const { fetchDistrictBoundary } = await import('../admin/mapstudio.js');
      return await fetchDistrictBoundary(body?.destination || '', body?.routeName || '');
    },
  },
  // 本地技能运行：runLocalSkill({ message, context, ... })
  {
    path: '/api/debug/fn/runLocalSkill',
    method: 'POST',
    handler: async (_env, body) => {
      const { runLocalSkill } = await import('../runtime/local-skill-runtime.js');
      return await runLocalSkill(body?.request || body || {}, body?.options || {});
    },
  },
  // 模板制作：makeTemplateFromHtml(html, { id, layout, description })
  {
    path: '/api/debug/fn/makeTemplateFromHtml',
    method: 'POST',
    handler: async (_env, body) => {
      const { makeTemplateFromHtml } = await import('../template-card/make-template.js');
      return makeTemplateFromHtml(body?.html || '', {
        id: body?.id || '',
        layout: body?.layout || 'card',
        description: body?.description || '',
      });
    },
  },
  // 文件名→模板ID：toTemplateId(filename)
  {
    path: '/api/debug/fn/toTemplateId',
    method: 'POST',
    handler: async (_env, body) => {
      const { toTemplateId } = await import('../template-card/make-template.js');
      return { template_id: toTemplateId(body?.filename || '') };
    },
  },
  // iframe 隔离判定：cardNeedsIframeIsolation(html)
  {
    path: '/api/debug/fn/cardNeedsIframeIsolation',
    method: 'POST',
    handler: async (_env, body) => {
      const { cardNeedsIframeIsolation } = await import('../core/render/template-card-renderer.js');
      return { needs_isolation: cardNeedsIframeIsolation(body?.html || '') };
    },
  },
  // HTML 降级包装：buildHtmlFallback(pageHtml)
  {
    path: '/api/debug/fn/buildHtmlFallback',
    method: 'POST',
    handler: async (_env, body) => {
      const { buildHtmlFallback } = await import('../core/render/template-card-renderer.js');
      return { html: buildHtmlFallback(body?.pageHtml || '') };
    },
  },
  // 完整模板渲染：renderTemplateCardResult({ templateDir, modelResult, ... })
  {
    path: '/api/debug/fn/renderTemplateCardResult',
    method: 'POST',
    handler: async (_env, body) => {
      const { renderTemplateCardResult } = await import('../core/render/template-card-renderer.js');
      return renderTemplateCardResult(body || {});
    },
  },
  // ── FlyAI 服务桥 ──────────────────────────────────────────────
  // flyai 关键词搜索：flyaiKeywordSearch({ query, apiKey?, timeoutMs? })
  {
    path: '/api/debug/fn/flyaiKeywordSearch',
    method: 'POST',
    handler: async (_env, body) => {
      const { createFlyaiClient } = await import('../services/flyai/flyai-client.js');
      const client = createFlyaiClient({
        apiKey: body?.apiKey || process.env.FLYAI_API_KEY || '',
        timeoutMs: body?.timeoutMs || 120000,
      });
      return client.keywordSearch(body?.query || '');
    },
  },
  // flyai AI 搜索：flyaiAiSearch({ query, apiKey?, timeoutMs? })
  {
    path: '/api/debug/fn/flyaiAiSearch',
    method: 'POST',
    handler: async (_env, body) => {
      const { createFlyaiClient } = await import('../services/flyai/flyai-client.js');
      const client = createFlyaiClient({
        apiKey: body?.apiKey || process.env.FLYAI_API_KEY || '',
        timeoutMs: body?.timeoutMs || 120000,
      });
      return client.aiSearch(body?.query || '');
    },
  },
  // flyai POI 搜索：flyaiSearchPoi({ keyword, cityName?, apiKey?, timeoutMs? })
  {
    path: '/api/debug/fn/flyaiSearchPoi',
    method: 'POST',
    handler: async (_env, body) => {
      const { createFlyaiClient } = await import('../services/flyai/flyai-client.js');
      const client = createFlyaiClient({
        apiKey: body?.apiKey || process.env.FLYAI_API_KEY || '',
        timeoutMs: body?.timeoutMs || 120000,
      });
      return client.searchPoi({ keyword: body?.keyword || '', cityName: body?.cityName || '' });
    },
  },
  // flyai 文档归一化：normalizeFlyaiDoc({ linked_route_id, query, aiMarkdown, poiList, products, keywords })
  {
    path: '/api/debug/fn/normalizeFlyaiDoc',
    method: 'POST',
    handler: async (_env, body) => {
      const { normalizeFlyaiDoc } = await import('../services/flyai/normalize-flyai-doc.js');
      return normalizeFlyaiDoc(body?.input || body || {});
    },
  },
  // flyai KB 写入：flyaiKbUpsertDoc({ doc, baseDir? })
  {
    path: '/api/debug/fn/flyaiKbUpsertDoc',
    method: 'POST',
    handler: async (_env, body) => {
      const { createFlyaiKbStore } = await import('../services/flyai/flyai-kb-store.js');
      const store = createFlyaiKbStore(body?.baseDir ? { baseDir: body.baseDir } : {});
      return store.upsertDoc(body?.doc || {});
    },
  },
  // flyai KB 列表：flyaiKbListDocs({ baseDir? })
  {
    path: '/api/debug/fn/flyaiKbListDocs',
    method: 'POST',
    handler: async (_env, body) => {
      const { createFlyaiKbStore } = await import('../services/flyai/flyai-kb-store.js');
      const store = createFlyaiKbStore(body?.baseDir ? { baseDir: body.baseDir } : {});
      return store.listDocs();
    },
  },
  // flyai KB 按 routeId 查询：flyaiKbGetByRouteId({ id, baseDir? })
  {
    path: '/api/debug/fn/flyaiKbGetByRouteId',
    method: 'POST',
    handler: async (_env, body) => {
      const { createFlyaiKbStore } = await import('../services/flyai/flyai-kb-store.js');
      const store = createFlyaiKbStore(body?.baseDir ? { baseDir: body.baseDir } : {});
      return store.getByRouteId(body?.id || '');
    },
  },
  // flyai KB 按关键词查询：flyaiKbGetByKeyword({ keyword, baseDir? })
  {
    path: '/api/debug/fn/flyaiKbGetByKeyword',
    method: 'POST',
    handler: async (_env, body) => {
      const { createFlyaiKbStore } = await import('../services/flyai/flyai-kb-store.js');
      const store = createFlyaiKbStore(body?.baseDir ? { baseDir: body.baseDir } : {});
      return store.getByKeyword(body?.keyword || '');
    },
  },
  // ── JTD 金跳动服务桥 ──────────────────────────────────────────
  // jtd 客户端配置检查：jtdIsConfigured({ config? })
  {
    path: '/api/debug/fn/jtdIsConfigured',
    method: 'POST',
    handler: async (_env, body) => {
      const { createJtdClient } = await import('../services/travel/jtd-client.js');
      const client = createJtdClient(body?.config || {});
      return { configured: client.isConfigured(), config: client.config };
    },
  },
  // jtd 产品搜索：jtdSearchProducts({ query, config? })
  {
    path: '/api/debug/fn/jtdSearchProducts',
    method: 'POST',
    handler: async (_env, body) => {
      const { createJtdClient } = await import('../services/travel/jtd-client.js');
      const client = createJtdClient(body?.config || {});
      return client.searchProducts(body?.query || {});
    },
  },
  // jtd 产品详情：jtdProductDetail({ productId, skuId?, extra?, config? })
  {
    path: '/api/debug/fn/jtdProductDetail',
    method: 'POST',
    handler: async (_env, body) => {
      const { createJtdClient } = await import('../services/travel/jtd-client.js');
      const client = createJtdClient(body?.config || {});
      return client.productDetail(body?.productId || '', body?.skuId || '', body?.extra || {});
    },
  },
  // jtd 可订校验：jtdCheckAvailability({ payload, config? })
  {
    path: '/api/debug/fn/jtdCheckAvailability',
    method: 'POST',
    handler: async (_env, body) => {
      const { createJtdClient } = await import('../services/travel/jtd-client.js');
      const client = createJtdClient(body?.config || {});
      return client.checkAvailability(body?.payload || {});
    },
  },
  // jtd 旅居服务完整链路：jtdBuildRouteProductContext({ request, options? })
  {
    path: '/api/debug/fn/jtdBuildRouteProductContext',
    method: 'POST',
    handler: async (_env, body) => {
      const { createJtdTravelService } = await import('../services/travel/jtd-service.js');
      const service = createJtdTravelService(body?.options || {});
      return service.buildRouteProductContext(body?.request || {});
    },
  },
  // 跟踪日志写入：traceLoggerWrite({ entry })
  {
    path: '/api/debug/fn/traceLoggerWrite',
    method: 'POST',
    handler: async (_env, body) => {
      const { getTraceLogger } = await import('../core/observability/trace-logger.js');
      getTraceLogger().write(body?.entry || {});
      return { ok: true };
    },
  },
  // 跟踪日志列表：traceLoggerList({ limit? })
  {
    path: '/api/debug/fn/traceLoggerList',
    method: 'POST',
    handler: async (_env, body) => {
      const { getTraceLogger, TRACE_LOG } = await import('../core/observability/trace-logger.js');
      return {
        items: getTraceLogger().list(body?.options || {}),
        log_path: TRACE_LOG,
      };
    },
  },
  // 跟踪日志清空：traceLoggerClear()
  {
    path: '/api/debug/fn/traceLoggerClear',
    method: 'POST',
    handler: async () => {
      const { getTraceLogger } = await import('../core/observability/trace-logger.js');
      getTraceLogger().clear();
      return { ok: true };
    },
  },
  // 跟踪日志路径：traceLoggerPath()
  {
    path: '/api/debug/fn/traceLoggerPath',
    method: 'POST',
    handler: async () => {
      const { TRACE_LOG } = await import('../core/observability/trace-logger.js');
      return { log_path: TRACE_LOG };
    },
  },
  // 腾讯地图静态图URL：tencentBuildStaticMapUrl({ center, markers, options })
  {
    path: '/api/debug/fn/tencentBuildStaticMapUrl',
    method: 'POST',
    handler: async (_env, body) => {
      const { TencentMapAdapter } = await import('../services/map/tencent-map-adapter.js');
      const adapter = new TencentMapAdapter(body?.adapterConfig || {});
      return {
        url: adapter.buildStaticMapUrl(
          body?.center || {},
          body?.markers || [],
          body?.options || {},
        ),
      };
    },
  },
  // 路线艺术底图：buildRouteMapArtBackground({ routeId, routeName, destination, waypoints, centerLat, centerLng, zoom, size, enableAi, preferModel })
  // 桥内部提供默认的 downloadImageAsBase64 和 buildStaticMapUrl 实现，Python 无需传回调。
  {
    path: '/api/debug/fn/buildRouteMapArtBackground',
    method: 'POST',
    handler: async (_env, body) => {
      const { buildRouteMapArtBackground } = await import('../core/map/route-map-art.js');
      const { TencentMapAdapter } = await import('../services/map/tencent-map-adapter.js');
      const https = (await import('node:https')).default;
      const http = (await import('node:http')).default;

      // 默认图片下载实现（Node 内部使用）
      const downloadImageAsBase64 = (url, timeoutMs = 15000) => new Promise((resolve) => {
        try {
          const client = String(url || '').startsWith('https') ? https : http;
          const req = client.get(url, { timeout: timeoutMs }, (resp) => {
            if (resp.statusCode !== 200) { resolve(null); return; }
            const chunks = [];
            resp.on('data', (c) => chunks.push(c));
            resp.on('end', () => {
              const buf = Buffer.concat(chunks);
              const mime = resp.headers['content-type'] || 'image/png';
              if (String(mime).includes('json') || buf.slice(0, 1).toString() === '{') {
                resolve(null);
                return;
              }
              resolve(`data:${mime};base64,${buf.toString('base64')}`);
            });
          });
          req.on('error', () => resolve(null));
          req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch {
          resolve(null);
        }
      });

      const adapter = new TencentMapAdapter(body?.adapterConfig || {});
      const buildStaticMapUrl = (center, markers, options) => adapter.buildStaticMapUrl(center, markers, options);

      const result = await buildRouteMapArtBackground({
        routeId: body?.routeId || '',
        routeName: body?.routeName || '',
        destination: body?.destination || '',
        waypoints: body?.waypoints || [],
        centerLat: body?.centerLat,
        centerLng: body?.centerLng,
        zoom: body?.zoom ?? 10,
        size: body?.size || '800*840',
        enableAi: body?.enableAi ?? (String(process.env.FLATTALK_ROUTE_MAP_AI || '1') !== '0'),
        preferModel: body?.preferModel,
        downloadImageAsBase64,
        buildStaticMapUrl,
      });
      return result;
    },
  },
  // H5 嵌入卡：fillTravelH5EmbedCard({ message, business_data })
  {
    path: '/api/debug/fn/fillTravelH5EmbedCard',
    method: 'POST',
    handler: async (_env, body) => {
      const { fillTravelH5EmbedCard } = await import('../core/model-service/travel-cards.js');
      return fillTravelH5EmbedCard({
        message: body?.message || '',
        business_data: body?.business_data || {},
      });
    },
  },
  // Tavily 分类搜索：searchCategory(category, center, timeoutMs, options)
  {
    path: '/api/debug/fn/searchCategory',
    method: 'POST',
    handler: async (_env, body) => {
      const { searchCategory } = await import('../services/nearby-resource/tavily-nearby-adapter.js');
      return await searchCategory(
        body?.category || '',
        body?.center || {},
        body?.timeoutMs ?? 3000,
        body?.options || {},
      );
    },
  },
  // 嘉路康养设施：getJialuFacilities({ type, maxDistance, limit })
  {
    path: '/api/debug/fn/getJialuFacilities',
    method: 'POST',
    handler: async (_env, body) => {
      const { getJialuFacilities } = await import('../data/jialu_kangyang_center/index.js');
      const args = { type: body?.type || '', limit: body?.limit ?? 0 };
      if (body?.maxDistance !== undefined) args.maxDistance = body.maxDistance;
      return { items: getJialuFacilities(args) };
    },
  },
  // 嘉路康养中心：getJialuCenter()
  {
    path: '/api/debug/fn/getJialuCenter',
    method: 'POST',
    handler: async () => {
      const { getJialuCenter } = await import('../data/jialu_kangyang_center/index.js');
      return getJialuCenter();
    },
  },
  // 看板景点图富化：enrichWaypointsFromDashboardKb(waypoints)
  {
    path: '/api/debug/fn/enrichWaypointsFromDashboardKb',
    method: 'POST',
    handler: async (_env, body) => {
      const { enrichWaypointsFromDashboardKb } = await import('../skills/travel_route/dashboard-spot-kb.js');
      return { waypoints: enrichWaypointsFromDashboardKb(body?.waypoints || []) };
    },
  },
  // LIS 意图标签清洗：humanizeIntentLabel(intentDesc)
  {
    path: '/api/debug/fn/humanizeIntentLabel',
    method: 'POST',
    handler: async (_env, body) => {
      const { humanizeIntentLabel } = await import('../core/lis/matcher.js');
      return { label: humanizeIntentLabel(body?.intentDesc ?? '') };
    },
  },
  // tag-system 适配器：tagSystemAdapter({ method, args, config })
  // method ∈ isConfigured | health | getEntityProfile | listEntityTags
  {
    path: '/api/debug/fn/tagSystemAdapter',
    method: 'POST',
    handler: async (_env, body) => {
      const { createTagSystemAdapter } = await import('../services/interface-data/tag-system-adapter.js');
      const adapter = createTagSystemAdapter(body?.config || {});
      const method = String(body?.method || '');
      const args = Array.isArray(body?.args) ? body.args : [];
      if (typeof adapter[method] !== 'function') {
        throw new Error(`unsupported_tag_system_adapter_method: ${method}`);
      }
      const result = await adapter[method](...args);
      return { method, result };
    },
  },
  // ── map-kit / map-helpers ─────────────────────────────────────
  // 路线地图数据：buildRouteMapData({ destination, waypoints, spots, routeId, version, utterance })
  {
    path: '/api/debug/fn/buildRouteMapData',
    method: 'POST',
    handler: async (_env, body) => {
      const { buildRouteMapData } = await import('../core/map/map-kit.js');
      return buildRouteMapData(body || {});
    },
  },
  // 基地地图数据：buildBaseMapData({ destination, bases })
  {
    path: '/api/debug/fn/buildBaseMapData',
    method: 'POST',
    handler: async (_env, body) => {
      const { buildBaseMapData } = await import('../core/map/map-kit.js');
      return buildBaseMapData(body || {});
    },
  },
  // POI 地图数据：buildPoiMapData({ center, pois, radiusKm })
  {
    path: '/api/debug/fn/buildPoiMapData',
    method: 'POST',
    handler: async (_env, body) => {
      const { buildPoiMapData } = await import('../core/map/map-kit.js');
      return buildPoiMapData(body || {});
    },
  },
  // 坐标点清洗：sanitizePoints(points)
  {
    path: '/api/debug/fn/sanitizePoints',
    method: 'POST',
    handler: async (_env, body) => {
      const { sanitizePoints } = await import('../core/map/map-kit.js');
      // 直接返回数组，与 JS 返回值形状一致
      return sanitizePoints(body?.points || []);
    },
  },
  // 预制包查找：findPrebuiltPackageByDestination(destination, version)
  {
    path: '/api/debug/fn/findPrebuiltPackageByDestination',
    method: 'POST',
    handler: async (_env, body) => {
      const { findPrebuiltPackageByDestination } = await import('../core/map/map-kit.js');
      return findPrebuiltPackageByDestination(body?.destination || '', body?.version || 'standard');
    },
  },
  // 地图画布 HTML：mapCanvasHtml({ canvasId, height, legend, mapData })
  {
    path: '/api/debug/fn/mapCanvasHtml',
    method: 'POST',
    handler: async (_env, body) => {
      const { mapCanvasHtml } = await import('../core/map/map-helpers.js');
      return { html: mapCanvasHtml(body || {}) };
    },
  },
  // 路线图例 HTML：routeLegendHtml()
  {
    path: '/api/debug/fn/routeLegendHtml',
    method: 'POST',
    handler: async () => {
      const { routeLegendHtml } = await import('../core/map/map-helpers.js');
      return { html: routeLegendHtml() };
    },
  },
  // POI 图例 HTML：poiLegendHtml()
  {
    path: '/api/debug/fn/poiLegendHtml',
    method: 'POST',
    handler: async () => {
      const { poiLegendHtml } = await import('../core/map/map-helpers.js');
      return { html: poiLegendHtml() };
    },
  },
  // ── model-runtime ─────────────────────────────────────────────
  // 选择对话模型：pickChatModel({ registryPath, modelId, purpose })
  {
    path: '/api/debug/fn/pickChatModel',
    method: 'POST',
    handler: async (_env, body) => {
      const { pickChatModel } = await import('../core/model-runtime/model-registry.js');
      return pickChatModel(body || {});
    },
  },
  // 模型公开名：publicModelName(model)
  {
    path: '/api/debug/fn/publicModelName',
    method: 'POST',
    handler: async (_env, body) => {
      const { publicModelName } = await import('../core/model-runtime/model-registry.js');
      return { name: publicModelName(body?.model || {}) };
    },
  },
  // OpenAI 兼容模型调用：callOpenAiCompatibleModel(model, messages, options)
  {
    path: '/api/debug/fn/callOpenAiCompatibleModel',
    method: 'POST',
    handler: async (_env, body) => {
      const { callOpenAiCompatibleModel } = await import('../core/model-runtime/openai-compatible-client.js');
      return await callOpenAiCompatibleModel(
        body?.model || {},
        body?.messages || [],
        body?.options || {},
      );
    },
  },
  // ── travel / local-routes ─────────────────────────────────────
  // 本地路线匹配：matchLocalRoutes(message, productDomain)
  {
    path: '/api/debug/fn/matchLocalRoutes',
    method: 'POST',
    handler: async (_env, body) => {
      const { matchLocalRoutes } = await import('../services/travel/local-routes.js');
      // 直接返回数组，与 JS 返回值形状一致
      return matchLocalRoutes(body?.message || '', body?.productDomain || '');
    },
  },
  // 本地路线上下文：buildLocalRouteContext(message, productDomain)
  {
    path: '/api/debug/fn/buildLocalRouteContext',
    method: 'POST',
    handler: async (_env, body) => {
      const { buildLocalRouteContext } = await import('../services/travel/local-routes.js');
      return await buildLocalRouteContext(body?.message || '', body?.productDomain || 'sojourn_route');
    },
  },
  // JTD 搜索结果归一：normalizeSearchRecords(apiResult)
  {
    path: '/api/debug/fn/normalizeSearchRecords',
    method: 'POST',
    handler: async (_env, body) => {
      const { normalizeSearchRecords } = await import('../services/travel/jtd-service.js');
      return { records: normalizeSearchRecords(body?.apiResult || {}) };
    },
  },
  // ── route-svg-generator ───────────────────────────────────────
  // 产品模板选择：selectProductTemplate(routeName, description)
  {
    path: '/api/debug/fn/selectProductTemplate',
    method: 'POST',
    handler: async (_env, body) => {
      const { selectProductTemplate } = await import('../core/route-svg-generator.js');
      // 直接返回模板对象（与 loadProductSample 保持一致），未匹配时返回 {}
      return selectProductTemplate(body?.routeName || '', body?.description || '') || {};
    },
  },
  // 产品样例加载：loadProductSample(productId)
  {
    path: '/api/debug/fn/loadProductSample',
    method: 'POST',
    handler: async (_env, body) => {
      const { loadProductSample } = await import('../core/route-svg-generator.js');
      return loadProductSample(body?.productId || '') || {};
    },
  },
  // ── actions ───────────────────────────────────────────────────
  // 动作分类：classifyAction(actionKey)
  {
    path: '/api/debug/fn/classifyAction',
    method: 'POST',
    handler: async (_env, body) => {
      const { classifyAction } = await import('../core/actions/action-dispatcher.js');
      return { action_type: classifyAction(body?.actionKey ?? body?.action_key ?? '') };
    },
  },
  // ── nearby-resource ───────────────────────────────────────────
  // 周边资源富化：enrich(facilities, center, intent, options)
  {
    path: '/api/debug/fn/nearbyEnrich',
    method: 'POST',
    handler: async (_env, body) => {
      const { enrich } = await import('../services/nearby-resource/nearby-augmentor.js');
      return await enrich(
        body?.facilities || [],
        body?.center || {},
        body?.intent || 'all',
        body?.options || {},
      );
    },
  },
  // 清空周边富化缓存：clearCache()（注意：清模块级共享缓存，影响所有请求）
  {
    path: '/api/debug/fn/nearbyClearCache',
    method: 'POST',
    handler: async () => {
      const { clearCache } = await import('../services/nearby-resource/nearby-augmentor.js');
      clearCache();
      return { ok: true };
    },
  },
  // ── weather ───────────────────────────────────────────────────
  // 腾讯天气查询：createTencentWeatherAdapter(options).getWeather(city, { days })
  {
    path: '/api/debug/fn/tencentGetWeather',
    method: 'POST',
    handler: async (_env, body) => {
      const { createTencentWeatherAdapter } = await import('../services/weather/tencent-weather.js');
      const adapter = createTencentWeatherAdapter(body?.options || {});
      return await adapter.getWeather(body?.city || '', { days: body?.days ?? 5 });
    },
  },
  // 天气风险填槽（同步、旧名兼容）：fillTravelWeatherRisk({ city, weather, business_data, all_cities })
  {
    path: '/api/debug/fn/fillTravelWeatherRisk',
    method: 'POST',
    handler: async (_env, body) => {
      const { fillTravelWeatherRisk } = await import('../core/model-service/travel-cards.js');
      // 该函数无 = {} 默认值，必须保证传入对象
      return fillTravelWeatherRisk({
        city: body?.city,
        weather: body?.weather,
        business_data: body?.business_data,
        all_cities: body?.all_cities,
      });
    },
  },
  // 天气风险卡：fillTravelWeatherRiskCard({ message, business_data })
  // weatherService 无法跨 HTTP 注入，未显式禁用时由桥内构造腾讯适配器补齐
  {
    path: '/api/debug/fn/fillTravelWeatherRiskCard',
    method: 'POST',
    handler: async (_env, body) => {
      const { fillTravelWeatherRiskCard } = await import('../core/model-service/travel-cards.js');
      let weatherService = null;
      if (body?.useWeatherService !== false) {
        const { createTencentWeatherAdapter } = await import('../services/weather/tencent-weather.js');
        weatherService = createTencentWeatherAdapter(body?.weatherOptions || {});
      }
      return await fillTravelWeatherRiskCard({
        message: body?.message || '',
        business_data: body?.business_data || {},
        weatherService,
      });
    },
  },
  // ── orchestrator ──────────────────────────────────────────────
  // 对话编排：createChatOrchestrator(options).run(request)
  // dataService/weatherService 无法跨 HTTP 注入，按开关在桥内构造
  {
    path: '/api/debug/fn/chatOrchestratorRun',
    method: 'POST',
    handler: async (_env, body) => {
      const { createChatOrchestrator } = await import('../core/orchestrator/chat-orchestrator.js');
      const options = { ...(body?.options || {}) };
      if (body?.withDataService) {
        const { createDataService } = await import('../services/data-service.js');
        options.dataService = createDataService(body?.dataServiceOptions || {});
      }
      if (body?.withWeatherService) {
        const { createTencentWeatherAdapter } = await import('../services/weather/tencent-weather.js');
        options.weatherService = createTencentWeatherAdapter(body?.weatherOptions || {});
      }
      const orchestrator = createChatOrchestrator(options);
      return await orchestrator.run(body?.request || {});
    },
  },
  // 数据服务探活：createDataService(options) — 返回可用子服务清单（子服务对象无法 JSON 序列化）
  {
    path: '/api/debug/fn/createDataService',
    method: 'POST',
    handler: async (_env, body) => {
      const { createDataService } = await import('../services/data-service.js');
      const svc = createDataService(body?.options || {});
      const shape = {};
      for (const [key, value] of Object.entries(svc || {})) {
        shape[key] = value && typeof value === 'object'
          ? Object.keys(value).filter((k) => typeof value[k] === 'function')
          : typeof value;
      }
      return { ok: true, services: Object.keys(svc || {}), shape };
    },
  },
  // tag-system 业务层：tagSystemBiz({ method, args, pgUrl })
  // method ∈ resolveEntityNames | getEvaluationRecords | query
  {
    path: '/api/debug/fn/tagSystemBiz',
    method: 'POST',
    handler: async (_env, body) => {
      const { getTagSystemBiz } = await import('../services/interface-data/tag-system-biz.js');
      // 注意：getTagSystemBiz 接收 pgUrl 字符串，传对象会导致 pg Pool 报 str.charAt 错误
      const biz = getTagSystemBiz(body?.pgUrl || undefined);
      const method = String(body?.method || '');
      const args = Array.isArray(body?.args) ? body.args : [];
      if (typeof biz[method] !== 'function') {
        throw new Error(`unsupported_tag_system_biz_method: ${method}`);
      }
      const result = await biz[method](...args);
      return { method, result };
    },
  },
];

// ── 主处理器 ────────────────────────────────────────────────────────
export async function handleDebugApi(req, res, url, { logger, chatState, env, json }) {
  // 原有端点：status / logs / logs/clear（所有模式可用）
  if (req.method === 'GET' && url.pathname === '/api/debug/status') {
    return json(res, 200, {
      ok: true,
      runtime_mode: env.runtimeMode || 'local',
      state_store: chatState.stateStore.source,
      running_count: chatState.running.size,
      log_path: logger.logPath,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/debug/logs') {
    const limit = Number(url.searchParams.get('limit') || 200);
    return json(res, 200, { ok: true, items: logger.list({ limit }) });
  }

  if (req.method === 'POST' && url.pathname === '/api/debug/logs/clear') {
    logger.clear();
    return json(res, 200, { ok: true });
  }

  // 函数桥端点列表（GET，供 Python 客户端自省）
  if (req.method === 'GET' && url.pathname === '/api/debug/fn') {
    return json(res, 200, {
      ok: true,
      endpoints: FUNCTION_BRIDGES.map((b) => ({ path: b.path, method: b.method })),
    });
  }

  // 函数桥端点：仅非生产模式放行
  const bridge = FUNCTION_BRIDGES.find((b) => b.path === url.pathname && b.method === req.method);
  if (bridge) {
    if (!isDevMode(env)) {
      return json(res, 403, { ok: false, error: 'function_bridge_disabled_in_production' });
    }
    try {
      const body = await parseBody(req);
      const result = await bridge.handler(env, body);
      return json(res, 200, { ok: true, result });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message, stack: err.stack?.split('\n').slice(0, 5) });
    }
  }

  return json(res, 404, { ok: false, error: 'debug_route_not_found' });
}
