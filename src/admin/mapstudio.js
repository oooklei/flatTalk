/**
 * 地图SVG制作工坊 — 后端API + 数据采集流水线
 *
 * API路由（挂载在 /api/admin/mapstudio/ 下）：
 *   GET    /routes                  → 可制作的线路列表
 *   GET    /data/:routeId           → 线路waypoints数据
 *   POST   /pipeline                → 一键执行数据采集流水线
 *   POST   /save                    → 保存SVG+行程数据
 *   GET    /list                    → 已保存的资源包清单
 *   GET    /package/:routeId        → 获取资源包完整数据
 *   DELETE /package/:routeId        → 删除资源包
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { json, readJsonSafe } from './util.js';
import { TencentMapAdapter } from '../services/map/tencent-map-adapter.js';
import { searchCategory } from '../services/nearby-resource/tavily-nearby-adapter.js';
import { toSimplified, toSimplifiedDeep } from '../core/utils/simplified-chinese.js';
import { generateRouteHtml } from '../core/route-svg-generator.js';
import { lookupDashboardSpotImages } from '../skills/travel_route/dashboard-spot-kb.js';

const ROOT = process.cwd();
const MAPS_DIR = path.join(ROOT, 'data', 'sojourn-maps');
const ROUTES_FILE = path.join(ROOT, 'data', 'fangchenggang-routes.json');

// ============================================================
// 版本样式预设
// ============================================================
const VERSION_PRESETS = {
  standard: {
    viewBox: { width: 400, height: 420 },
    markerRadius: 14,
    markerFontSize: 11,
    labelFontSize: 9,
    pathWidth: 3,
    legendFontSize: 9,
    bgColor: '#F8FAFB',
    maxMarkers: 20,
  },
  elder: {
    viewBox: { width: 400, height: 480 },
    markerRadius: 20,
    markerFontSize: 16,
    labelFontSize: 13,
    pathWidth: 5,
    legendFontSize: 13,
    bgColor: '#FFFFFF',
    maxMarkers: 6,
  },
};

const TYPE_COLORS = {
  base: '#2E7D32', arrival: '#2E7D32',
  spot: '#FF7826', wellness: '#1976D2', departure: '#D32F2F',
};
const TYPE_LABELS = {
  base: '基', arrival: '抵',
  spot: '景', wellness: '养', departure: '返',
};

// ============================================================
// 路由分发
// ============================================================
export async function handleMapStudioApi(req, res, method, parts) {
  const [action] = parts;

  if (action === 'routes' && method === 'GET') return handleListRoutes(res);
  if (action === 'data' && method === 'GET' && parts[1]) return handleRouteData(res, parts[1]);
  if (action === 'pipeline' && method === 'POST') return handlePipeline(req, res);
  if (action === 'save' && method === 'POST') return handleSave(req, res);
  if (action === 'publish' && method === 'POST') return handlePublish(req, res);
  if (action === 'list' && method === 'GET') return handleList(res);
  if (action === 'package' && method === 'GET' && parts[1]) return handleGetPackage(res, parts[1]);
  if (action === 'package' && method === 'DELETE' && parts[1]) return handleDeletePackage(res, parts[1]);
  if (action === 'file' && method === 'GET' && parts[1] && parts[2]) return handleGetFile(res, parts[1], parts[2]);
  if (action === 'generate' && method === 'POST') return handleGenerate(req, res);

  return json(res, 404, { ok: false, error: 'unknown_mapstudio_action' });
}

// ============================================================
// 工具：下载图片并转 base64
// ============================================================
function downloadImageAsBase64(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (resp) => {
      if (resp.statusCode !== 200) { resolve(null); return; }
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = resp.headers['content-type'] || 'image/png';
        resolve(`data:${mime};base64,${buf.toString('base64')}`);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ============================================================
// 线路数据读取
// ============================================================
function loadRoutes() {
  try { return JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8')); }
  catch { return []; }
}

function handleListRoutes(res) {
  const routes = loadRoutes();
  const list = routes.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    destination: r.destination,
    waypoint_count: (r.waypoints || []).length,
    tags: r.tags || [],
  }));
  return json(res, 200, { ok: true, routes: list });
}

function handleRouteData(res, routeId) {
  const routes = loadRoutes();
  const route = routes.find((r) => r.product_id === routeId);
  if (!route) return json(res, 404, { ok: false, error: 'route_not_found' });
  return json(res, 200, {
    ok: true,
    route: {
      product_id: route.product_id,
      product_name: route.product_name,
      destination: route.destination,
      waypoints: route.waypoints || [],
      highlights: route.highlights || [],
    },
  });
}

// ============================================================
// 数据采集流水线
// ============================================================

/**
 * 为每个景点调用腾讯地图POI搜索获取精确坐标+地址
 */
async function enrichWithMapPoi(waypoints, destination) {
  const map = new TencentMapAdapter();
  const results = await Promise.all(
    waypoints.map(async (wp) => {
      if (wp.type === 'base' || wp.type === 'arrival') return wp;
      try {
        const keyword = `${destination} ${wp.name}`;
        const pois = await map.searchNearby(keyword, wp.lat, wp.lng, 5000, 1);
        if (pois && pois.length > 0 && pois[0].location) {
          return {
            ...wp,
            lat: pois[0].location.lat,
            lng: pois[0].location.lng,
            address: toSimplified(pois[0].address || ''),
            tel: pois[0].tel || '',
            poi_verified: true,
          };
        }
      } catch (e) {
        // POI 搜索失败时用原始坐标
      }
      return wp;
    })
  );
  return results;
}

/**
 * 调用腾讯地图驾车路径规划获取真实道路折线
 */
async function fetchPolyline(waypoints) {
  const map = new TencentMapAdapter();
  if (waypoints.length < 2) return [];
  try {
    const from = { lat: waypoints[0].lat, lng: waypoints[0].lng };
    const to = {
      lat: waypoints[waypoints.length - 1].lat,
      lng: waypoints[waypoints.length - 1].lng,
    };
    const viaPoints = waypoints
      .slice(1, -1)
      .map((wp) => `${wp.lat},${wp.lng}`)
      .join(';');

    const result = await map.routePlanning(from, to, viaPoints);
    if (result && result.paths && result.paths.length > 0) {
      // 提取折线坐标
      const coords = [];
      const steps = result.paths[0].steps || [];
      for (const step of steps) {
        const polyline = step.polyline || '';
        for (const pair of polyline.split(';')) {
          const [latStr, lngStr] = pair.split(',');
          const lat = parseFloat(latStr);
          const lng = parseFloat(lngStr);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            coords.push({ lat, lng });
          }
        }
      }
      return coords;
    }
  } catch (e) {
    // 路径规划失败用直线
  }
  // 降级：直线连接
  return waypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng }));
}

