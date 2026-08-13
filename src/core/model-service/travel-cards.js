// 旅居类卡片：route_svg / route_wellness / route_coastal / route_culture / route_ecology / sojourn_base /
// travel_availability_card / travel_h5_embed_card / travel_itinerary_card / travel_weather_risk_card /
// travel_spot_card / travel_medical_card。
// 含三类公开导出：fillTravelH5EmbedCard / fillTravelWeatherRiskCard / fillTravelWeatherRisk（向后兼容别名）。

import { sanitizeModelResult, sanitizeText, buildStaticMapUrl, NEARBY_TENCENT_JS_KEY } from './utils.js';
import {
  buildRouteMapData as buildRouteMapDataFromKit,
  buildBaseMapData as buildBaseMapDataFromKit,
  findPrebuiltPackageByDestination,
  findPrebuiltPackage,
} from '../map/map-kit.js';
import { matchPublishedPackages } from '../scene-router/publish-index.js';
import {
  generateRouteHtml,
  selectProductTemplate,
  isSampleCompatibleWithDestination,
} from '../route-svg-generator.js';
import { enrichWaypointsFromDashboardKb } from '../../skills/travel_route/dashboard-spot-kb.js';
import {
  resolveAndNormalizeItinerary,
  normalizeItineraryForDetailCard,
  normalizeItineraryForRouteCard,
} from '../travel/itinerary-normalize.js';
import { pickByLockedId, withEntityParams } from '../conversation/entity-params.js';
import { listReferenceTravelProducts, selectProduct } from '../../services/travel/jtd-service.js';

// 广西旅居目的地坐标映射表（lat, lng）
const TRAVEL_DESTINATION_COORDS = {
  '巴马': { lat: 24.0487, lng: 107.2586, name: '巴马瑶族自治县' },
  '巴马瑶族自治县': { lat: 24.0487, lng: 107.2586, name: '巴马瑶族自治县' },
  '北海': { lat: 21.4817, lng: 109.1196, name: '北海市' },
  '北海市': { lat: 21.4817, lng: 109.1196, name: '北海市' },
  '涠洲岛': { lat: 21.0388, lng: 109.1419, name: '涠洲岛' },
  '防城港': { lat: 21.6146, lng: 108.3545, name: '防城港市' },
  '防城港市': { lat: 21.6146, lng: 108.3545, name: '防城港市' },
  '港口区': { lat: 21.6146, lng: 108.3545, name: '防城港港口区' },
  '东兴': { lat: 21.5479, lng: 107.9722, name: '东兴市' },
  '桂林': { lat: 25.2734, lng: 110.2902, name: '桂林市' },
  '桂林市': { lat: 25.2734, lng: 110.2902, name: '桂林市' },
  '阳朔': { lat: 24.7784, lng: 110.4890, name: '阳朔县' },
  '南宁': { lat: 22.8170, lng: 108.3669, name: '南宁市' },
  '南宁市': { lat: 22.8170, lng: 108.3669, name: '南宁市' },
  '柳州': { lat: 24.3264, lng: 109.4280, name: '柳州市' },
  '百色': { lat: 23.9022, lng: 106.6182, name: '百色市' },
  '百色市': { lat: 23.9022, lng: 106.6182, name: '百色市' },
  '钦州': { lat: 21.9522, lng: 108.6286, name: '钦州市' },
  '梧州': { lat: 23.4765, lng: 111.2791, name: '梧州市' },
  '贺州': { lat: 24.4033, lng: 111.5527, name: '贺州市' },
  '玉林': { lat: 22.6360, lng: 110.1540, name: '玉林市' },
  '贵港': { lat: 23.1114, lng: 109.5982, name: '贵港市' },
  '河池': { lat: 24.6965, lng: 108.0853, name: '河池市' },
  '来宾': { lat: 23.7333, lng: 109.2217, name: '来宾市' },
  '崇左': { lat: 22.4041, lng: 107.3540, name: '崇左市' },
  '嘉路': { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' },
  '嘉路康养中心': { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' },
  '七洞乡': { lat: 23.6817, lng: 109.0512, name: '来宾市兴宾区七洞乡' },
};

// 默认旅居坐标（防城港嘉路康养中心，作为兜底）
const TRAVEL_DEFAULT_COORD = { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' };

/**
 * 从目的地名提取坐标。支持模糊匹配（如"广西巴马"→"巴马"）。
 */
function getTravelDestinationCoord(destination) {
  if (!destination) return TRAVEL_DEFAULT_COORD;
  const dest = String(destination).trim();
  // 精确匹配
  if (TRAVEL_DESTINATION_COORDS[dest]) return TRAVEL_DESTINATION_COORDS[dest];
  // 模糊匹配：目的地包含映射表的 key
  for (const key of Object.keys(TRAVEL_DESTINATION_COORDS)) {
    if (dest.includes(key)) return TRAVEL_DESTINATION_COORDS[key];
  }
  return { ...TRAVEL_DEFAULT_COORD, name: dest };
}

/**
 * 为 travel_route 模板构建地图数据字段
 */
function buildTravelMapData(destination, markers = []) {
  const center = getTravelDestinationCoord(destination);
  const validMarkers = (markers || []).filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)));
  return {
    map_key: process.env.TENCENT_MAP_JS_KEY || NEARBY_TENCENT_JS_KEY,
    centerLat: center.lat,
    centerLng: center.lng,
    centerName: center.name,
    center_json: JSON.stringify(center),
    static_map_url: buildStaticMapUrl(center, validMarkers.slice(0, 30)),
    markers_json: JSON.stringify(validMarkers),
    map_markers: validMarkers,
  };
}

/**
 * 生成旅居路线走线途经点坐标（用于 TMap.Polyline 画线）。
 */
const ROUTE_WAYPOINT_TEMPLATES = {
  '广西巴马': [
    { name: '巴马长寿村', lat: 24.0487, lng: 107.2586, type: 'arrival' },
    { name: '百魔洞景区', lat: 24.0652, lng: 107.2391, type: 'spot' },
    { name: '水晶宫景区', lat: 24.0321, lng: 107.2845, type: 'spot' },
    { name: '盘阳河康养带', lat: 24.0412, lng: 107.2701, type: 'wellness' },
    { name: '巴马汽车总站', lat: 24.0523, lng: 107.2512, type: 'departure' },
  ],
  '广西北海': [
    { name: '北海火车站', lat: 21.4721, lng: 109.1196, type: 'arrival' },
    { name: '银滩旅游区', lat: 21.4417, lng: 109.1286, type: 'spot' },
    { name: '老街历史文化区', lat: 21.4856, lng: 109.1132, type: 'spot' },
    { name: '涠洲岛码头', lat: 21.4632, lng: 109.1089, type: 'spot' },
    { name: '北海福成机场', lat: 21.5417, lng: 109.2632, type: 'departure' },
  ],
  '广西七洞乡': [
    { name: '七洞乡政府', lat: 23.6817, lng: 109.0512, type: 'arrival' },
    { name: '七洞乡康养基地', lat: 23.6852, lng: 109.0491, type: 'wellness' },
    { name: '七洞乡生态园', lat: 23.6781, lng: 109.0568, type: 'spot' },
    { name: '来宾火车站', lat: 23.7256, lng: 109.0612, type: 'departure' },
  ],
};

function buildRouteWaypoints(destination, totalDays = 3) {
  const center = getTravelDestinationCoord(destination);
  const destKey = Object.keys(ROUTE_WAYPOINT_TEMPLATES).find((k) => destination.includes(k.replace('广西', '')));
  const templates = destKey ? ROUTE_WAYPOINT_TEMPLATES[destKey] : null;
  const days = Math.max(2, Math.min(7, parseInt(totalDays) || 3));

  if (templates && templates.length >= days) {
    // 用真实途经点模板，按天数截取
    const waypoints = templates.slice(0, days).map((wp, i) => ({
      ...wp,
      day: `D${i + 1}`,
      plan: i === 0 ? `抵达${wp.name}，办理入住` : i === days - 1 ? `从${wp.name}返程` : `${wp.name}康养体验`,
    }));
    return waypoints;
  }

  // 无模板时，基于中心坐标生成环形走线（每天一个点，绕中心分布）
  const waypoints = [];
  const radius = 0.04; // 约 4 公里
  for (let i = 0; i < days; i++) {
    const angle = (i / days) * Math.PI * 2 - Math.PI / 2; // 从正北开始顺时针
    const offset = i === 0 || i === days - 1 ? 0 : radius; // 起止点在中心，中间点分散
    const lat = center.lat + Math.cos(angle) * offset;
    const lng = center.lng + Math.sin(angle) * offset;
    const isArrival = i === 0;
    const isDeparture = i === days - 1;
    waypoints.push({
      name: isArrival ? `${center.name}抵达点` : isDeparture ? `${center.name}返程点` : `${center.name}Day${i + 1}体验点`,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      day: `D${i + 1}`,
      type: isArrival ? 'arrival' : isDeparture ? 'departure' : 'spot',
      plan: isArrival ? `抵达${center.name}，办理入住` : isDeparture ? `从${center.name}返程` : `${center.name}康养体验`,
    });
  }
  return waypoints;
}

/**
 * 构建走线版地图数据（含 waypoints + polyline 路径）。
 */
function buildRouteMapData(destination, totalDays = 3) {
  const center = getTravelDestinationCoord(destination);
  const waypoints = buildRouteWaypoints(destination, totalDays);
  const validWaypoints = waypoints.filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lng));
  // polyline 路径：按天序连接的坐标数组
  const polylinePath = validWaypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng }));
  // 自动适配缩放边界：[minLat, minLng, maxLat, maxLng]
  const lats = validWaypoints.map((wp) => wp.lat);
  const lngs = validWaypoints.map((wp) => wp.lng);
  const fitBounds = lats.length >= 2 ? {
    minLat: Math.min(...lats), minLng: Math.min(...lngs),
    maxLat: Math.max(...lats), maxLng: Math.max(...lngs),
  } : null;

  return {
    map_key: process.env.TENCENT_MAP_JS_KEY || NEARBY_TENCENT_JS_KEY,
    centerLat: center.lat,
    centerLng: center.lng,
    centerName: center.name,
    center_json: JSON.stringify(center),
    static_map_url: buildStaticMapUrl(center, validWaypoints.slice(0, 30)),
    markers_json: JSON.stringify(validWaypoints),
    map_markers: validWaypoints,
    // 走线专用字段
    waypoints_json: JSON.stringify(validWaypoints),
    waypoints: validWaypoints,
    polyline_path: polylinePath,
    polyline_path_json: JSON.stringify(polylinePath),
    fit_bounds: fitBounds,
    fit_bounds_json: fitBounds ? JSON.stringify(fitBounds) : 'null',
    // 腾讯路径规划 WebService API（用于获取真实道路走线，可选）
    route_planning_url: buildRoutePlanningUrl(validWaypoints),
  };
}

/**
 * 构建腾讯路径规划 WebService API URL（驾车路线）。
 */
function buildRoutePlanningUrl(waypoints = []) {
  if (waypoints.length < 2) return '';
  const from = `${waypoints[0].lat},${waypoints[0].lng}`;
  const to = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
  const via = waypoints.slice(1, -1).map((wp) => `${wp.lat},${wp.lng}`).join(';');
  return `/api/map/route-planning?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${via ? `&via=${encodeURIComponent(via)}` : ''}&policy=1`;
}