/**
 * 为每个端点/景点补描述+图片。
 * 默认只读 flatTalk-dashboard 本地知识库（49 端点），不消耗 Tavily 日额度。
 * 仅当 SPOT_IMAGES_TAVILY=1 且本地未命中时才回退 Tavily。
 */
async function enrichWithTavily(waypoints, destination) {
  const allowTavily = String(process.env.SPOT_IMAGES_TAVILY || '').trim() === '1';
  const results = await Promise.all(
    waypoints.map(async (wp) => {
      if (wp.type === 'departure') {
        return { ...wp, spots: [], spot_images: [], spot_desc: wp.spot_desc || '' };
      }

      const local = lookupDashboardSpotImages(wp.name)
        || lookupDashboardSpotImages(`${destination || ''}${wp.name || ''}`)
        || lookupDashboardSpotImages(destination);
      if (local?.spot_images?.length) {
        return {
          ...wp,
          spots: (local.related_spots || []).slice(0, 3).map((s) => ({
            name: toSimplified(s.name || ''),
            desc: toSimplified(s.address || s.category || ''),
          })),
          spot_images: local.spot_images,
          spot_desc: toSimplified(wp.spot_desc || local.spot_desc || ''),
          spot_status: local.image_source || 'dashboard_local_kb',
        };
      }

      if (!allowTavily) {
        return {
          ...wp,
          spots: [],
          spot_images: Array.isArray(wp.spot_images) ? wp.spot_images : [],
          spot_desc: wp.spot_desc || '',
          spot_status: 'local_kb_miss',
        };
      }

      try {
        const isEndpoint = wp.type === 'base' || wp.type === 'arrival';
        const searchName = isEndpoint ? destination : `${destination} ${wp.name}`;
        const center = { name: searchName, lat: wp.lat, lng: wp.lng };
        const tavilyResult = await searchCategory('spot', center, 8000);
        const spots = (tavilyResult.source_results || [])
          .slice(0, 3)
          .map((s) => ({
            name: toSimplified(s.title || ''),
            desc: toSimplified((s.content || '').slice(0, 160)),
          }))
          .filter((s) => s.name && s.name.length >= 2);
        const images = (tavilyResult.images || []).slice(0, 3);
        const descMaxLen = isEndpoint ? 240 : 160;
        const enrichDesc = tavilyResult.description
          ? toSimplified(tavilyResult.description.slice(0, descMaxLen))
          : '';
        return {
          ...wp,
          spots,
          spot_images: images,
          spot_desc: enrichDesc,
          spot_status: spots.length > 0 || images.length > 0 ? 'enriched' : 'empty',
        };
      } catch {
        return { ...wp, spots: [], spot_images: [], spot_status: 'failed' };
      }
    })
  );
  return results;
}

// ============================================================
// 行政区边界获取（双源：腾讯API → 本地GeoJSON备用）
// ============================================================

/**
 * 获取行政区边界多边形
 * 源1：腾讯地图 district API（GCJ-02）
 * 源2：本地 GeoJSON 文件（阿里DataV下载，同为 GCJ-02）
 * @param {string} destination - 目的地名称（如"巴马"、"防城港"）
 * @returns {Promise<{polygons: Array<Array<{lat,lng}>>, source: string, name: string}>}
 */
/**
 * 目的地名称到本地GeoJSON文件名的映射（Docker环境中文文件名可能有问题）
 */
const DESTINATION_GEOJSON_MAP = {
  '巴马': ['bama', 'bama_boundary'],
  '防城港': ['fcg', 'fcg_boundary', 'fangchenggang'],
  '北海': ['beihai', 'beihai_boundary'],
  '东兴': ['dongxing', 'dx_boundary'],
};

async function fetchDistrictBoundary(destination) {
  // 源1：腾讯地图行政区API
  try {
    const map = new TencentMapAdapter();
    const result = await map.getDistrictBoundary(destination, 'district');
    if (result.ok && result.polygons && result.polygons.length > 0) {
      return { polygons: result.polygons, source: 'tencent', name: result.name || destination };
    }
  } catch (e) {
    // 腾讯API失败，尝试本地GeoJSON
  }

  // 源2：本地GeoJSON（阿里DataV下载，坐标同为GCJ-02）
  try {
    const geoDir = path.join(ROOT, 'geographicSVG');
    if (fs.existsSync(geoDir)) {
      // 构建搜索关键词列表（中文 + ASCII映射）
      const searchKeys = [destination];
      const mapped = DESTINATION_GEOJSON_MAP[destination];
      if (mapped) searchKeys.push(...mapped);

      const files = fs.readdirSync(geoDir).filter((f) => f.endsWith('.geojson'));
      for (const file of files) {
        const lower = file.toLowerCase();
        const matched = searchKeys.some((k) => {
          const lk = k.toLowerCase().replace(/边界|县|市/g, '');
          return lower.includes(lk) || lk.includes(lower.replace('.geojson', '').replace(/边界|县|市/g, ''));
        });
        if (!matched) continue;
        const geojson = JSON.parse(fs.readFileSync(path.join(geoDir, file), 'utf8'));
        const features = geojson.features || [];
        if (features.length > 0) {
          const geom = features[0].geometry || {};
          const coords = geom.coordinates || [];
          const gtype = geom.type;
          // 严格按 GeoJSON 规范解析 Polygon / MultiPolygon
          // Polygon:    coords = [ring, ring, ...]            ring = [[lng,lat], ...]
          // MultiPolygon: coords = [poly, poly, ...]          poly = [ring, ring, ...]
          // 每个 polygon 取第一个（外）环，忽略孔洞
          const polygons = [];
          const parseRing = (ring) => {
            if (!Array.isArray(ring)) return null;
            return ring
              .filter((pt) => Array.isArray(pt) && pt.length >= 2)
              .map(([lng, lat]) => ({ lat, lng }));
          };
          if (gtype === 'Polygon') {
            const outer = parseRing(coords[0]);
            if (outer && outer.length > 2) polygons.push(outer);
          } else if (gtype === 'MultiPolygon') {
            for (const poly of coords) {
              if (!Array.isArray(poly) || poly.length === 0) continue;
              const outer = parseRing(poly[0]);
              if (outer && outer.length > 2) polygons.push(outer);
            }
          }
          if (polygons.length > 0) {
            return { polygons, source: 'datav_local', name: features[0].properties?.name || destination };
          }
        }
      }
    }
  } catch (e) {
    // 本地GeoJSON也失败
  }

  return { polygons: [], source: 'none', name: destination };
}

/**
 * 扩展经纬度边界框以包含多边形坐标
 */
function expandBoundsWithBoundary(bounds, polygons) {
  if (!polygons || polygons.length === 0) return bounds;
  const ex = { ...bounds };
  for (const polygon of polygons) {
    for (const pt of polygon) {
      if (Number.isFinite(pt.lat) && Number.isFinite(pt.lng)) {
        if (pt.lat < ex.minLat) ex.minLat = pt.lat;
        if (pt.lat > ex.maxLat) ex.maxLat = pt.lat;
        if (pt.lng < ex.minLng) ex.minLng = pt.lng;
        if (pt.lng > ex.maxLng) ex.maxLng = pt.lng;
      }
    }
  }
  return ex;
}

/**
 * 将边界多边形投影到SVG坐标，返回SVG path d 字符串数组
 */
function projectBoundaryToSvg(polygons, bounds, vb, region) {
  if (!polygons || polygons.length === 0) return [];
  return polygons.map((polygon) => {
    const pts = polygon
      .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng))
      .map((pt) => projectLatLng(pt.lat, pt.lng, bounds, vb, region));
    if (pts.length < 3) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  }).filter((d) => d);
}

/**
 * 一键数据采集流水线
 */
async function handlePipeline(req, res) {
  const body = await readJsonSafe(req, res);
  if (!body) return;
  const { route_id } = body;
  if (!route_id) return json(res, 400, { ok: false, error: 'route_id_required' });

  const routes = loadRoutes();
  const route = routes.find((r) => r.product_id === route_id);
  if (!route) return json(res, 404, { ok: false, error: 'route_not_found' });

  const originalWaypoints = route.waypoints || [];
  if (originalWaypoints.length === 0) {
    return json(res, 400, { ok: false, error: 'no_waypoints' });
  }

  // ★ 主路径：使用 generateRouteHtml 封装函数（纯矢量SVG + 模板渲染）
  try {
    const description = route.summary || route.product_name || '';
    const result = await generateRouteHtml(
      toSimplified(route.product_name),
      description,
      {
        waypoints: originalWaypoints,
        destination: toSimplified(route.destination),
        routeId: route_id,
        version: 'standard',
        season: toSimplified(route.season || '四季皆宜'),
        budgetLevel: toSimplified(route.budget_level || '经济舒适'),
        suitable: toSimplified(route.suitable_for || '中老年康养'),
        highlights: (route.highlights || []).map(toSimplified),
        itinerary: (route.itinerary || []).map(toSimplifiedDeep),
        healthNotice: toSimplified(route.health_notice || ''),
      }
    );

    // 同时生成适老版 SVG
    const elderResult = await generateRouteHtml(
      toSimplified(route.product_name),
      description,
      {
        waypoints: originalWaypoints,
        destination: toSimplified(route.destination),
        routeId: route_id,
        version: 'elder',
        season: toSimplified(route.season || '四季皆宜'),
        budgetLevel: toSimplified(route.budget_level || '经济舒适'),
        suitable: toSimplified(route.suitable_for || '中老年康养'),
        highlights: (route.highlights || []).map(toSimplified),
        itinerary: (route.itinerary || []).map(toSimplifiedDeep),
        healthNotice: toSimplified(route.health_notice || ''),
      }
    );

    const stats = {
      poi_count: 0,
      tavily_count: 0,
      polyline_points: 0,
      boundary_source: 'datav_local',
      boundary_polygons: 0,
      generator: 'route_svg_generator',
      warnings: result.warnings,
    };

    return json(res, 200, {
      ok: true,
      route_data: result.routeData,
      svg_standard: result.svg,
      svg_elder: elderResult.svg,
      html_preview: result.html,
      stats,
    });
  } catch (genError) {
    // ★ 降级路径：generateRouteHtml 失败时，回退到原流水线
    console.error('[mapstudio] generateRouteHtml failed, fallback to legacy pipeline:', genError.message);
  }

  // 降级：原流水线（含腾讯API+Tavily+静态底图下载）
  return handlePipelineLegacy(req, res, body, route, originalWaypoints);
}

/**
 * 原流水线（降级方案）— 含腾讯POI搜索+驾车路径+静态底图下载
 * 当 generateRouteHtml 失败时使用
 */