async function fillRouteCardLegacy({ message, business_data, selectedTemplateId }) {
  const routes = Array.isArray(business_data?.routes) ? business_data.routes : [];
  const forcedRouteId = String(
    business_data?.route_id || business_data?.publish_match?.route_id || ''
  ).trim();

  // 第二刀：优先按 published route_id 取包，避免 routes[0]（常为巴马）盖住真实命中
  let matchedRouteId = forcedRouteId;
  let svgPkg = forcedRouteId ? findPrebuiltPackage(forcedRouteId, 'standard') : null;
  const inferredEarly = inferDestination(message);
  const rejectCrossCityPublish = (hit) => {
    if (!hit || !inferredEarly) return false;
    const destBlob = JSON.stringify(hit.meta?.destination || hit.route_id || '');
    // 嘉路/防城港话术不得锁巴马包；巴马话术不得锁北海/防城港包
    if (/防城港/.test(inferredEarly) && /巴马|百魔洞|bama/i.test(destBlob) && !/巴马|百魔洞/.test(message)) return true;
    if (/巴马/.test(inferredEarly) && /(北海|防城港|东兴)/.test(destBlob) && !/(北海|防城港|东兴)/.test(message)) return true;
    if (/北海/.test(inferredEarly) && /巴马|百魔洞|bama/i.test(destBlob) && !/巴马|百魔洞/.test(message)) return true;
    return false;
  };
  if (!svgPkg?.svg) {
    const hits = matchPublishedPackages(message).filter((h) => !rejectCrossCityPublish(h));
    const top = hits[0];
    const second = hits[1];
    if (top && (!second || top.score > second.score)) {
      matchedRouteId = top.route_id;
      svgPkg = findPrebuiltPackage(top.route_id, 'standard');
    }
  } else if (forcedRouteId && rejectCrossCityPublish({
    route_id: forcedRouteId,
    meta: business_data?.publish_match || {},
  })) {
    matchedRouteId = '';
    svgPkg = null;
  }

  const inferredDest = inferDestination(message);
  const route = selectTravelRoute(message, routes);
  const pkgDestRaw = svgPkg?.routeData?.destination
    || (Array.isArray(business_data?.publish_match?.destination)
      ? business_data.publish_match.destination[0]
      : null)
    || (Array.isArray(business_data?.destination) ? business_data.destination[0] : business_data?.destination);
  const destination = sanitizeText(
    pkgDestRaw
    || business_data?.primary_city
    || (Array.isArray(business_data?.destination) ? business_data.destination[0] : business_data?.destination)
    || inferredDest
    || route?.destination
    || '广西旅居'
  );

  if (!svgPkg?.svg) {
    svgPkg = findPrebuiltPackageByDestination(destination, 'standard') || svgPkg;
  }

  const budgetLevel = sanitizeText(route?.budget_level || inferBudget(message));
  const season = sanitizeText(route?.season || inferSeason(message));
  const bookingStatus = sanitizeText(route?.booking_status || '可咨询余量');
  const healthTags = sanitizeText(route?.health_tags || '慢病友好,低强度,医疗可达');

  // ★ 产品模板库分类：优先使用编排器推断的模板ID，其次按关键词匹配
  const productMatch = selectProductTemplate(message, destination);
  const routeType = ['route_wellness', 'route_coastal', 'route_culture', 'route_ecology'].includes(selectedTemplateId)
    ? selectedTemplateId
    : (productMatch?.id || '');
  const productSample = productMatch?.sample || {};
  const sampleOk = isSampleCompatibleWithDestination(productSample, destination)
    || isSampleCompatibleWithDestination(productSample, message);

  let staticSvg = '';
  if (svgPkg && svgPkg.svg) {
    staticSvg = svgPkg.svg;
  } else {
    staticSvg = `<div style="padding:20px;text-align:center;color:#999;">地图加载中...</div>`;
  }

  // 优先用预制作资源包；示例数据仅在与目的地同城时使用，禁止「七洞乡目的地 + 巴马行程」
  const resolvedRouteId = matchedRouteId || svgPkg?.routeData?.route_id || '';
  const rawWaypoints = Array.isArray(svgPkg?.routeData?.waypoints)
    ? svgPkg.routeData.waypoints
    : (Array.isArray(business_data?.waypoints) ? business_data.waypoints : []);
  const fromWaypoints = buildContentFromWaypoints(rawWaypoints);
  const routeTitle = svgPkg?.routeData?.route_name
    || business_data?.route_title
    || (sampleOk ? productSample.routeTitle : '')
    || `${destination.replace(/^广西/, '')}旅居路线`;
  // 已锁定发布包时：空 highlights/itinerary 优先用途经点生成，绝不回落异地 product sample
  const lockedPkg = !!(resolvedRouteId && svgPkg?.routeData);
  const highlights = (svgPkg?.routeData?.highlights?.length
    ? svgPkg.routeData.highlights
    : (fromWaypoints.highlights.length
      ? fromWaypoints.highlights
      : ((!lockedPkg && sampleOk && productSample.highlights?.length)
        ? productSample.highlights
        : buildTravelHighlights(healthTags, destination))));
  const productIdHint = business_data?.jtd?.selected_product?.product_id || resolvedRouteId || '';
  const itineraryResolved = resolveAndNormalizeItinerary({
    candidates: [
      svgPkg?.routeData?.itinerary,
      fromWaypoints.itinerary,
      (!lockedPkg && sampleOk) ? productSample.itinerary : null,
      business_data?.jtd?.selected_product?.itinerary,
    ],
    routeId: resolvedRouteId,
    productId: productIdHint,
    routeTitle,
    destination,
  });
  const itinerary = itineraryResolved.itinerary.length
    ? itineraryResolved.itinerary
    : normalizeItineraryForRouteCard(buildItinerary(destination, svgPkg?.routeData?.days || 3));
  const daysLabel = svgPkg?.routeData?.days
    ? (String(svgPkg.routeData.days).includes('天') ? String(svgPkg.routeData.days) : `${svgPkg.routeData.days}天`)
    : (itineraryResolved.daysLabel
      || ((!lockedPkg && sampleOk && productSample.days)
        ? productSample.days
        : (/四天|4天|five/i.test(message) ? '4天3晚' : `${Math.max(itinerary.length, 3)}天${Math.max(itinerary.length - 1, 2)}晚`)));
  const answerText = `已为您推荐${routeTitle}，按${budgetLevel}和老人低强度出行节奏规划。`;
  const waypointSpots = enrichWaypointsFromDashboardKb(rawWaypoints);
  const waypointSpotsJson = JSON.stringify(waypointSpots.map((wp) => ({
    name: wp?.name || '',
    day: wp?.day || '',
    plan: wp?.plan || '',
    spot_desc: wp?.spot_desc || '',
    spot_images: Array.isArray(wp?.spot_images) ? wp.spot_images : [],
    related_spots: Array.isArray(wp?.related_spots) ? wp.related_spots : [],
  })));

  const result = sanitizeModelResult({
    // 统一渲染 route_svg，避免 route_coastal 等副本仍整段输出 plan 长串
    template_id: 'route_svg',
    answer_text: answerText,
    answer: answerText,
    data: {
      route_id: resolvedRouteId,
      routeTitle,
      routeType,
      routeTheme: String(routeType || 'route_wellness').replace(/^route_/, '') || 'wellness',
      destination,
      season,
      budgetLevel,
      days: daysLabel,
      suitable: sanitizeText(
        svgPkg?.routeData?.suitable_for
        || itineraryResolved.knowledge?.suitable_for
        || ((!lockedPkg && sampleOk) ? productSample.suitable : '')
        || inferTravelSuitable(message)
      ),
      bookingStatus,
      summary: sanitizeText(
        svgPkg?.routeData?.summary
        || itineraryResolved.knowledge?.summary
        || ((!lockedPkg && sampleOk) ? productSample.summary : '')
        || buildRouteSummary(destination, budgetLevel)
      ),
      highlights: (Array.isArray(highlights) && highlights.length)
        ? highlights
        : (itineraryResolved.knowledge?.highlights || []),
      itinerary,
      itinerary_raw: itineraryResolved.raw || [],
      healthNotice: buildTravelHealthNotice(message),
      static_svg: staticSvg,
      waypoint_spots_json: waypointSpotsJson,
      hasSpots: waypointSpots.some((wp) => (wp?.spot_images || []).length > 0 || (wp?.spot_desc || '').length > 0),
      publish_match: business_data?.publish_match || null,
      productId: business_data?.jtd?.selected_product?.product_id || '',
      itinerary_source: itineraryResolved.knowledge?.source || 'route_data',
    },
    // 旅居主卡只走追问（followup_suggestions / compact_followups），避免模板内硬编码按钮 + actions 栏重复
    actions: [],
    followup_suggestions: [
      {
        label: '查看每日日程',
        user_prompt: `请按天展示${destination}「${routeTitle}」的详细行程安排`,
        action_key: 'travel_route.view_detail',
        skill_key: 'travel_route',
        params: {
          destination,
          route_id: resolvedRouteId || '',
          route_title: routeTitle,
          template_id: 'travel_itinerary_card',
        },
      },
      {
        label: '查看产品详情',
        user_prompt: `请展示${destination}这条旅居产品的详细信息`,
        action_key: 'travel_route.view_product_detail',
        skill_key: 'travel_route',
        params: {
          destination,
          route_id: resolvedRouteId || '',
          route_title: routeTitle,
        },
      },
      {
        label: '检查可订',
        user_prompt: '请检查这条旅居路线近期是否可预订',
        action_key: 'travel_route.check_availability',
        skill_key: 'travel_route',
        params: { destination, route_id: resolvedRouteId || '' },
      },
      {
        label: '测算预算',
        user_prompt: '请按当前预算档测算这条旅居路线费用',
        action_key: 'travel_route.calculate_budget',
        skill_key: 'travel_route',
        params: { budget_level: budgetLevel, destination, route_id: resolvedRouteId || '' },
      },
      {
        label: '重新规划路线',
        user_prompt: `请按老人低强度节奏重新规划${destination}这条旅居路线`,
        action_key: 'travel_route.replan',
        skill_key: 'travel_route',
        params: { destination, route_id: resolvedRouteId || '' },
      },
      {
        label: '天气风险',
        user_prompt: `请检查${destination}这条旅居路线近期天气风险`,
        action_key: 'travel_route.check_weather_risk',
        skill_key: 'travel_route',
        params: { destination, city: destination, route_id: resolvedRouteId || '' },
      },
    ],
    template_fit_notes: itineraryResolved.knowledge?.source
      ? [`itinerary_from_${itineraryResolved.knowledge.source}`]
      : [],
  });

  // Optional FlyAI KB: merge waypoints/highlights/products + map-ordered stream_events.
  // Failure keeps sojourn-maps / JTD path unchanged.
  try {
    const { tryEnrichRouteCardWithFlyai, applyFlyaiRoutePatch } = await import(
      '../agents/agents/travel-route-agent.js'
    );
    const patch = await tryEnrichRouteCardWithFlyai({
      query: message,
      linked_route_id: resolvedRouteId || undefined,
      data: result.data,
    });
    if (patch) {
      result.data = applyFlyaiRoutePatch(result.data, patch);
    }
  } catch {
    // keep existing card data
  }

  return result;
}

function selectTravelRoute(message, routes) {
  const text = String(message || '');
  if (/防城港|东兴|京族|芒街|白浪滩|十万大山|嘉路/.test(text)) {
    return routes.find((route) => /防城港|东兴/.test(String(route.destination || ''))) || null;
  }
  // 七洞乡属来宾，禁止被「海边/海滨」等宽词误匹配到北海
  if (/七洞/.test(text)) {
    return routes.find((route) => /七洞|来宾/.test(String(route.destination || route.name || ''))) || null;
  }
  if (/北海|银滩|涠洲/.test(text)) {
    return routes.find((route) => /北海/.test(String(route.destination || ''))) || null;
  }
  if (/巴马|百魔洞/.test(text)) {
    return routes.find((route) => /巴马/.test(String(route.destination || ''))) || null;
  }
  if (/桂林|阳朔|荔浦/.test(text)) {
    return routes.find((route) => /桂林/.test(String(route.destination || ''))) || null;
  }
  if (/来宾/.test(text)) {
    return routes.find((route) => /来宾|七洞/.test(String(route.destination || route.name || ''))) || null;
  }
  // 无明确目的地信号时禁止静默落到 routes[0]（常见默认巴马/北海）
  return null;
}