async function handlePipelineLegacy(req, res, body, route, originalWaypoints) {
  const { route_id } = body;
  const stats = { poi_count: 0, tavily_count: 0, polyline_points: 0, boundary_source: 'none', generator: 'legacy' };

  // 步骤1：腾讯地图 POI 搜索（修正坐标）
  const poiEnriched = await enrichWithMapPoi(originalWaypoints, route.destination);
  stats.poi_count = poiEnriched.filter((w) => w.poi_verified).length;

  // 步骤2：驾车路径规划（真实走线）
  const polyline = await fetchPolyline(poiEnriched);
  stats.polyline_points = polyline.length;

  // 步骤2.5：行政区边界获取（双源：腾讯API → 本地GeoJSON）
  const boundaryResult = await fetchDistrictBoundary(route.destination);
  stats.boundary_source = boundaryResult.source;
  stats.boundary_polygons = boundaryResult.polygons.length;

  // 步骤3：Tavily 景点描述+图片
  const tavilyEnriched = await enrichWithTavily(poiEnriched, route.destination);
  stats.tavily_count = tavilyEnriched.filter((w) => w.spots && w.spots.length > 0).length;

  // 步骤4：简体中文转换（全局保障）
  const cleanedWaypoints = tavilyEnriched.map((wp) => ({
    ...toSimplifiedDeep({
      id: wp.id || `wp${Math.random().toString(36).slice(2, 7)}`,
      name: wp.name,
      type: wp.type || 'spot',
      day: wp.day || '',
      plan: wp.plan || '',
      lat: wp.lat,
      lng: wp.lng,
      address: wp.address || '',
      tel: wp.tel || '',
      spots: wp.spots || [],
      spot_images: wp.spot_images || [],
      spot_desc: wp.spot_desc || '',
    }),
    lat: wp.lat, // 数值不被转换
    lng: wp.lng,
  }));

  // 步骤5：组装 route_data.json
  const routeData = {
    route_id,
    route_name: toSimplified(route.product_name),
    version: '1.0',
    generated_at: new Date().toISOString(),
    data_sources: {
      map: 'tencent_map_poi',
      spots: 'tavily_search',
      route: 'tencent_driving',
    },
    destination: toSimplified(route.destination),
    days: route.days || originalWaypoints.length,
    summary: toSimplified(route.summary || ''),
    highlights: (route.highlights || []).map(toSimplified),
    suitable_for: toSimplified(route.suitable_for || ''),
    waypoints: cleanedWaypoints,
    polyline_path: polyline.map((p) => [p.lng, p.lat]),
    itinerary: (route.itinerary || []).map(toSimplifiedDeep),
    tags: (route.tags || []).map(toSimplified),
  };

  // 步骤5.5：生成腾讯静态地图底图（高分辨率下载→base64嵌入SVG）
  // ★ 使用扩展边界（waypoints + 行政区边界）来计算中心点和缩放
  const mapAdapter = new TencentMapAdapter();
  const wpBounds = calcBounds(cleanedWaypoints);
  const bounds = expandBoundsWithBoundary(wpBounds, boundaryResult.polygons);
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  // 根据经纬度跨度估算缩放级别
  const latSpan = bounds.maxLat - bounds.minLat;
  const lngSpan = bounds.maxLng - bounds.minLng;
  const maxSpan = Math.max(latSpan, lngSpan);
  let zoom = 11;
  if (maxSpan > 1.5) zoom = 8;
  else if (maxSpan > 0.8) zoom = 9;
  else if (maxSpan > 0.4) zoom = 10;
  else if (maxSpan > 0.15) zoom = 11;
  else if (maxSpan > 0.06) zoom = 12;
  else zoom = 13;

  // 请求高清静态图（2倍分辨率，腾讯最大支持 1200*960）
  let staticMapB64Standard = '';
  let staticMapB64Elder = '';
  try {
    const urlStd = mapAdapter.buildStaticMapUrl(
      { lat: centerLat, lng: centerLng }, [], { zoom, size: '800*840' }
    );
    const urlElder = mapAdapter.buildStaticMapUrl(
      { lat: centerLat, lng: centerLng }, [], { zoom, size: '800*960' }
    );
    // 并发下载两张高清底图
    const [b64Std, b64Elder] = await Promise.all([
      downloadImageAsBase64(urlStd, 12000),
      downloadImageAsBase64(urlElder, 12000),
    ]);
    staticMapB64Standard = b64Std || '';
    staticMapB64Elder = b64Elder || '';
  } catch (e) {
    // 静态图下载失败不影响SVG生成（无底图）
  }

  // 步骤6：生成两种版本的 SVG（含高清底图 + 行政区边界）
  const svgStandard = generateSvg(cleanedWaypoints, route_id, route.product_name, 'standard', staticMapB64Standard, boundaryResult.polygons);
  const svgElder = generateSvg(cleanedWaypoints, route_id, route.product_name, 'elder', staticMapB64Elder, boundaryResult.polygons);

  return json(res, 200, {
    ok: true,
    route_data: routeData,
    svg_standard: svgStandard,
    svg_elder: svgElder,
    stats,
  });
}

// ============================================================
// SVG 自动生成
// ============================================================

function projectLatLng(lat, lng, bounds, vb, region) {
  const lngRange = bounds.maxLng - bounds.minLng || 0.01;
  const latRange = bounds.maxLat - bounds.minLat || 0.01;
  // 支持投影到子区域（region 提供 {x,y,width,height}），默认投影到整个 viewBox
  if (region && Number.isFinite(region.x) && Number.isFinite(region.width)) {
    const padX = Math.min(40, region.width * 0.06);
    const padY = Math.min(40, region.height * 0.06);
    const x = region.x + padX + ((lng - bounds.minLng) / lngRange) * (region.width - 2 * padX);
    const y = region.y + padY + ((bounds.maxLat - lat) / latRange) * (region.height - 2 * padY);
    return { x: Math.round(x), y: Math.round(y) };
  }
  const x = ((lng - bounds.minLng) / lngRange) * (vb.width - 60) + 30;
  const y = ((bounds.maxLat - lat) / latRange) * (vb.height - 80) + 30;
  return { x: Math.round(x), y: Math.round(y) };
}

function calcBounds(waypoints, paddingRatio = 0.15) {
  const lats = waypoints.map((w) => w.lat);
  const lngs = waypoints.map((w) => w.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padLat = (maxLat - minLat) * paddingRatio || 0.01;
  const padLng = (maxLng - minLng) * paddingRatio || 0.01;
  return {
    minLat: minLat - padLat, maxLat: maxLat + padLat,
    minLng: minLng - padLng, maxLng: maxLng + padLng,
  };
}

function resolveOverlaps(markers, minDist = 44) {
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < markers.length; i++) {
      for (let j = i + 1; j < markers.length; j++) {
        const dx = markers[j].x - markers[i].x;
        const dy = markers[j].y - markers[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist && dist > 0) {
          const angle = Math.atan2(dy, dx);
          const push = (minDist - dist) / 2;
          markers[j].x += Math.round(Math.cos(angle) * push);
          markers[j].y += Math.round(Math.sin(angle) * push);
          markers[i].x -= Math.round(Math.cos(angle) * push);
          markers[i].y -= Math.round(Math.sin(angle) * push);
        }
      }
    }
  }
  return markers;
}

function escXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function shortName(name, maxLen = 6) {
  if (!name) return '';
  return name.length > maxLen ? name.slice(0, maxLen) + '…' : name;
}

export function generateSvg(waypoints, routeId, routeName, version = 'standard', staticMapUrl = '', boundaryPolygons = []) {
  // staticMapUrl 参数保留以向后兼容，但不再使用（已切换为纯矢量SVG，无光栅底图）
  void staticMapUrl;
  const preset = VERSION_PRESETS[version] || VERSION_PRESETS.standard;
  // 卡片常见展示宽 ~360px，相对 620 viewBox 约 0.58×；再放大 2 倍保证可读
  const fontScale = version === 'elder' ? 4.2 : 3.5;
  const markerScale = version === 'elder' ? 2.2 : 1.9;

  // 固定卡片尺寸 620×850（不再从 preset.viewBox 取）
  const VB_W = 620, VB_H = 850;
  // 地图子区域：x=10,y=68 开始的 600×460 区域
  const MAP_X = 10, MAP_Y = 68, MAP_W = 600, MAP_H = 460;
  const mapRegion = { x: MAP_X, y: MAP_Y, width: MAP_W, height: MAP_H };
  const vb = { width: VB_W, height: VB_H };

  const routeNameSim = toSimplified(routeName);

  // 适老版限制标点数
  let wps = [...waypoints];
  if (version === 'elder' && wps.length > preset.maxMarkers) {
    const bases = wps.filter((w) => w.type === 'base' || w.type === 'arrival');
    const others = wps.filter((w) => w.type !== 'base' && w.type !== 'arrival');
    wps = [...bases, ...others].slice(0, preset.maxMarkers);
  }

  // ★ 计算扩展边界（waypoints + 行政区边界）确保边界完整可见
  const wpBounds = calcBounds(wps);
  const bounds = expandBoundsWithBoundary(wpBounds, boundaryPolygons);

  // ★ 投影到地图子区域（非整个 viewBox）
  let markers = wps.map((wp, i) => {
    const pos = projectLatLng(wp.lat, wp.lng, bounds, vb, mapRegion);
    return { ...wp, id: `m${i + 1}`, x: pos.x, y: pos.y, type: wp.type || 'spot' };
  });
  markers = resolveOverlaps(markers, version === 'elder' ? 52 : 40);

  // ★ 将行政区边界投影到地图子区域
  const boundaryPaths = projectBoundaryToSvg(boundaryPolygons, bounds, vb, mapRegion);

  // ★ 走线路径分段：识别最后一段是否为返程
  // 返程判定：最后一个点是 base/departure，且倒数第二个点不是 base/arrival/departure
  const n = markers.length;
  let splitIdx = n;
  if (n >= 2) {
    const last = markers[n - 1];
    const prev = markers[n - 2];
    if ((last.type === 'departure' || last.type === 'base') &&
        prev.type !== 'base' && prev.type !== 'arrival' && prev.type !== 'departure') {
      splitIdx = n - 1;
    }
  }
  const fwdPath = markers.slice(0, splitIdx)
    .map((m, i) => `${i === 0 ? 'M' : 'L'} ${m.x} ${m.y}`).join(' ');
  let retPath = '';
  if (splitIdx < n) {
    // 返程段从倒数第二个点开始连接到最后一个点
    retPath = markers.slice(splitIdx - 1)
      .map((m, i) => `${i === 0 ? 'M' : 'L'} ${m.x} ${m.y}`).join(' ');
  }

  // 康养特色信息：拼接 waypoints 中的 spot_desc
  const descs = wps
    .map((w) => toSimplified(w.spot_desc || ''))
    .filter((s) => s && s.length > 4);
  const wellnessText = descs.length > 0
    ? descs.slice(0, 3).join(' · ').slice(0, 90)
    : toSimplified('康养旅居 · 慢节奏 · 自然疗愈');

  // 辅助：从 waypoint 提取全部景点图片URL（逗号分隔，支持多图轮播）
  const pickImgs = (wp) => {
    if (!Array.isArray(wp.spot_images) || wp.spot_images.length === 0) return '';
    return wp.spot_images.map((img) => {
      if (typeof img === 'string') return img;
      return (img && (img.url || img.src)) || '';
    }).filter(Boolean).join(',');
  };

  // ============================================================
  // 构建 SVG
  // ============================================================
  const parts = [];

  parts.push(
    `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg"` +
    ` data-route-id="${escXml(routeId)}" data-version="${escXml(version)}"` +
    ` data-route-name="${escXml(routeNameSim)}"` +
    ` data-center-lat="${((bounds.minLat + bounds.maxLat) / 2).toFixed(4)}"` +
    ` data-center-lng="${((bounds.minLng + bounds.maxLng) / 2).toFixed(4)}"` +
    ` style="width:100%;max-width:${VB_W}px;background:linear-gradient(180deg,#F5F0E8 0%,#E8F4E8 100%);border-radius:16px;font-family:'PingFang SC','Microsoft YaHei',sans-serif">`
  );

  // ===== defs 定义 =====
  parts.push('<defs>');
  parts.push(
    '<linearGradient id="boundaryGrad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#E8F5E9" stop-opacity="0.95"/>' +
    '<stop offset="100%" stop-color="#C8E6C9" stop-opacity="0.8"/></linearGradient>'
  );
  parts.push(
    '<linearGradient id="riverGrad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#64B5F6" stop-opacity="0.7"/>' +
    '<stop offset="100%" stop-color="#1976D2" stop-opacity="0.5"/></linearGradient>'
  );
  parts.push(
    '<linearGradient id="hillGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#81C784" stop-opacity="0.5"/>' +
    '<stop offset="100%" stop-color="#388E3C" stop-opacity="0.3"/></linearGradient>'
  );
  parts.push(
    '<linearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#FF7826"/>' +
    '<stop offset="100%" stop-color="#E65100"/></linearGradient>'
  );
  parts.push(
    '<filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" ' +
    'flood-color="#000" flood-opacity="0.15"/></filter>'
  );
  parts.push('</defs>');

  // ===== Hero 标题栏 (y=0-58) =====
  parts.push(`<rect x="0" y="0" width="${VB_W}" height="58" rx="16" fill="url(#heroGrad)"/>`);
  parts.push(
    `<text x="18" y="36" fill="#fff" font-size="${Math.round(22 * fontScale)}" ` +
    `font-weight="bold">${escXml(shortName(routeNameSim, 20))}</text>`
  );
  parts.push(
    `<text x="18" y="51" fill="rgba(255,255,255,0.75)" ` +
    `font-size="${Math.round(11 * fontScale)}">康养旅居 · 精品路线</text>`
  );

  // ===== 地理地图区域背景 (y=68-528) =====
  parts.push(
    `<rect x="${MAP_X}" y="${MAP_Y}" width="${MAP_W}" height="${MAP_H}" rx="12" ` +
    `fill="#F8F8F0" stroke="#DDD" stroke-width="0.5"/>`
  );

  // ===== 装饰性山脉（边缘半透明三角形/贝塞尔） =====
  parts.push('<g class="mountains" opacity="0.55">');
  // 左上山脉
  parts.push(
    `<path d="M${MAP_X + 8},${MAP_Y + 70} Q${MAP_X + 28},${MAP_Y + 18} ${MAP_X + 48},${MAP_Y + 70} ` +
    `Q${MAP_X + 70},${MAP_Y + 12} ${MAP_X + 92},${MAP_Y + 70} ` +
    `Q${MAP_X + 115},${MAP_Y + 22} ${MAP_X + 138},${MAP_Y + 70}" ` +
    `fill="url(#hillGrad)" stroke="#4CAF50" stroke-width="0.5"/>`
  );
  // 右上山脉
  parts.push(
    `<path d="M${MAP_X + MAP_W - 140},${MAP_Y + 55} ` +
    `Q${MAP_X + MAP_W - 115},${MAP_Y + 6} ${MAP_X + MAP_W - 88},${MAP_Y + 55} ` +
    `Q${MAP_X + MAP_W - 62},${MAP_Y + 2} ${MAP_X + MAP_W - 32},${MAP_Y + 55}" ` +
    `fill="url(#hillGrad)" stroke="#4CAF50" stroke-width="0.5"/>`
  );
  // 底部山脉
  parts.push(
    `<path d="M${MAP_X + MAP_W * 0.45},${MAP_Y + MAP_H - 18} ` +
    `Q${MAP_X + MAP_W * 0.58},${MAP_Y + MAP_H - 58} ${MAP_X + MAP_W * 0.72},${MAP_Y + MAP_H - 18} ` +
    `Q${MAP_X + MAP_W * 0.85},${MAP_Y + MAP_H - 62} ${MAP_X + MAP_W - 5},${MAP_Y + MAP_H - 18}" ` +
    `fill="url(#hillGrad)" stroke="#4CAF50" stroke-width="0.5"/>`
  );
  parts.push(
    `<text x="${MAP_X + 70}" y="${MAP_Y + 88}" fill="#2E7D32" ` +
    `font-size="${Math.round(10 * fontScale)}" opacity="0.55" font-style="italic">山区</text>`
  );
  parts.push('</g>');

  // ===== 行政区边界（从 boundaryPolygons 投影） =====
  if (boundaryPaths.length > 0) {
    parts.push('<g class="district-boundary" filter="url(#shadow)">');
    for (const bd of boundaryPaths) {
      parts.push(
        `<path d="${bd}" fill="url(#boundaryGrad)" stroke="#4CAF50" ` +
        `stroke-width="2" stroke-linejoin="round"/>`
      );
    }
    parts.push('</g>');
  }

  // ===== 装饰性河流（贝塞尔曲线 + 标注） =====
  parts.push('<g class="rivers">');
  parts.push(
    `<path d="M${MAP_X + 35},${MAP_Y + MAP_H * 0.75} ` +
    `Q${MAP_X + 160},${MAP_Y + MAP_H * 0.55} ${MAP_X + 290},${MAP_Y + MAP_H * 0.68} ` +
    `T${MAP_X + MAP_W - 45},${MAP_Y + MAP_H * 0.55}" ` +
    `fill="none" stroke="url(#riverGrad)" stroke-width="6" stroke-linecap="round" opacity="0.5"/>`
  );
  parts.push(
    `<text x="${MAP_X + 210}" y="${MAP_Y + MAP_H * 0.58}" fill="#1565C0" ` +
    `font-size="${Math.round(10 * fontScale)}" opacity="0.65">主要河流</text>`
  );
  parts.push('</g>');

  // ===== 走线路径（前进段 + 返程段） =====
  parts.push('<g class="route-paths" filter="url(#shadow)">');
  if (fwdPath) {
    // 前进段：橙色实线（虚线纹理） dasharray 6 4
    parts.push(
      `<path d="${fwdPath}" fill="none" stroke="#FF7826" stroke-width="3" ` +
      `stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`
    );
  }
  if (retPath) {
    // 返程段：蓝色虚线 dasharray 4 3
    parts.push(
      `<path d="${retPath}" fill="none" stroke="#1976D2" stroke-width="2.5" ` +
      `stroke-dasharray="4 3" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>`
    );
  }
  parts.push('</g>');

  // ===== 标点 markers =====
  parts.push('<g class="markers">');
  for (const m of markers) {
    let color, label, baseR;
    if (m.type === 'base' || m.type === 'arrival') {
      color = '#4CAF50'; label = '起'; baseR = 8;
    } else if (m.type === 'wellness') {
      color = '#8E24AA'; label = '养'; baseR = 7;
    } else if (m.type === 'departure') {
      color = '#1976D2'; label = '返'; baseR = 8;
    } else {
      color = '#FF7826'; label = '景'; baseR = 7;
    }
    const radius = Math.round(baseR * markerScale);
    const labelFs = Math.round(10 * fontScale);
    const hitR = Math.max(22, radius + 14);
    const simName = toSimplified(m.name || '');
    const simDesc = toSimplified(m.spot_desc || m.plan || '');
    const simPlan = toSimplified(m.plan || '');
    const simDay = toSimplified(m.day || '');
    const imgUrl = pickImgs(m);
    parts.push(
      `<g class="route-marker" style="cursor:pointer"` +
      ` data-type="${escXml(m.type)}" data-day="${escXml(simDay)}"` +
      ` data-name="${escXml(simName)}" data-plan="${escXml(simPlan)}"` +
      ` data-lat="${m.lat}" data-lng="${m.lng}"` +
      ` data-spot-desc="${escXml(simDesc)}"` +
      (imgUrl ? ` data-spot-img="${escXml(imgUrl)}"` : '') +
      ` transform="translate(${m.x},${m.y})">` +
      `<circle class="hit-area" r="${hitR}" fill="transparent" pointer-events="all"/>` +
      `<circle r="${radius}" fill="${color}" stroke="#fff" stroke-width="2"/>` +
      `<text text-anchor="middle" dy="${Math.round(labelFs * 0.35)}" fill="#fff" ` +
      `font-size="${labelFs}" font-weight="bold">${label}</text>` +
      `<text y="${radius + labelFs}" text-anchor="middle" font-size="${labelFs}" ` +
      `fill="#000" font-family="sans-serif">${escXml(shortName(simName, 8))}</text>` +
      `</g>`
    );
  }
  parts.push('</g>');

  // ===== 图例栏 (y=535-563) =====
  parts.push(`<g class="legend" transform="translate(${MAP_X}, 535)">`);
  parts.push(
    `<rect width="${MAP_W}" height="28" rx="6" fill="rgba(255,255,255,0.92)" ` +
    `stroke="#ddd" stroke-width="0.5"/>`
  );
  const legendEntries = [
    { color: '#4CAF50', label: '起点' },
    { color: '#FF7826', label: '途经' },
    { color: '#8E24AA', label: '康养' },
    { color: '#1976D2', label: '返程' },
  ];
  const legFs = Math.round(11 * fontScale);
  legendEntries.forEach((e, i) => {
    const cx = i * 110 + 30;
    parts.push(
      `<circle cx="${cx}" cy="14" r="6" fill="${e.color}"/>` +
      `<text x="${cx + 12}" y="18" font-size="${legFs}" fill="#333">${e.label}</text>`
    );
  });
  parts.push('</g>');

  // ===== 康养特色信息栏 (y=570-640) =====
  parts.push(`<g class="wellness-info" transform="translate(${MAP_X}, 570)">`);
  parts.push(
    `<rect width="${MAP_W}" height="70" rx="10" fill="#FFF8E1" ` +
    `stroke="#FFE0B2" stroke-width="0.8"/>`
  );
  parts.push(
    `<text x="15" y="22" fill="#E65100" font-size="${Math.round(13 * fontScale)}" ` +
    `font-weight="bold">康养特色</text>`
  );
  // 信息文字可能很长，分两行
  const text1 = wellnessText.length > 42 ? wellnessText.slice(0, 42) : wellnessText;
  const text2 = wellnessText.length > 42 ? wellnessText.slice(42, 84) : '';
  parts.push(
    `<text x="15" y="42" fill="#555" font-size="${Math.round(11 * fontScale)}">${escXml(text1)}</text>`
  );
  if (text2) {
    parts.push(
      `<text x="15" y="60" fill="#555" font-size="${Math.round(11 * fontScale)}">${escXml(text2)}</text>`
    );
  }
  parts.push('</g>');

  // ===== 景点列表区 (y=650-840) =====
  parts.push(`<g class="spot-list" transform="translate(${MAP_X}, 650)">`);
  parts.push(
    `<rect width="${MAP_W}" height="190" rx="10" fill="#FAFAFA" ` +
    `stroke="#EEE" stroke-width="0.5"/>`
  );
  parts.push(
    `<text x="15" y="20" fill="#333" font-size="${Math.round(12 * fontScale)}" ` +
    `font-weight="bold">行程景点</text>`
  );
  let yPos = 42;
  const itemFs = Math.round(11 * fontScale);
  for (const m of markers) {
    if (m.type === 'base' || m.type === 'arrival' || m.type === 'departure') continue;
    const simName = toSimplified(m.name || '');
    const simDay = toSimplified(m.day || '');
    const simPlan = toSimplified(m.plan || '');
    const simDesc = toSimplified(m.spot_desc || '');
    const imgUrl = pickImgs(m);
    // 景点行可见（显示名称/日程），图片URL通过 data-spot-img 隐藏
    parts.push(
      `<g class="spot-item" data-name="${escXml(simName)}" data-day="${escXml(simDay)}"` +
      ` data-spot-desc="${escXml(simDesc)}"` +
      (imgUrl ? ` data-spot-img="${escXml(imgUrl)}"` : '') + `>` +
      `<circle cx="18" cy="${yPos - 3}" r="3" fill="#FF7826"/>` +
      `<text x="28" y="${yPos}" fill="#333" font-size="${itemFs}">` +
      `${escXml(shortName(simName, 10))}` +
      (simDay ? ` · ${escXml(simDay)}` : '') +
      (simPlan ? ` · ${escXml(shortName(simPlan, 18))}` : '') +
      `</text></g>`
    );
    yPos += 18;
    if (yPos > 180) break;
  }
  parts.push('</g>');

  parts.push('</svg>');
  return parts.join('\n  ');
}