function inferDestination(message) {
  // 优先匹配明确的城市名（七洞乡≠北海，属来宾市兴宾区）
  if (/防城港|东兴|嘉路|白浪滩|簕山|京族|十万大山|上思/.test(message)) return '广西防城港';
  if (/七洞/.test(message)) return '广西七洞乡';
  if (/来宾/.test(message)) return '广西来宾';
  if (/北海|银滩|涠洲/.test(message)) return '广西北海';
  if (/桂林|阳朔/.test(message)) return '广西桂林';
  if (/南宁/.test(message)) return '广西南宁';
  if (/巴马|百魔洞/.test(message)) return '广西巴马';
  if (/昆明/.test(message)) return '云南昆明';
  if (/大理/.test(message)) return '云南大理';
  if (/丽江/.test(message)) return '云南丽江';
  if (/三亚/.test(message)) return '海南三亚';
  if (/海口/.test(message)) return '海南海口';
  if (/厦门/.test(message)) return '福建厦门';
  // 如果没有匹配到，返回 null，让调用者使用其他来源
  return null;
}

function inferBudget(message) {
  if (/经济|便宜|低预算/.test(message)) return '经济型';
  if (/高端|舒适|品质/.test(message)) return '舒适型';
  return '舒适型';
}

function inferSeason(message) {
  if (/夏|避暑/.test(message)) return '夏季避暑';
  if (/冬|过冬|秋冬/.test(message)) return '秋冬适宜';
  return '全年可评估';
}

function inferTravelSuitable(message) {
  if (/轮椅|无障碍/.test(message)) return '无障碍需求老人、家属陪同';
  if (/慢病|血压|糖尿病|心脏/.test(message)) return '慢病老人、家属陪同';
  return '低强度旅居老人、家属陪同';
}

function buildRouteSummary(destination, budgetLevel) {
  return `结合${destination}气候、医疗可达性和交通接驳，按${budgetLevel}推荐低强度康养旅居安排。`;
}

function buildRouteCardSummary({ product, productName, destination, jtd, priceLabel, budgetLevel }) {
  if (!product) return buildRouteSummary(destination, budgetLevel);
  const src = jtd.source_status === 'real_data' ? '已核验数据' : '演示数据';
  const priceText = priceLabel ? `参考价${priceLabel}；` : '';
  return `${productName || destination}；${priceText}来源=${src}；产品ID=${product.product_id || '待确认'}。`;
}

function buildTravelHighlights(healthTags, destination) {
  const tags = healthTags.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  const dest = String(destination || '');
  let placeTags = ['康养基地', '家属可陪同'];
  if (/北海/.test(dest)) placeTags = ['银滩慢行', '海鲜养生餐', '海滨低强度'];
  else if (/防城港|东兴|京族/.test(dest)) placeTags = ['白浪滩漫步', '京族滨海文化', '边境风情'];
  else if (/巴马/.test(dest)) placeTags = ['负氧离子', '长寿乡漫步', '低强度康养'];
  else if (/七洞/.test(dest)) placeTags = ['七洞乡康养基地', '生态园轻游', '低强度康养'];
  else if (/桂林|阳朔/.test(dest)) placeTags = ['漓江慢游', '喀斯特风光', '适老步道'];
  return [...new Set([...tags, ...placeTags])].slice(0, 5);
}