// ============================================================
// 保存/加载/删除
// ============================================================
async function handleGenerate(req, res) {
  const body = await readJsonSafe(req, res);
  if (!body) return;
  const { route_id, version = 'standard', waypoints } = body;
  if (!waypoints || !Array.isArray(waypoints) || waypoints.length === 0) {
    return json(res, 400, { ok: false, error: 'waypoints_required' });
  }
  const routes = loadRoutes();
  const route = routes.find((r) => r.product_id === route_id);
  const routeName = route?.product_name || route_id;
  const svg = generateSvg(waypoints, route_id, routeName, version);
  return json(res, 200, { ok: true, svg });
}

async function handleSave(req, res) {
  const body = await readJsonSafe(req, res);
  if (!body) return;
  const { route_id, route_data, svg_standard, svg_elder } = body;
  if (!route_id || !route_data) {
    return json(res, 400, { ok: false, error: 'route_id_and_route_data_required' });
  }

  // 按线路创建子目录
  const pkgDir = path.join(MAPS_DIR, route_id);
  fs.mkdirSync(pkgDir, { recursive: true });

  // 保存行程数据
  const routeData = {
    ...route_data,
    route_id,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(pkgDir, 'route_data.json'),
    JSON.stringify(routeData, null, 2),
    'utf8'
  );

  // 保存两种版本的 SVG
  if (svg_standard) {
    fs.writeFileSync(path.join(pkgDir, 'map_standard.svg'), svg_standard, 'utf8');
  }
  if (svg_elder) {
    fs.writeFileSync(path.join(pkgDir, 'map_elder.svg'), svg_elder, 'utf8');
  }

  // 兼容旧版扁平结构（map-kit.js findPrebuiltSvg）
  if (svg_standard) {
    fs.writeFileSync(path.join(MAPS_DIR, `${route_id}_standard.svg`), svg_standard, 'utf8');
  }
  if (svg_elder) {
    fs.writeFileSync(path.join(MAPS_DIR, `${route_id}_elder.svg`), svg_elder, 'utf8');
  }

  // ★ 同步保存到 geographicSVG 目录（以路线名命名，方便管理）
  try {
    const geoDir = path.join(ROOT, 'geographicSVG');
    fs.mkdirSync(geoDir, { recursive: true });
    const routeName = route_data.route_name || route_id;
    if (svg_standard) {
      fs.writeFileSync(path.join(geoDir, `${routeName}-标准版.svg`), svg_standard, 'utf8');
    }
    if (svg_elder) {
      fs.writeFileSync(path.join(geoDir, `${routeName}-适老版.svg`), svg_elder, 'utf8');
    }
  } catch (e) {
    // geographicSVG 保存失败不影响主流程
  }

  updateIndex();

  return json(res, 200, { ok: true, message: 'saved', route_id });
}