/** 发布包无 highlights/itinerary 时，从 waypoints 生成同城内容 */
function buildContentFromWaypoints(waypoints = []) {
  const list = Array.isArray(waypoints) ? waypoints.filter((wp) => wp && (wp.name || wp.plan)) : [];
  if (!list.length) return { highlights: [], itinerary: [] };
  const highlights = [];
  const seen = new Set();
  for (const wp of list) {
    const name = String(wp.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const plan = String(wp.plan || '').trim();
    highlights.push(plan ? `${name}·${plan}` : name);
    if (highlights.length >= 5) break;
  }
  const itinerary = list.map((wp, i) => {
    const dayRaw = String(wp.day || '').trim();
    const day = dayRaw
      ? (/^D\d+/i.test(dayRaw) ? dayRaw.replace(/^day/i, 'D') : dayRaw.replace(/^Day\s*/i, 'D'))
      : `D${i + 1}`;
    return {
      day,
      wp_name: String(wp.name || '').trim(),
      plan: String(wp.plan || '').trim() || `${wp.name || '途经点'}体验`,
    };
  });
  return { highlights, itinerary };
}

function resolveTravelDuration({ product = {}, title = '', message = '', fallbackDays = 3 } = {}) {
  const productDays = positiveInt(product?.days);
  const productNights = positiveInt(product?.nights);
  const daysFromProduct = productDays || (productNights ? productNights + 1 : 0);
  const daysFromTitle = extractDurationDays(title);
  const daysFromMessage = extractDurationDays(message);
  const totalDays = clampTripDays(daysFromProduct || daysFromTitle || daysFromMessage || fallbackDays);
  return {
    daysFromProduct,
    daysFromTitle,
    daysFromMessage,
    totalDays,
  };
}

function extractDurationDays(text) {
  const value = String(text || '');
  const digitMatch = value.match(/(\d+)\s*(?:天|日)/);
  if (digitMatch) return clampTripDays(Number(digitMatch[1]));
  const chineseMatch = value.match(/([一二两三四五六七八九十]{1,4})\s*(?:天|日)/);
  if (chineseMatch) return clampTripDays(chineseNumberToInt(chineseMatch[1]));
  if (/一周|七天|7\s*天/.test(value)) return 7;
  return 0;
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function clampTripDays(value) {
  const number = positiveInt(value);
  if (!number) return 0;
  return Math.max(1, Math.min(30, number));
}

function chineseNumberToInt(text) {
  const value = String(text || '').replace(/两/g, '二');
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === '十') return 10;
  const tenIndex = value.indexOf('十');
  if (tenIndex >= 0) {
    const high = tenIndex === 0 ? 1 : digits[value.slice(0, tenIndex)] || 0;
    const lowText = value.slice(tenIndex + 1);
    const low = lowText ? digits[lowText] || 0 : 0;
    return high * 10 + low;
  }
  return digits[value] || 0;
}

function buildItinerary(destination, days = 3) {
  const dest = String(destination || '旅居目的地');
  const totalDays = Math.max(1, Math.min(30, parseInt(days, 10) || 3));

  if (/北海/.test(dest)) {
    const beihai = [
      { day: 'D1', wp_name: '北海市区', plan: '抵达北海，入住海滨酒店，银滩晚风慢行与健康确认。' },
      { day: 'D2', wp_name: '银滩/老街', plan: '银滩漫步或北海老街轻游，海鲜养生餐，午休充足。' },
      { day: 'D3', wp_name: '海滨返程', plan: '海滨晨练或短途观海后返程，预留交通缓冲。' },
      { day: 'D4', wp_name: '涠洲补给日', plan: '可选涠洲岛低强度环岛，避免赶船赶程。' },
    ];
    return beihai.slice(0, totalDays);
  }
  if (/防城港|东兴|京族/.test(dest)) {
    const fcg = [
      { day: 'D1', wp_name: '防城港市区', plan: '抵达防城港，入住海滨住宿，白浪滩轻行。' },
      { day: 'D2', wp_name: '京族三岛', plan: '京族文化体验与滨海慢行，午后充分休息。' },
      { day: 'D3', wp_name: '东兴口岸', plan: '边境口岸观光后返程，预留交通缓冲。' },
    ];
    return fcg.slice(0, totalDays);
  }
  if (/七洞/.test(dest)) {
    const qd = [
      { day: 'D1', wp_name: '七洞乡政府', plan: '抵达七洞乡，办理入住，周边轻松散步。' },
      { day: 'D2', wp_name: '七洞乡康养基地', plan: '康养体验与健康评估，午后低强度活动。' },
      { day: 'D3', wp_name: '七洞乡生态园', plan: '生态园游憩，保留充分休息时间。' },
      { day: 'D4', wp_name: '七洞乡返程', plan: '短途游览或返程，预留交通缓冲。' },
    ];
    return qd.slice(0, totalDays);
  }

  const itinerary = [];
  for (let i = 0; i < totalDays; i++) {
    const dayNum = i + 1;
    let plan = '';
    if (i === 0) {
      plan = `抵达${dest}，办理入住，完成健康情况确认，安排轻松周边散步。`;
    } else if (i === totalDays - 1) {
      plan = '根据体力选择短途游览或返程，预留交通缓冲，避免赶行程。';
    } else {
      plan = `第${dayNum}天康养活动或基地体验，下午低强度游览，晚间保留充分休息时间。`;
    }
    itinerary.push({ day: `D${dayNum}`, plan });
  }
  return itinerary;
}

function buildTravelHealthNotice(message) {
  if (/糖尿病|血糖/.test(message)) return '建议随身携带降糖药和加餐，避免空腹长时间步行，确认基地可提供清淡餐食。';
  if (/血压|高血压/.test(message)) return '建议出行前确认血压稳定，避开高温暴晒和紧凑行程，随身携带常用药。';
  return '建议出行前确认慢病状态稳定，携带常用药，优先选择医疗可达、活动强度低的路线。';
}

/** 仅取已锁定/已选 JTD 产品；禁止静默 products[0]（常为巴马 mock） */
function pickLockedJtdProduct(jtd = {}, businessData = {}, message = '') {
  if (jtd?.selected_product) return jtd.selected_product;
  const products = Array.isArray(jtd?.products) ? jtd.products : [];
  if (!products.length) return null;
  const lockedId = String(businessData?.product_id || '').trim();
  if (lockedId) {
    return products.find((p) => String(p.product_id) === lockedId) || null;
  }
  const dest = String(
    (Array.isArray(businessData?.destination) ? businessData.destination[0] : businessData?.destination)
    || businessData?.primary_city
    || ''
  ).trim();
  const blob = `${message || ''} ${dest}`;
  const match = (re) => products.find((p) => re.test(`${p.destination || ''} ${p.city || ''} ${p.product_name || ''}`)) || null;
  if (/七洞|来宾/.test(blob)) return match(/七洞|来宾/);
  if (/桂林|阳朔|漓江|遇龙河/.test(blob)) return match(/桂林|阳朔/);
  if (/北海|银滩|涠洲/.test(blob)) return match(/北海/);
  if (/巴马|百色|百魔洞/.test(blob)) return match(/巴马|百色/);
  if (/防城港|东兴|嘉路/.test(blob)) return match(/防城港|东兴/);
  if (dest) {
    return products.find((p) => {
      const hay = `${p.destination || ''} ${p.city || ''} ${p.product_name || ''}`;
      return hay.includes(dest) || dest.includes(String(p.destination || p.city || ''));
    }) || null;
  }
  return null;
}

function resolveLockedDestination({ product, businessData = {}, route, message } = {}) {
  return sanitizeText(
    (Array.isArray(businessData?.destination) ? businessData.destination[0] : businessData?.destination)
    || businessData?.primary_city
    || product?.destination
    || product?.city
    || route?.destination
    || inferDestination(message)
    || ''
  );
}

async function fillRouteCard({ message, business_data }) {
  const routes = Array.isArray(business_data?.routes) ? business_data.routes : [];
  const jtd = business_data?.jtd || {};
  const product = pickLockedJtdProduct(jtd, business_data, message);

  // 旅居基地分流：product_domain=sojourn_base 时转交 fillSojournBase，使用 sojourn_base 模板
  const productDomain = jtd.product_domain || product?.product_domain || '';
  if (productDomain === 'sojourn_base') {
    return fillSojournBase({ message, business_data });
  }

  if (jtd.required === true && !product && jtd.source_status !== 'mock_vendor_data') {
    return fillRouteRemoteGap({ message, jtd, routes });
  }

  const route = selectTravelRoute(message, routes);
  // destination 优先级：锁定业务上下文 > 产品 > 路线 > 消息推断；禁止无上下文默认巴马
  const destination = resolveLockedDestination({ product, businessData: business_data, route, message });
  if (!destination) {
    return fillRouteRemoteGap({
      message,
      jtd: { ...(jtd || {}), source_status: jtd?.source_status || 'unavailable', warnings: [...(jtd?.warnings || []), 'destination_missing'] },
      routes,
    });
  }
  const budgetLevel = sanitizeText(route?.budget_level || inferBudget(message));
  const priceLabel = sanitizeText(product?.price_label || '');
  const season = sanitizeText(route?.season || inferSeason(message));
  const productName = sanitizeText(product?.product_name || '');
  // routeTitle 智能拼接：产品名已含"康养/旅居/路线/线路/行程"关键词时直接用，避免重复
  const routeTitle = (() => {
    if (!productName) return `${destination}康养旅居路线`;
    if (/(康养|旅居|路线|线路|行程)/.test(productName)) return productName;
    return `${productName}康养旅居路线`;
  })();

  // ★ 产品模板库分类：根据消息+目的地匹配产品类型（康养/滨海/文化/生态）
  const productMatch = selectProductTemplate(`${routeTitle} ${message}`, destination);
  // 未匹配时禁止静默 route_wellness（巴马样例）
  const routeType = productMatch?.id || '';
  const bookingStatus = sanitizeText(buildJtdBookingStatus(jtd, product, route));
  const healthTags = sanitizeText((Array.isArray(product?.tags) && product.tags.length ? product.tags.join(',') : '') || route?.health_tags || '慢病友好,低强度,医疗可达');

  // 从可信结构化字段、产品标题和用户输入依次提取总天数。
  // 注意：JTD routeProduct.dayNumber 表示“第几日”，不是产品总天数，不能当 duration。
  const { totalDays } = resolveTravelDuration({ product, title: productName, message, fallbackDays: 3 });

  const answerText = product
    ? (jtd.data_source === 'local_routes'
        ? `已为您匹配到${productName || destination}，本线路为防城港官方认证旅居线路。`
        : jtd.source_status === 'real_data'
        ? `已为您匹配到${productName || destination}，可继续查看详情或做可售校验。`
        : `已为您匹配到${productName || destination}（演示数据），实际可订状态请以最终核验为准。`)
    : `已为您推荐${destination}康养旅居路线，按${budgetLevel}和老人低强度出行节奏规划。`;
  const productParams = product ? {
    product_id: product.product_id,
    sku_id: product.sku_id,
    destination,
    route_id: product.product_id || business_data?.route_id || '',
    route_title: routeTitle,
    source_status: jtd.source_status,
  } : {
    destination,
    route_id: business_data?.route_id || '',
    route_title: routeTitle,
  };

  const compactFollowups = [
    {
      label: '天气风险',
      action_key: 'travel_route.check_weather_risk',
      skill_key: 'travel_route',
      params: { city: destination },
      input: {
        type: 'select',
        placeholder: '选择查询天数',
        param_key: 'days',
        options: [
          { value: '3', label: '未来3天' },
          { value: '7', label: '未来一周' },
          { value: '15', label: '未来15天' },
        ],
      },
    },
  ];

  // 先归一行程（知识库优先），供地图生成与卡片共用
  const productContentOk = !product || isSampleCompatibleWithDestination({
    destination: product.destination || product.city || '',
    routeTitle: product.product_name || '',
    highlights: product.highlights || [],
    itinerary: product.itinerary || [],
  }, destination);
  const itineraryResolved = resolveAndNormalizeItinerary({
    candidates: [
      productContentOk ? product?.itinerary : null,
      business_data?.jtd?.selected_product?.itinerary,
    ],
    routeId: product?.product_id || business_data?.route_id || '',
    productId: product?.product_id || '',
    routeTitle,
    destination,
  });
  const summary = productContentOk && product?.summary
    ? sanitizeText(product.summary)
    : (itineraryResolved.knowledge?.summary
      ? sanitizeText(itineraryResolved.knowledge.summary)
      : buildRouteCardSummary({ product: productContentOk ? product : null, productName: productContentOk ? productName : '', destination, jtd, priceLabel, budgetLevel }));
  const highlights = productContentOk && Array.isArray(product?.highlights) && product.highlights.length
    ? product.highlights
    : (itineraryResolved.knowledge?.highlights?.length
      ? itineraryResolved.knowledge.highlights
      : buildTravelHighlights(healthTags, destination));
  const suitableText = productContentOk && product?.suitable_for
    ? sanitizeText(product.suitable_for)
    : (itineraryResolved.knowledge?.suitable_for
      ? sanitizeText(itineraryResolved.knowledge.suitable_for)
      : inferTravelSuitable(message));
  const itinerary = itineraryResolved.itinerary.length
    ? itineraryResolved.itinerary
    : normalizeItineraryForRouteCard(buildItinerary(destination, totalDays));

  // 注入走线版地图数据：途经点 + Polyline 路径 + 腾讯路径规划 URL
  // 统一用 map-kit 构建地图数据（走线模式 route）
  let jtdWaypoints = Array.isArray(jtd.waypoints) && jtd.waypoints.length ? jtd.waypoints : null;
  // 丢弃与当前目的地冲突的异地途经点（例：要北海却仍是七洞乡节点）
  if (jtdWaypoints?.length && /北海|银滩|涠洲/.test(destination + message)) {
    const blob = jtdWaypoints.map((w) => w?.name || '').join(' ');
    if (/七洞|来宾/.test(blob) && !/北海|银滩|涠洲/.test(blob)) jtdWaypoints = null;
  }
  if (jtdWaypoints?.length && /七洞|来宾/.test(destination + message)) {
    const blob = jtdWaypoints.map((w) => w?.name || '').join(' ');
    if (/北海|银滩|涠洲/.test(blob) && !/七洞|来宾/.test(blob)) jtdWaypoints = null;
  }
  const mapRouteId = product?.product_id
    ? (String(product.product_id).startsWith('jtd_') ? product.product_id : `jtd_${product.product_id}`)
    : (business_data?.route_id || '');
  let routeMapData;
  let waypoints;
  if (jtdWaypoints) {
    routeMapData = buildRouteMapDataFromKit({
      destination,
      waypoints: jtdWaypoints,
      routeId: mapRouteId,
      utterance: message,
    });
    waypoints = routeMapData.waypoints || [];
  } else {
    // 无可用 jtd waypoints：按目的地模板生成，再交 map-kit（异地预制作包会被冲突检测丢弃）
    const generated = buildRouteMapData(destination, totalDays);
    routeMapData = buildRouteMapDataFromKit({
      destination,
      waypoints: generated.waypoints || [],
      routeId: mapRouteId,
      utterance: message,
    });
    // 若 kit 仍因冲突未给出途经点，回落本地生成
    waypoints = (routeMapData.waypoints && routeMapData.waypoints.length)
      ? routeMapData.waypoints
      : (generated.waypoints || []);
    if (!routeMapData.static_svg && generated.static_svg) {
      routeMapData = { ...routeMapData, ...generated, waypoints };
    }
  }

  // ★ 实时SVG生成：若 map-kit 未命中预制作资源包（static_svg 为空），用 generateRouteHtml 生成
  if (!routeMapData.static_svg && waypoints.length > 0) {
    try {
      const routeName = routeTitle || `${destination}康养旅居`;
      const genResult = await generateRouteHtml(routeName, summary || routeName, {
        waypoints: waypoints.map((wp) => ({
          name: wp.name,
          lat: wp.lat,
          lng: wp.lng,
          type: wp.type || 'spot',
          day: wp.day || '',
          plan: wp.plan || '',
          spot_images: wp.spot_images || [],
          spot_desc: wp.spot_desc || '',
        })),
        destination,
        season,
        budgetLevel,
        priceLabel,
        suitable: suitableText,
        highlights,
        itinerary: itinerary.map((it) => ({
          day: it.day || it.time || '',
          wp_name: it.wp_name || '',
          plan: it.plan || it.content || '',
        })),
        healthNotice: buildTravelHealthNotice(message),
      });
      routeMapData.static_svg = genResult.svg;
    } catch (e) {
      // 实时生成失败时保持原行为（空 SVG）
    }
  }
  // 提取所有特色景点（用于独立景点图层 + 景点列表展示）
  const allSpots = waypoints.flatMap((wp) => (wp.spots || []).map(({ source: _omit, ...s }) => ({ ...s, parent_waypoint: wp.name, parent_day: wp.day })));
  const spotImages = waypoints.flatMap((wp) => wp.spot_images || []).slice(0, 4);
  const spotStatus = waypoints.find((wp) => wp.spot_status)?.spot_status || '';

  return sanitizeModelResult({
    template_id: 'route_svg',
    answer_text: answerText,
    answer: answerText,
    data: {
      routeTitle,
      routeType,
      routeTheme: String(routeType || 'route_wellness').replace(/^route_/, '') || 'wellness',
      destination,
      season,
      budgetLevel,
      priceLabel,
      days: itineraryResolved.daysLabel
        || (/四天|4天|four/i.test(message) ? '4天3晚' : `${totalDays}天${totalDays - 1}晚`),
      suitable: suitableText,
      bookingStatus,
      summary,
      highlights,
      itinerary,
      itinerary_raw: itineraryResolved.raw || [],
      itinerary_source: itineraryResolved.knowledge?.source || (productContentOk ? 'product' : 'generated'),
      healthNotice: buildTravelHealthNotice(message),
      jtdStatus: jtd.source_status || '',
      dataSource: jtd.data_source || '',
      productId: product?.product_id || '',
      skuId: product?.sku_id || '',
      comboPrice: jtd.combo_price || '',
      discount: jtd.discount || '',
      ...routeMapData,
      // Tavily 特色景点图层（独立 JSON + 图层数据）
      spots_json: JSON.stringify(allSpots),
      spots: allSpots,
      spot_images: spotImages,
      spot_images_json: JSON.stringify(spotImages),
      spot_status: spotStatus,
      hasSpots: allSpots.length > 0 || waypoints.some((wp) => (wp?.spot_images || []).length > 0 || (wp?.spot_desc || '').length > 0),
      waypoint_spots_json: JSON.stringify(enrichWaypointsFromDashboardKb(waypoints || []).map((wp) => ({
        name: wp?.name || '',
        day: wp?.day || '',
        plan: wp?.plan || '',
        spot_desc: wp?.spot_desc || '',
        spot_images: Array.isArray(wp?.spot_images) ? wp.spot_images : [],
        related_spots: Array.isArray(wp?.related_spots) ? wp.related_spots : [],
      }))),
    },
    // 只保留追问层；天气用 compact（带天数选择），避免与 followups / 模板按钮重复
    actions: [],
    followup_suggestions: [
      {
        label: '查看每日日程',
        user_prompt: `请按天展示${destination}「${routeTitle}」的详细行程安排`,
        action_key: 'travel_route.view_detail',
        skill_key: 'travel_route',
        params: { ...productParams, template_id: 'travel_itinerary_card' },
      },
      {
        label: '查看产品详情',
        user_prompt: `请展示${destination}这条旅居产品的详细信息`,
        action_key: 'travel_route.view_product_detail',
        skill_key: 'travel_route',
        params: productParams,
      },
      ...(product ? [{
        label: '检查可订',
        user_prompt: '请检查这条旅居路线近期是否可预订',
        action_key: 'travel_route.check_availability',
        skill_key: 'travel_route',
        params: productParams,
      }] : []),
      {
        label: '测算预算',
        user_prompt: '请按当前预算档测算这条旅居路线费用',
        action_key: 'travel_route.calculate_budget',
        skill_key: 'travel_route',
        params: { ...productParams, budget_level: budgetLevel },
      },
      {
        label: '重新规划路线',
        // 文案必须带目的地：避免「海边/海滨」宽词或默认包把七洞乡等改成北海
        user_prompt: `请按老人低强度节奏重新规划${destination}这条旅居路线`,
        action_key: 'travel_route.replan',
        skill_key: 'travel_route',
        params: productParams,
      },
    ],
    compact_followups: withEntityParams(compactFollowups, productParams),
    template_fit_notes: [
      ...(product ? [`jtd_${jtd.source_status || 'unknown'}`] : []),
      ...(itineraryResolved.knowledge?.source ? [`itinerary_from_${itineraryResolved.knowledge.source}`] : []),
    ],
  });
}

function fillTravelAvailabilityCard({ message, business_data }) {
  const routes = Array.isArray(business_data?.routes) ? business_data.routes : [];
  const jtd = business_data?.jtd || {};
  const product = pickLockedJtdProduct(jtd, business_data, message);
  const route = selectTravelRoute(message, routes);
  const normalized = jtd.availability?.normalized || null;
  const destination = resolveLockedDestination({ product, businessData: business_data, route, message }) || '旅居目的地';
  const productName = sanitizeText(product?.product_name || product?.name || `${destination}旅居产品`);
  const productId = sanitizeText(product?.product_id || '');
  const skuId = sanitizeText(product?.sku_id || '');
  const stockValue = normalized?.stock ?? product?.stock ?? null;
  const priceValue = normalized?.final_price ?? product?.price_amount ?? null;
  const sourceStatus = normalized?.source_status || jtd.source_status || 'unavailable';
  const isMock = sourceStatus === 'mock_vendor_data';
  const hasAvailability = Boolean(jtd.availability);
  const isAvailable = Boolean(normalized?.available);
  const availabilityLevel = !hasAvailability || sourceStatus === 'unavailable'
    ? 'unknown'
    : isMock
    ? 'mock'
    : isAvailable
    ? 'available'
    : 'unavailable';
  const availabilityStatus = availabilityStatusText({ hasAvailability, isAvailable, isMock, sourceStatus });
  const availabilityMessage = availabilityMessageText({ hasAvailability, isAvailable, isMock, sourceStatus, jtd });
  const checkWindow = buildAvailabilityWindow(jtd.availability?.request || {}, message);
  const answerText = `${productName}：${availabilityStatus}`;
  const productParams = {
    product_id: productId,
    sku_id: skuId,
    destination,
    source_status: sourceStatus,
  };

  return sanitizeModelResult({
    template_id: 'travel_availability_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      availabilityTitle: `${destination}旅居产品可订状态`,
      availabilityStatus,
      availabilityLevel,
      availabilityMessage,
      stockLabel: stockValue === null || stockValue === undefined || stockValue === '' ? '待接口确认' : String(stockValue),
      priceLabel: priceValue ? `约${priceValue}元/人` : sanitizeText(product?.price_label || '待接口确认'),
      checkWindow,
      sourceLabel: jtd.data_source === 'local_routes'
        ? '官方认证线路'
        : sourceStatus === 'real_data'
        ? '已核验数据'
        : sourceStatus === 'mock_vendor_data'
        ? '演示数据'
        : '数据待确认',
      productName,
      destination,
      productId: productId || '待接口返回',
      skuId: skuId || '待接口返回',
      nextStep: nextAvailabilityStep({ hasAvailability, isAvailable, isMock, sourceStatus, jtd }),
      jtdStatus: jtd.source_status || '',
      availabilitySourceStatus: sourceStatus,
      availabilityAvailable: isAvailable,
      availabilityRaw: normalized?.raw || {},
      handoffUrls: {
        h5_order_url: normalized?.h5_order_url || product?.handoff_urls?.h5_order_url || '',
        h5_product_url: normalized?.h5_product_url || product?.handoff_urls?.h5_product_url || '',
        mini_program_url: normalized?.mini_program_url || product?.handoff_urls?.mini_program_url || '',
      },
    },
    actions: [],
    followup_suggestions: [
      ...(product ? [{
        label: '查看产品详情',
        user_prompt: '请展示这条旅居产品的详细信息',
        action_key: 'travel_route.view_product_detail',
        skill_key: 'travel_route',
        params: productParams,
      }] : []),
      ...(isAvailable && jtd.handoff_enabled ? [{
        label: '继续预订',
        user_prompt: '我想继续预订这条旅居产品',
        action_key: 'travel_route.booking_handoff',
        skill_key: 'travel_route',
        params: {
          ...productParams,
          h5_order_url: normalized?.h5_order_url || product?.handoff_urls?.h5_order_url || '',
          h5_product_url: normalized?.h5_product_url || product?.handoff_urls?.h5_product_url || '',
        },
      }] : []),
      {
        label: '人工复核',
        user_prompt: '请帮我人工复核这条旅居可订结果',
        action_key: 'travel_route.request_manual_review',
        skill_key: 'travel_route',
        params: { ...productParams, reason: isMock ? 'jtd_mock_availability' : 'jtd_availability_review' },
      },
      {
        label: '换个日期再查',
        user_prompt: '请换一个入住日期重新查询这条旅居产品是否可订',
        action_key: 'travel_route.check_availability',
        skill_key: 'travel_route',
        params: productParams,
      },
      {
        label: '查看路线详情',
        user_prompt: '请展示这条旅居路线的详细安排',
        action_key: 'travel_route.view_detail',
        skill_key: 'travel_route',
        params: productParams,
      },
    ],
    template_fit_notes: ['jtd_availability_result'],
  });
}

function availabilityStatusText({ hasAvailability, isAvailable, isMock, sourceStatus }) {
  if (!hasAvailability) return '未完成可订校验';
  if (isMock) return isAvailable ? '演示数据，显示可订' : '演示数据，显示不可订';
  if (sourceStatus === 'unavailable') return '可订校验暂不可用';
  return isAvailable ? '已校验可订' : '已校验当前不可订';
}

function availabilityMessageText({ hasAvailability, isAvailable, isMock, sourceStatus, jtd }) {
  if (!hasAvailability) return '本次响应没有取得可订校验结果，请补充入住日期、人数后重新查询。';
  if (isMock) return '当前结果为演示数据，仅用于流程预览，不作为正式下单或库存承诺。';
  if (sourceStatus === 'unavailable') return `可订校验暂不可用：${jtd.availability?.error || '未返回有效结果'}。`;
  return isAvailable
    ? '已取得可订校验结果，请在继续预订前再次核对入住日期、人数和最终价格。'
    : '已取得校验结果，当前日期或库存暂不支持预订。';
}

function nextAvailabilityStep({ hasAvailability, isAvailable, isMock, sourceStatus, jtd }) {
  if (!hasAvailability) return '请补充入住日期、离店日期和人数后重新查询，避免只展示路线信息。';
  if (isMock) return '请切换到真实环境或请求人工复核，演示数据不可作为真实可订依据。';
  if (sourceStatus === 'unavailable') return '请稍后重试或联系人工复核，必要时检查接口配置与网络连通性。';
  if (isAvailable && jtd.handoff_enabled) return '可继续进入预订跳转，并在下单页确认最终价格与库存。';
  if (isAvailable) return '接口显示可订，但未返回可用预订跳转地址，请先人工确认后再下单。';
  return '建议更换入住日期、减少人数或选择其他旅居产品。';
}

function buildAvailabilityWindow(requestPayload = {}, message = '') {
  const checkIn = requestPayload.checkIn || requestPayload.check_in || '';
  const checkOut = requestPayload.checkOut || requestPayload.check_out || '';
  if (checkIn && checkOut) return `${checkIn} 至 ${checkOut}`;
  const text = String(message || '');
  const dateMatch = text.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g);
  if (Array.isArray(dateMatch) && dateMatch.length >= 2) return `${dateMatch[0]} 至 ${dateMatch[1]}`;
  if (Array.isArray(dateMatch) && dateMatch.length === 1) return dateMatch[0];
  return '待确认入住日期';
}