async function handlePublish(req, res) {
  const body = await readJsonSafe(req, res);
  if (!body) return;
  const { route_id, destination, keywords, product_type, title, status } = body;
  if (!route_id) return json(res, 400, { ok: false, error: 'route_id_required' });
  const pkgDir = path.join(MAPS_DIR, route_id);
  if (!fs.existsSync(path.join(pkgDir, 'route_data.json'))) {
    return json(res, 404, { ok: false, error: 'package_not_found_save_first' });
  }
  const allowed = new Set(['wellness', 'coastal', 'culture', 'ecology']);
  const pt = allowed.has(product_type) ? product_type : 'wellness';
  const publish = {
    route_id,
    status: status === 'draft' ? 'draft' : 'published',
    destination: Array.isArray(destination) ? destination.filter(Boolean) : [destination].filter(Boolean),
    keywords: Array.isArray(keywords) ? keywords.filter(Boolean) : String(keywords || '').split(/[,，\s]+/).filter(Boolean),
    product_type: pt,
    title: title || route_id,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pkgDir, 'publish.json'), JSON.stringify(publish, null, 2), 'utf8');
  return json(res, 200, { ok: true, publish });
}

function handleList(res) {
  fs.mkdirSync(MAPS_DIR, { recursive: true });
  const indexFile = path.join(MAPS_DIR, 'index.json');
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    return json(res, 200, { ok: true, packages: index });
  } catch {
    return json(res, 200, { ok: true, packages: [] });
  }
}