export function fillTravelH5EmbedCard({ message, business_data } = {}) {
  const jtd = business_data?.jtd || {};
  const product = pickLockedJtdProduct(jtd, business_data, message) || {};
  const availability = jtd.availability?.normalized || {};
  const handoffUrls = product.handoff_urls || {};
  const dataSource = jtd.data_source || jtd.source_status || '';

  // H5 URL：优先使用金跳动提供的下单页 URL
  //（不再用 iframe 内嵌，改为新标签页打开 → 用户可先登录再下单）
  let h5Url = availability.h5_order_url
    || handoffUrls.h5_order_url
    || availability.h5_product_url
    || handoffUrls.h5_product_url
    || '';

  // 确保 hash 路由格式
  if (h5Url && !h5Url.includes('#/pages/')) {
    h5Url = h5Url.replace(/\/h5\/pages\//, '/h5/#/pages/');
  }

  const productName = sanitizeText(product.product_name || inferDestination(message) || '旅居产品');
  const destination = sanitizeText(product.destination || product.city || business_data?.primary_city || '');
  const priceLabel = product.price_label || (product.price_amount ? `约${product.price_amount}元/人` : '');
  const productId = product.product_id || '';

  // 场景1：无 H5 URL — 友好降级提示（区分原因）
  if (!h5Url) {
    // 判断原因：本地线路（防城港5条）没有金跳动产品ID
    const isLocalRoute = productId.startsWith('fcg_') || dataSource === 'local_routes';
    // 判断原因：可订校验未通过
    const isUnavailable = availability && availability.available === false;

    let reasonText = '';
    let answerText = '';

    if (isLocalRoute) {
      reasonText = '官方认证线路';
      answerText = `${productName}是官方推荐的旅居线路，目前尚未接入在线预订系统。`;
    } else if (isUnavailable) {
      reasonText = '当前日期不可订';
      answerText = `${productName}在您选择的日期暂不可预订。建议更换入住日期或减少出行人数后重试。`;
    } else {
      reasonText = '暂未开放在线预订';
      answerText = `${productName}暂时无法提供在线预订页面。您可以联系旅居顾问（400-xxx-xxxx）获取最新报价和预订信息。`;
    }

    return {
      template_id: 'travel_h5_embed_card',
      answer_text: answerText,
      data: {
        h5Url: '',
        productName,
        destination,
        priceLabel,
        productId,
        hasH5Url: false,
        reasonText,
        isLocalRoute,
        isUnavailable,
      },
      actions: [],
    };
  }

  // 场景2：有 H5 URL — 正常嵌入
  return {
    template_id: 'travel_h5_embed_card',
    answer_text: `正在为您加载${productName}的预订页面，请在页面内确认入住日期、人数和价格后完成下单。`,
    data: {
      h5Url,
      productName,
      destination,
      priceLabel,
      productId,
      hasH5Url: true,
    },
    actions: [],
    followup_suggestions: [
      {
        label: '在新页面打开',
        user_prompt: '请在新页面打开预订页面',
        action_key: 'travel_route.open_h5_external',
        skill_key: 'travel_route',
        params: { h5_url: h5Url, product_id: productId },
      },
    ],
  };
}

async function fillTravelItineraryCard({ message, business_data }) {
  let routeResult;
  try {
    routeResult = await fillRouteCard({ message, business_data });
  } catch (e) {
    console.error('[fillTravelItineraryCard] fillRouteCard 调用失败，降级返回基础行程:', e?.message || e);
    const destination = sanitizeText(inferDestination(message) || '旅居目的地');
    const fallbackDays = 3;
    const days = buildItinerary(destination, fallbackDays).map((item, index) => buildItineraryDay(item, index, destination, fallbackDays));
    return sanitizeModelResult({
      template_id: 'travel_itinerary_card',
      answer_text: `已为您生成${destination}行程安排建议。`,
      answer: `已为您生成${destination}行程安排建议。`,
      data: {
        title: `${destination}行程安排`,
        intro: '按低强度、少赶路、每日留足休息时间来安排，适合长者和家属陪同出行。',
        days,
        note: '行程可随身体状态、天气和可订日期灵活调整；下单前请继续做可售校验。',
        destination,
      },
      actions: [],
      followup_suggestions: [],
      template_fit_notes: ['travel_itinerary_card_fallback'],
    });
  }
  const routeData = routeResult.data || {};
  const destination = sanitizeText(routeData.destination || inferDestination(message));
  const productName = sanitizeText(String(routeData.routeTitle || '').replace(/康养旅居路线$/, '')) || destination;

  const product = pickLockedJtdProduct(business_data?.jtd || {}, business_data, message);
  const { totalDays } = resolveTravelDuration({
    product,
    title: `${routeData.routeTitle || ''} ${productName}`,
    message,
    fallbackDays: 3,
  });

  // 优先用知识库原始日程再归一，避免主卡摘要字段二次拆坏；其次用主卡已归一的 itinerary
  const rawItinerary = Array.isArray(routeData.itinerary_raw) && routeData.itinerary_raw.length
    ? routeData.itinerary_raw
    : (Array.isArray(routeData.itinerary) && routeData.itinerary.length
      ? routeData.itinerary
      : buildItinerary(destination, totalDays));
  const days = normalizeItineraryForDetailCard(rawItinerary, { destination });
  // 若归一结果空，再兜底
  const dayCards = days.length
    ? days
    : buildItinerary(destination, totalDays).map((item, index) => buildItineraryDay(item, index, destination, totalDays));
  const sourceText = routeData.itinerary_source === 'fangchenggang_routes'
    || routeData.itinerary_source === 'dashboard_travel_routes'
    ? '来源：本地知识库完整日程'
    : routeData.dataSource === 'local_routes'
    ? '来源：官方认证线路'
    : routeData.jtdStatus === 'real_data'
    ? '来源：已核验数据'
    : routeData.jtdStatus === 'mock_vendor_data'
      ? '来源：演示数据'
      : '来源：本地行程建议';

  return sanitizeModelResult({
    ...routeResult,
    template_id: 'travel_itinerary_card',
    data: {
      title: `${productName}行程安排`,
      intro: `${sourceText}。按低强度、少赶路、每日留足休息时间来安排，适合长者和家属陪同出行。`,
      days: dayCards,
      note: '行程可随身体状态、天气和可订日期灵活调整；下单前请继续做可售校验。',
      routeTitle: routeData.routeTitle,
      destination,
      season: routeData.season,
      budgetLevel: routeData.budgetLevel,
      priceLabel: routeData.priceLabel || '',
      suitable: routeData.suitable,
      bookingStatus: routeData.bookingStatus,
      jtdStatus: routeData.jtdStatus || '',
      productId: routeData.productId || '',
      skuId: routeData.skuId || '',
    },
    template_fit_notes: [...(routeResult.template_fit_notes || []), 'travel_itinerary_card_selected'],
  });
}

function inferWeatherRiskTips(forecasts = [], current = {}) {
  const join = (f) => `${f.weather || ''} ${f.nightWeather || ''} ${f.dayWeather || ''}`;
  const allText = forecasts.map(join).join(' ') + ' ' + (current.weather || '');
  const hasRain = /雨|雪|雷|阵|暴雨|中雨|大雨|雨夹雪/.test(allText);
  const hasHot = forecasts.some((f) => (f.tempDay != null && f.tempDay >= 33) || (f.dayTemp != null && f.dayTemp >= 33));
  const hasCold = forecasts.some((f) => (f.tempNight != null && f.tempNight <= 12) || (f.nightTemp != null && f.nightTemp <= 12));
  const hasStrongWind = /(7|8|9|10|11|12)级|大风|暴风|台风/.test(forecasts.map((f) => f.wind || '').join(' '));
  const hasHaze = /霾|雾|沙尘|扬沙|浮尘/.test(allText);
  const tips = [];
  if (hasRain) tips.push('有降雨/雷雨：地面湿滑，外出备好防滑鞋与雨具，避免山区、临水与陡坡活动。');
  if (hasHot) tips.push('高温天气：注意补水、防中暑，避开正午暴晒，把户外安排放在早晚凉爽时段。');
  if (hasCold) tips.push('昼夜温差大或夜间偏凉：备好外套，留意长者心脑血管与呼吸道不适。');
  if (hasStrongWind) tips.push('风力较大：减少高处、临海与空旷地带活动，固定好遮阳伞等随身物品。');
  if (hasHaze) tips.push('有雾/霾/沙尘：呼吸道敏感长者减少户外活动，必要时佩戴口罩。');
  if (!tips.length) tips.push('未来几天天气总体平稳，可按原行程轻量出行；仍建议每日关注实时预报并留足休息。');
  return tips;
}

// 天气风险研判：结合上下文（目的地城市）+ 腾讯天气接口结果，输出长者旅居风险提示卡片
export async function fillTravelWeatherRiskCard({ message, business_data, weatherService } = {}) {
  // 打印完整的 selected_product 数据
  const selectedProduct = business_data?.jtd?.selected_product;
  console.log('[WeatherRiskCard] selected_product 详情:', JSON.stringify(selectedProduct, null, 2));

  console.log('[WeatherRiskCard] 输入参数:', {
    message: message?.slice(0, 100),
    business_data_keys: business_data ? Object.keys(business_data) : [],
    jtd: business_data?.jtd ? Object.keys(business_data.jtd) : [],
    selected_product: selectedProduct ? 'present' : 'missing',
  });

  // 从消息或业务数据中提取城市（多种来源；含上一轮锁定的 primary_city）
  const fromMessage = inferDestination(message || '');
  const fromJtdProduct = business_data?.jtd?.selected_product?.destination
    || business_data?.jtd?.selected_product?.city;
  const fromJtdRoute = business_data?.jtd?.route?.destination;
  const fromBusinessData = business_data?.destination
    || business_data?.primary_city
    || business_data?.city;
  const fromProductName = business_data?.jtd?.selected_product?.name
    || business_data?.jtd?.selected_product?.product_name;

  // 从产品名称中提取目的地
  let fromProductExtract = null;
  if (fromProductName) {
    // 常见格式: "广西北海康养旅居三日体验" -> 提取 "广西北海"
    // 或: "0730测试旅居路线5天4日游" -> 需要其他方式
    const match = fromProductName.match(/(广西|云南|海南|福建|四川|浙江|江苏|广东|北京|上海)[^\s]*(市|州|县|地区|北海|桂林|巴马|昆明|大理|丽江|三亚|海口|厦门)/);
    if (match) {
      fromProductExtract = match[0];
    } else {
      // 尝试匹配城市名
      const cityMatch = fromProductName.match(/(防城港|东兴|北海|桂林|巴马|昆明|大理|丽江|三亚|海口|厦门|巴马瑶族)/);
      if (cityMatch) {
        // 根据城市名补全省份
        const cityProvinceMap = {
          '防城港': '广西防城港', '东兴': '广西东兴',
          '北海': '广西北海', '桂林': '广西桂林', '巴马': '广西巴马', '巴马瑶族': '广西巴马',
          '昆明': '云南昆明', '大理': '云南大理', '丽江': '云南丽江',
          '三亚': '海南三亚', '海口': '海南海口',
          '厦门': '福建厦门',
        };
        fromProductExtract = cityProvinceMap[cityMatch[0]] || cityMatch[0];
      }
    }
  }

  // 优先级: 消息 > 产品目的地 > 路线目的地 > 产品名称提取 > 业务数据
  const cityName = sanitizeText(
    fromMessage
    || fromJtdProduct
    || fromJtdRoute
    || fromProductExtract
    || fromBusinessData
    || null
  );

  console.log('[WeatherRiskCard] 城市提取结果:', {
    fromMessage,
    fromJtdProduct,
    fromJtdRoute,
    fromProductExtract,
    fromBusinessData,
    cityName
  });

  // 如果没有提取到城市，提示用户
  if (!cityName || cityName === '目的地') {
    const answerText = `### 天气风险查询\n\n抱歉，我无法确定您要查询的目的地城市。请问您想查询哪个城市的天气？例如：\n\n- 广西北海\n- 云南昆明\n- 海南三亚\n\n您也可以直接说出城市名，如"北海天气如何"。`;
    return sanitizeModelResult({
      template_id: 'travel_weather_risk_card',
      answer_text: answerText,
      answer: answerText,
      data: {
        city: '',
        ok: false,
        degraded: true,
        degradedNote: '请指定查询的目的地城市',
        currentWeather: '',
        forecasts: [],
        riskTips: [{ text: '请提供目的地城市名称' }],
      },
      actions: [],
      followup_suggestions: [
        { text: '查询北海天气', action_key: 'travel_route.check_weather_risk', skill_key: 'travel_route', params: { city: '广西北海' } },
        { text: '查询昆明天气', action_key: 'travel_route.check_weather_risk', skill_key: 'travel_route', params: { city: '云南昆明' } },
        { text: '查询三亚天气', action_key: 'travel_route.check_weather_risk', skill_key: 'travel_route', params: { city: '海南三亚' } },
      ],
      template_fit_notes: ['missing_destination'],
    });
  }

  let weather = null;
  let ok = false;

  // 调用天气服务获取实时天气
  if (weatherService) {
    try {
      // 兼容不同的方法名：getWeatherByCity 或 getWeather
      const getWeatherFn = weatherService.getWeatherByCity || weatherService.getWeather;
      if (typeof getWeatherFn === 'function') {
        weather = await getWeatherFn.call(weatherService, cityName);
        ok = weather && weather.ok;
        console.log('[WeatherRiskCard] 天气服务调用结果:', { city: cityName, ok, source: weather?.source, error: weather?.error });
      } else {
        console.error('[WeatherRiskCard] 天气服务没有 getWeather 或 getWeatherByCity 方法');
      }
    } catch (error) {
      console.error('[WeatherRiskCard] 天气服务调用失败:', error.message);
    }
  } else {
    console.log('[WeatherRiskCard] 天气服务未配置');
  }

  const current = (weather && weather.current) || {};
  const forecasts = Array.isArray(weather?.forecasts) ? weather.forecasts : [];
  const tips = inferWeatherRiskTips(forecasts, current);

  const lines = [`### ${cityName} 旅居天气风险研判`];
  if (!ok) {
    lines.push('> 暂未获取到该城市的实时天气（未配置腾讯天气接口或接口异常）。建议出行前关注当地气象预报，或稍后重试。');
  } else {
    lines.push(`**当前**：${current.weather || '—'}，${current.temp != null ? current.temp + '℃' : '—'}${current.windDir ? '，' + current.windDir + (current.windPower || '') : ''}。`);
    if (forecasts.length) {
      lines.push('', '**未来几天：**', '| 日期 | 天气 | 温度 | 风 |', '| --- | --- | --- | --- |');
      for (const f of forecasts.slice(0, 5)) {
        const w = f.weather || '—';
        const t = `${f.tempDay != null ? f.tempDay + '°' : '—'}/${f.tempNight != null ? f.tempNight + '°' : '—'}`;
        lines.push(`| ${f.date || f.week || '—'} | ${w} | ${t} | ${f.wind || '—'} |`);
      }
    }
    lines.push('', '**长者风险提示：**');
    for (const t of tips) lines.push(`- ${t}`);
    if (weather?.updatedAt) lines.push(`\n_数据来源：腾讯天气（${weather.updatedAt}）_`);
  }
  const answerText = lines.join('\n');

  return sanitizeModelResult({
    template_id: 'travel_weather_risk_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      city: cityName,
      ok,
      degraded: !ok,
      currentWeather: current.weather || '',
      currentTemp: current.temp != null ? String(current.temp) : '',
      currentWind: [current.windDir, current.windPower].filter(Boolean).join(' ') || '',
      currentHumidity: current.humidity || '',
      currentFeel: current.feelTemp != null ? String(current.feelTemp) : '',
      updatedAt: weather?.updatedAt || '',
      forecasts: forecasts.slice(0, 5).map((f) => ({
        date: f.date || f.week || '',
        weather: f.weather || '',
        nightWeather: f.nightWeather || '',
        tempDay: f.tempDay != null ? String(f.tempDay) : '',
        tempNight: f.tempNight != null ? String(f.tempNight) : '',
        wind: f.wind || '',
      })),
      riskTips: tips.map((t) => ({ text: t })),
      degradedNote: ok ? '' : '暂未获取到实时天气，以下为通用提醒，请以当地实际预报为准。',
    },
    actions: [],
    followup_suggestions: [
      {
        label: '调整行程避开恶劣天气',
        user_prompt: '请帮我调整行程避开恶劣天气',
        action_key: 'travel_route.replan',
        skill_key: 'travel_route',
        params: { destination: cityName },
      },
      {
        label: '查看可订状态',
        user_prompt: '请检查这条旅居路线近期是否可预订',
        action_key: 'travel_route.check_availability',
        skill_key: 'travel_route',
        params: { destination: cityName, city: cityName },
      },
      {
        label: '查看天气风险',
        user_prompt: `请查看${cityName}旅居天气风险`,
        action_key: 'travel_route.check_weather_risk',
        skill_key: 'travel_route',
        params: { destination: cityName, city: cityName },
      },
    ],
    model_used: 'flatTalk.travel.weather',
    model_status: ok ? 'ok' : 'degraded',
    template_fit_notes: ['travel_weather_risk'],
  });
}