function handleGetPackage(res, routeId) {
  const pkgDir = path.join(MAPS_DIR, routeId);
  const routeDataFile = path.join(pkgDir, 'route_data.json');
  if (!fs.existsSync(routeDataFile)) {
    return json(res, 404, { ok: false, error: 'package_not_found' });
  }
  const route_data = JSON.parse(fs.readFileSync(routeDataFile, 'utf8'));
  let svg_standard = '', svg_elder = '';
  try { svg_standard = fs.readFileSync(path.join(pkgDir, 'map_standard.svg'), 'utf8'); } catch {}
  try { svg_elder = fs.readFileSync(path.join(pkgDir, 'map_elder.svg'), 'utf8'); } catch {}
  return json(res, 200, { ok: true, route_data, svg_standard, svg_elder });
}

function handleDeletePackage(res, routeId) {
  // 删除子目录
  const pkgDir = path.join(MAPS_DIR, routeId);
  try {
    if (fs.existsSync(pkgDir)) {
      fs.rmSync(pkgDir, { recursive: true });
    }
  } catch {}
  // 删除兼容旧版文件
  ['standard', 'elder'].forEach((v) => {
    try { fs.unlinkSync(path.join(MAPS_DIR, `${routeId}_${v}.svg`)); } catch {}
    try { fs.unlinkSync(path.join(MAPS_DIR, `${routeId}_${v}.json`)); } catch {}
  });
  updateIndex();
  return json(res, 200, { ok: true, message: 'deleted' });
}

function handleGetFile(res, routeId, version) {
  // 优先从子目录查找，兼容旧版扁平结构
  const nestedFile = path.join(MAPS_DIR, routeId, `map_${version}.svg`);
  const flatFile = path.join(MAPS_DIR, `${routeId}_${version}.svg`);
  const targetFile = fs.existsSync(nestedFile) ? nestedFile : flatFile;

  if (!fs.existsSync(targetFile)) {
    return json(res, 404, { ok: false, error: 'file_not_found' });
  }
  const svg = fs.readFileSync(targetFile, 'utf8');
  return json(res, 200, { ok: true, svg });
}

// ============================================================
// 索引管理
// ============================================================
function updateIndex() {
  fs.mkdirSync(MAPS_DIR, { recursive: true });
  const subDirs = fs.readdirSync(MAPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());
  const index = [];

  for (const dir of subDirs) {
    const routeId = dir.name;
    const dataFile = path.join(MAPS_DIR, routeId, 'route_data.json');
    if (!fs.existsSync(dataFile)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      index.push({
        route_id: routeId,
        route_name: meta.route_name || routeId,
        version: meta.version || '1.0',
        generated_at: meta.generated_at || meta.updated_at || '',
        updated_at: meta.updated_at || '',
        waypoint_count: (meta.waypoints || []).length,
      });
    } catch {}
  }
  fs.writeFileSync(path.join(MAPS_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
}

// ============================================================
// 对外查询：供 map-kit.js 调用
// ============================================================
export function findPrebuiltPackage(routeId, version = 'standard') {
  if (!routeId) return null;
  const pkgDir = path.join(MAPS_DIR, routeId);
  const routeDataFile = path.join(pkgDir, 'route_data.json');
  if (!fs.existsSync(routeDataFile)) return null;

  try {
    const routeData = JSON.parse(fs.readFileSync(routeDataFile, 'utf8'));
    let svg = '';
    const svgNested = path.join(pkgDir, `map_${version}.svg`);
    const svgFlat = path.join(MAPS_DIR, `${routeId}_${version}.svg`);
    if (fs.existsSync(svgNested)) svg = fs.readFileSync(svgNested, 'utf8');
    else if (fs.existsSync(svgFlat)) svg = fs.readFileSync(svgFlat, 'utf8');
    return { routeData, svg };
  } catch {
    return null;
  }
}