function buildItineraryDay(item = {}, index = 0, destination = '', totalDays = 3) {
  // 优先走统一归一化（保留知识库 theme / 小时制 slots / Excel plan）
  const [normalized] = normalizeItineraryForDetailCard([item], { destination });
  if (normalized?.slots?.length) {
    return {
      ...normalized,
      day: sanitizeText(normalized.day || item.day || `D${index + 1}`),
      theme: sanitizeText(normalized.theme || item.theme || ''),
    };
  }

  const day = sanitizeText(item.day || `D${index + 1}`);
  const planValue = item.plan;
  const planText = typeof planValue === 'string'
    ? planValue
    : (planValue && typeof planValue === 'object' && planValue.text)
      ? planValue.text
      : '';
  const plan = sanitizeText(planText);
  const isLastDay = index === totalDays - 1;
  const theme = sanitizeText(item.theme) || (index === 0
    ? `抵达${destination || '目的地'}`
    : isLastDay
      ? '轻松返程'
      : `第${index + 1}天康养体验`);

  let slots = [];
  if (index === 0) {
    slots = [
      { time: '上午', text: `抵达${destination || '目的地'}，办理入住，熟悉周边环境。` },
      { time: '下午', text: plan || '完成健康情况确认，安排轻松周边散步。' },
      { time: '傍晚', text: '基地或酒店附近慢行，早些休息。' },
    ];
  } else if (isLastDay) {
    slots = [
      { time: '上午', text: plan || '根据体力选择短途游览或返程。' },
      { time: '下午', text: '预留交通缓冲，避免赶行程。' },
    ];
  } else {
    slots = [
      { time: '上午', text: '参加康养活动或基地体验，控制步行强度。' },
      { time: '下午', text: plan || '低强度游览，保留午休和补水时间。' },
      { time: '傍晚', text: '清淡晚餐后休息，确认次日安排。' },
    ];
  }

  return {
    day,
    theme,
    slots,
    tip: '贴心提示：如老人血压、血糖波动或天气不适合外出，当天行程可改为基地内休整。',
  };
}

function fillRouteRemoteGap({ message, jtd, routes }) {
  const route = selectTravelRoute(message, routes);
  const destination = sanitizeText(route?.destination || inferDestination(message));
  const answerText = '金跳动旅居产品接口当前不可用，已停止生成可订产品推荐，可先保留需求并转人工确认。';
  // ★ 兜底也尝试加载预制作 SVG
  const svgPkg = findPrebuiltPackageByDestination(destination, 'standard');
  const staticSvg = (svgPkg && svgPkg.svg) ? svgPkg.svg : '';
  return sanitizeModelResult({
    template_id: 'route_svg',
    answer_text: answerText,
    answer: answerText,
    data: {
      routeTitle: `${destination}旅居产品待确认`,
      destination,
      season: sanitizeText(route?.season || inferSeason(message)),
      budgetLevel: '价格待真实接口确认',
      days: /四天|4天|four/i.test(message) ? '4天3晚' : '3天2晚',
      suitable: inferTravelSuitable(message),
      bookingStatus: '金跳动接口不可用，暂不可预订',
      summary: `未取得 JTD searchProducts 返回的 product_id，不能使用本地知识或表数据替代真实产品。状态=${jtd.source_status || 'unavailable'}。`,
      highlights: ['待接口恢复', '不生成订单', '需人工确认'],
      itinerary: buildItinerary(destination),
      healthNotice: buildTravelHealthNotice(message),
      jtdStatus: jtd.source_status || 'unavailable',
      productId: '',
      skuId: '',
      static_svg: staticSvg,
      waypoint_spots_json: JSON.stringify((svgPkg?.routeData?.waypoints || []).map((wp) => ({
        name: wp?.name || '',
        day: wp?.day || '',
        plan: wp?.plan || '',
        spot_desc: wp?.spot_desc || '',
        spot_images: Array.isArray(wp?.spot_images) ? wp.spot_images : [],
      }))),
    },
    actions: [],
    followup_suggestions: [
      {
        label: '请求人工复核',
        user_prompt: '请帮我人工复核这条旅居路线',
        action_key: 'travel_route.request_manual_review',
        skill_key: 'travel_route',
        params: { reason: 'jtd_unavailable', destination },
      },
      {
        label: '重新规划路线',
        user_prompt: `请重新规划${destination || '当前'}这条旅居路线`,
        action_key: 'travel_route.replan',
        skill_key: 'travel_route',
        params: { destination },
      },
      {
        label: '补充出行偏好',
        user_prompt: '我先补充出行日期、人数和预算，等接口恢复后再校验可订状态',
        action_key: 'travel_route.fill_preferences',
        skill_key: 'travel_route',
      },
    ],
    template_fit_notes: ['jtd_remote_gap'],
  });
}

function buildJtdBookingStatus(jtd, product, route) {
  if (!product) return route?.booking_status || '可咨询余量';
  if (jtd.availability?.normalized?.available) return '已校验可订';
  if (jtd.availability && !jtd.availability.normalized?.available) return '已校验，当前日期不可订';
  if (jtd.source_status === 'real_data') return '已返回真实产品，待日期可售校验';
  if (jtd.source_status === 'mock_vendor_data') return '演示数据，不能视为真实可订';
  return '数据状态待确认';
}

function fillSojournBase({ message, business_data }) {
  const jtd = business_data?.jtd || {};
  const selected = jtd.selected_product || null;
  const destHint = resolveLockedDestination({
    product: selected,
    businessData: business_data,
    message,
  }) || inferDestination(message) || '';

  let rawProducts = (Array.isArray(jtd.products) ? jtd.products : []).slice(0, 3);
  // 会话里只有线路产品 / 空列表时，按目的地回填参考康养基地，避免城市与地图全空
  if (!rawProducts.length) {
    const refs = listReferenceTravelProducts();
    const matched = selectProduct(refs, message, {
      params: {
        product_id: business_data?.product_id || selected?.product_id || '',
        destination: destHint,
      },
    });
    rawProducts = matched ? [matched] : refs.filter((p) => {
      if (!destHint) return false;
      const hay = `${p.destination || ''} ${p.city || ''} ${p.product_name || ''}`;
      return hay.includes(String(destHint).replace(/^广西/, '')) || String(destHint).includes(p.city || '');
    }).slice(0, 3);
  }
  if (selected && !rawProducts.some((p) => p.product_id && p.product_id === selected.product_id)) {
    rawProducts = [selected, ...rawProducts].slice(0, 3);
  }

  const bases = rawProducts.map((p, index) => {
    const location = sanitizeText(p.destination || p.city || destHint || '防城港') || '防城港';
    const cityShort = location.replace(/^广西/, '');
    const featureList = Array.isArray(p.tags) && p.tags.length
      ? p.tags
      : (p.features || ['慢病友好', '适老康养', '医疗可达']);
    const facts = [];
    for (let i = 0; i < featureList.length; i += 2) {
      facts.push({ label: featureList[i] || '配套', value: featureList[i + 1] || featureList[i] || '—' });
    }
    const priceNum = Number(p.price_amount);
    const priceText = p.price_label
      || (Number.isFinite(priceNum) && priceNum > 0 ? `${priceNum}` : '')
      || (p.price != null ? String(p.price) : '')
      || '面议';
    return {
      cardCls: index === 0 ? 'primary' : '',
      badge: index === 0 ? '⭐ 首选推荐' : '',
      name: p.product_name || p.name || p.title || `${cityShort}康养基地`,
      sub: `${cityShort} · 旅居康养`,
      location: cityShort,
      address: p.address || `广西${cityShort}`,
      reason: `<b>推荐理由:</b> 位于${cityShort}，适合慢病友好与适老康养场景；价格与房态以金跳动实时校验为准。`,
      features: featureList,
      facts: facts.length ? facts : [
        { label: '目的地', value: cityShort },
        { label: '适配', value: '适老康养' },
      ],
      price: String(priceText).replace(/^约/, '').replace(/元.*$/, '') || '面议',
      priceUnit: /面议/.test(String(priceText)) ? '' : '/人起（参考）',
      totalNote: Number.isFinite(priceNum) && priceNum > 0 ? `参考价约 ¥${priceNum}/人` : '',
      rating: '4.8/5.0',
      product_id: p.product_id || '',
      stock: p.stock ?? null,
    };
  });

  const finalBases = bases.length
    ? bases
    : [{
      cardCls: 'primary',
      badge: '⭐ 首选推荐',
      name: `${(destHint || '防城港').replace(/^广西/, '')}滨海康养中心`,
      sub: `${(destHint || '防城港').replace(/^广西/, '')} · 旅居康养`,
      location: (destHint || '防城港').replace(/^广西/, ''),
      address: `广西${(destHint || '防城港').replace(/^广西/, '')}`,
      reason: '<b>推荐理由:</b> 适老康养配套完善，具体房态以预订页为准。',
      features: ['慢病康复', '海滨气候'],
      facts: [
        { label: '目的地', value: (destHint || '防城港').replace(/^广西/, '') },
        { label: '适配', value: '适老康养' },
      ],
      price: '面议',
      priceUnit: '',
      product_id: '',
      stock: null,
    }];

  const primaryDest = destHint || finalBases[0]?.location || finalBases[0]?.address || '防城港';
  const mapData = buildBaseMapDataFromKit({ destination: primaryDest, bases: finalBases });
  const sourceStatus = jtd.source_status || (jtd.ok ? 'real_data' : 'fallback');
  const cityLabel = sanitizeText(mapData.centerName || primaryDest.replace(/^广西/, '')) || '目的地';
  const answerText = sourceStatus === 'real_data'
    ? `已为您推荐 ${finalBases.length} 个${cityLabel}康养基地。`
    : `为您推荐以下${cityLabel}康养基地`;

  return sanitizeModelResult({
    template_id: 'sojourn_base',
    answer_text: answerText,
    data: {
      title: '旅居康养基地推荐',
      intro: `<div class="why-title">⏳ 为什么优先推荐康养基地而非普通酒店？</div><ul class="why-list"><li>① 三餐与适老餐饮更省心</li><li>② 周边医疗配套更近</li><li>③ 电梯/无障碍更安心</li></ul><div class="pick-line">为您精选${finalBases.length}套${cityLabel}方案:</div>`,
      bases: finalBases,
      note: `以上价格仅供参考，${cityLabel}门店实时为准。已自动过滤无电梯、远离医疗机构、无食堂的住宿。`,
      jtdStatus: sourceStatus,
      ...mapData,
      // 模板字段是 static_map_img；map-kit 产出 static_map_url
      static_map_img: mapData.static_map_url || '',
      centerName: cityLabel,
    },
    actions: [],
    followup_suggestions: withEntityParams([
      { label: '去预订', user_prompt: '我想继续预订这条旅居产品', action_key: 'travel_route.booking_handoff' },
      { label: '查看路线', user_prompt: '请规划这条旅居路线', action_key: 'travel_route.replan', params: { template_id: 'sojourn_route' } },
    ], {
      destination: primaryDest,
      product_id: finalBases[0]?.product_id || '',
    }),
    template_fit_notes: [`jtd_${sourceStatus}`],
  });
}

// 兼容别名：fillTravelBaseCard → fillSojournBase（保持向后兼容）
const fillTravelBaseCard = fillSojournBase;

function fillTravelSpotCard({ message, business_data }) {
  const bd = business_data || {};
  const route = pickByLockedId(bd.routes, bd.route_id, ['route_id', 'id'], { allowFallback: false });
  const destination = sanitizeText(
    bd.destination
    || bd.primary_city
    || route?.destination
    || inferDestination(message)
    || '',
  );
  if (!destination) {
    return sanitizeModelResult({
      template_id: 'travel_spot_card',
      answer_text: '请先确认旅居目的地，再为您推荐适老化景点。',
      answer: '请先确认旅居目的地，再为您推荐适老化景点。',
      data: { title: '适老化景点推荐', intro: '目的地待确认', spots: [], note: '可先说桂林/北海/防城港等目的地。' },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '桂林景点', user_prompt: '推荐桂林适老化景点', action_key: 'travel_route.view_spots' },
        { label: '北海景点', user_prompt: '推荐北海适老化景点', action_key: 'travel_route.view_spots' },
      ], {}),
    });
  }
  // 默认适老化景点数据（可被 business_data.spots 覆盖）
  const defaultSpots = [
    {
      name: '西湾城市沙滩 & 仙人山公园',
      tags: [{ cls: 'free', label: '免费' }, { cls: 'trip', label: '半日短途' }],
      desc: '城市海景 + 山体步道，适合晨练和傍晚散步',
      play: '仙人山公园平缓步道晨练，观海平台休息',
      meta: '步行/打车10分钟 · 半日（上午或傍晚）',
    },
    {
      name: '白浪滩',
      tags: [{ cls: 'free', label: '免费' }, { cls: 'trip', label: '全天长途' }],
      desc: '防城港知名海滩，沙质细腻，浪小水浅',
      play: '沙滩躺椅休息，观海听浪，平缓栈道漫步',
      meta: '包车/打车约40分钟 · 全天',
    },
    {
      name: '十万大山布透温泉',
      tags: [{ cls: 'fee', label: '收费' }, { cls: 'trip', label: '全天长途' }],
      desc: '天然偏硅酸温泉，理疗养生价值高',
      play: '温泉泡浴理疗，缓解关节酸痛，室内外泡池可选',
      meta: '包车约1小时 · 全天',
    },
  ];
  const spots = Array.isArray(business_data?.spots) && business_data.spots.length
    ? business_data.spots.slice(0, 6)
    : defaultSpots;
  // 景点精确坐标缺失时，使用目的地中心坐标作为近似位置（保证地图可显示）
  const spotMarkers = spots.map((s) => {
    const coord = s.lat && s.lng ? { lat: Number(s.lat), lng: Number(s.lng) } : getTravelDestinationCoord(destination);
    return { name: s.name, lat: coord.lat, lng: coord.lng, address: s.meta || destination, cat: 'spot' };
  });
  const mapData = buildTravelMapData(destination, spotMarkers);
  return sanitizeModelResult({
    template_id: 'travel_spot_card',
    answer_text: `为您精选${spots.length}个${destination}适老化景点`,
    data: {
      title: '适老化景点推荐',
      intro: `为您精选${spots.length}个${destination}适老化景点，已自动过滤高强度攀爬路线：`,
      spots,
      note: '景点开放时间和票价以现场为准；建议避开正午暴晒，保留充足休息时间。',
      ...mapData,
    },
    actions: [], followup_suggestions: [],
  });
}

function fillTravelMedicalCard({ message, business_data }) {
  const bd = business_data || {};
  const route = pickByLockedId(bd.routes, bd.route_id, ['route_id', 'id'], { allowFallback: false });
  const destination = sanitizeText(
    bd.destination
    || bd.primary_city
    || route?.destination
    || inferDestination(message)
    || '',
  );
  if (!destination) {
    return sanitizeModelResult({
      template_id: 'travel_medical_card',
      answer_text: '请先确认旅居目的地，再为您整理周边医疗资源。',
      answer: '请先确认旅居目的地，再为您整理周边医疗资源。',
      data: { title: '周边医疗资源', intro: '目的地待确认', groups: [] },
      actions: [],
      followup_suggestions: [],
    });
  }
  const defaultGroups = [
    {
      icon: '🏥',
      name: '就近医疗',
      items: [{ text: '首选基地距市第一人民医院仅 800m，步行可达' }],
    },
    {
      icon: '💊',
      name: '便民购药',
      items: [{ text: '基地楼下 200m 有仁爱大药房，常见药品齐全' }],
    },
    {
      icon: '🚗',
      name: '出行协助',
      items: [{ text: '基地管家可协助叫车、预约诊所' }],
    },
  ];
  const groups = Array.isArray(business_data?.medical_groups) && business_data.medical_groups.length
    ? business_data.medical_groups
    : defaultGroups;
  // 医疗机构精确坐标缺失时，使用目的地中心坐标作为近似位置
  const medicalMarkers = groups.map((g) => {
    const coord = g.lat && g.lng ? { lat: Number(g.lat), lng: Number(g.lng) } : getTravelDestinationCoord(destination);
    return { name: g.name, lat: coord.lat, lng: coord.lng, address: destination, cat: 'medical' };
  });
  const mapData = buildTravelMapData(destination, medicalMarkers);
  return sanitizeModelResult({
    template_id: 'travel_medical_card',
    answer_text: `${destination}医养配套方案`,
    data: {
      title: '医养配套方案',
      intro: `为您推荐的${destination}基地均具备基础康养配套：`,
      groups,
      tip: '💡 常规酒店无驻场医护，建议选择近市区医院的康养基地。建议自备基础检测设备。',
      note: '⚠️ 以上仅为就医、购药、体征检测便民渠道建议，不构成专业医疗诊断。',
      ...mapData,
    },
    actions: [], followup_suggestions: [],
  });
}

// 兼容导出：旧函数名 fillTravelWeatherRisk 保留
export function fillTravelWeatherRisk({ city, weather, business_data, all_cities }) {
  // 直接调用新函数，但不调用天气服务（使用传入的天气数据）
  const cityName = sanitizeText(city || business_data?.jtd?.selected_product?.destination || business_data?.destination || '目的地');
  const ok = !!(weather && weather.ok);
  const current = (weather && weather.current) || {};
  const forecasts = Array.isArray(weather?.forecasts) ? weather.forecasts : [];
  const tips = inferWeatherRiskTips(forecasts, current);

  const lines = [`### ${cityName} 旅居天气风险研判`];
  if (!ok) {
    lines.push('> 暂未获取到该城市的实时天气（未配置腾讯天气接口或接口异常）。建议出行前关注当地气象预报，或稍后重试。');
  } else {
    lines.push(`**当前**：${current.weather || '—'}，${current.temp != null ? current.temp + '℃' : '—'}${current.windDir ? '，' + current.windDir + (current.windPower || '') : ''}。`);
    if (forecasts.length) {
      lines.push('', '**未来几天：**', '| 日期 | 天气 | 温度 | 风 |', '| --- | --- | --- | --- |');
      for (const f of forecasts.slice(0, 5)) {
        const w = f.weather || '—';
        const t = `${f.tempDay != null ? f.tempDay + '°' : '—'}/${f.tempNight != null ? f.tempNight + '°' : '—'}`;
        lines.push(`| ${f.date || f.week || '—'} | ${w} | ${t} | ${f.wind || '—'} |`);
      }
    }
    lines.push('', '**长者风险提示：**');
    for (const t of tips) lines.push(`- ${t}`);
    if (weather?.updatedAt) lines.push(`\n_数据来源：腾讯天气（${weather.updatedAt}）_`);
  }
  // 多城市天气对比（如果 all_cities 存在且有多于1个城市）
  if (Array.isArray(all_cities) && all_cities.length > 1) {
    lines.push('');
    lines.push('### 多城市天气对比');
    for (const c of all_cities) {
      const cur = c.weather?.current || {};
      const tempStr = cur.temp != null ? cur.temp + '°C' : '';
      const windStr = [cur.windDir, cur.windPower].filter(Boolean).join(' ') || '';
      lines.push(`- **${c.city}**：${cur.weather || '未知'} ${tempStr} ${windStr}`.trim());
    }
  }
  const answerText = lines.join('\n');

  return sanitizeModelResult({
    template_id: 'travel_weather_risk_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      city: cityName,
      ok,
      degraded: !ok,
      currentWeather: current.weather || '',
      currentTemp: current.temp != null ? String(current.temp) : '',
      currentWind: [current.windDir, current.windPower].filter(Boolean).join(' ') || '',
      currentHumidity: current.humidity || '',
      currentFeel: current.feelTemp != null ? String(current.feelTemp) : '',
      updatedAt: weather?.updatedAt || '',
      forecasts: forecasts.slice(0, 5).map((f) => ({
        date: f.date || f.week || '',
        weather: f.weather || '',
        nightWeather: f.nightWeather || '',
        tempDay: f.tempDay != null ? String(f.tempDay) : '',
        tempNight: f.tempNight != null ? String(f.tempNight) : '',
        wind: f.wind || '',
      })),
      riskTips: tips.map((t) => ({ text: t })),
      degradedNote: ok ? '' : '暂未获取到实时天气，以下为通用提醒，请以当地实际预报为准。',
    },
    actions: [],
    followup_suggestions: [
      {
        label: '调整行程避开恶劣天气',
        user_prompt: '请帮我调整行程避开恶劣天气',
        action_key: 'travel_route.replan',
        skill_key: 'travel_route',
        params: { destination: cityName },
      },
      {
        label: '查看可订状态',
        user_prompt: '请检查这条旅居路线近期是否可预订',
        action_key: 'travel_route.check_availability',
        skill_key: 'travel_route',
        params: { destination: cityName, city: cityName },
      },
      {
        label: '查看天气风险',
        user_prompt: `请查看${cityName}旅居天气风险`,
        action_key: 'travel_route.check_weather_risk',
        skill_key: 'travel_route',
        params: { destination: cityName, city: cityName },
      },
    ],
    model_used: 'flatTalk.travel.weather',
    model_status: ok ? 'ok' : 'degraded',
    template_fit_notes: ['travel_weather_risk'],
  });
}

export {
  fillRouteCardLegacy,
  fillSojournBase,
  fillTravelBaseCard,
  fillTravelSpotCard,
  fillTravelMedicalCard,
  fillTravelAvailabilityCard,
  fillTravelItineraryCard,
};
