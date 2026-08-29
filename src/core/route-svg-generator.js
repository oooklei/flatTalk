// ============================================================
// 旅居线路 HTML 生成器（一站式封装）
// 输入：线路名 + 线路详细介绍（含景点端点信息）
// 输出：完整 HTML（内嵌 SVG + route_svg 模板渲染）
// ============================================================
// 今日对话修复点汇总：
//   1. 行政区边界解析（MultiPolygon/Polygon 严格按 GeoJSON 规范）
//   2. 模板→SVG 引用链路（findPrebuiltPackageByDestination 动态查找）
//   3. route_svg.html SVG 注入修复（script type=text/html 传递）
//   4. Tavily 景点图片+描述增强（端点不跳过、多图逗号分隔、轮播交互）
//   5. 简体中文全局转换
//   6. 走线分色（前进橙色 / 返程蓝色）
//   7. 标点分色（起点绿 / 途经橙 / 康养紫 / 返程蓝）
//   8. 景点图片默认隐藏，悬停显示，离开3秒隐藏
// ============================================================

import { generateSvg } from '../admin/mapstudio.js';
import { renderTemplate } from '../template-card/render.js';
import { toSimplified, toSimplifiedDeep } from './utils/simplified-chinese.js';
import { buildRouteMapArtBackground } from './map/route-map-art.js';
import { TencentMapAdapter } from '../services/map/tencent-map-adapter.js';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

// ------------------------------------------------------------
// 目的地 → 本地边界 GeoJSON 文件名映射
// ------------------------------------------------------------
const DESTINATION_BOUNDARY_MAP = {
  '巴马': ['bama_boundary', 'bama'],
  '防城港': ['fcg_boundary', 'fcg', 'fangchenggang'],
  '北海': ['beihai_boundary', 'beihai'],
  '东兴': ['dongxing_boundary', 'dongxing', 'dx_boundary'],
};

// ------------------------------------------------------------
// 目的地中心坐标（用于无 waypoint 时的兜底）
// ------------------------------------------------------------
const DESTINATION_CENTER = {
  '巴马': { lat: 24.12, lng: 107.25 },
  '防城港': { lat: 21.69, lng: 108.35 },
  '北海': { lat: 21.48, lng: 109.12 },
  '东兴': { lat: 21.54, lng: 107.97 },
};

// ------------------------------------------------------------
// 主函数：generateRouteHtml
// ------------------------------------------------------------
/**
 * 生成旅居线路 HTML（内嵌 SVG + route_svg 模板渲染）
 *
 * @param {string} routeName - 线路名称，如 "巴马5天4晚康养旅居"
 * @param {string} routeDescription - 线路详细介绍（含景点、天数、特色等，800字以内）
 * @param {Object} [options] - 可选配置
 * @param {Array}  [options.waypoints] - 预定义 waypoints（含 lat/lng/name/type/day/plan/spot_images/spot_desc）
 * @param {string} [options.destination] - 目的地覆盖（不传则从线路名/描述推断）
 * @param {string} [options.version] - SVG 版本：'standard'(默认) | 'elder'(适老版)
 * @param {string} [options.season] - 季节标签（默认"四季皆宜"）
 * @param {string} [options.budgetLevel] - 预算等级（默认"经济舒适"）
 * @param {string} [options.priceLabel] - 价格标签
 * @param {string} [options.suitable] - 适合人群
 * @param {string} [options.bookingStatus] - 预订状态
 * @param {Array}  [options.highlights] - 行程亮点数组
 * @param {Array}  [options.itinerary] - 行程安排 [{day, wp_name, plan}]
 * @param {string} [options.healthNotice] - 健康提示
 * @param {string} [options.routeId] - 线路ID（不传则从名称生成）
 * @returns {Promise<{html: string, svg: string, routeData: Object, warnings: string[]}>}
 */
export async function generateRouteHtml(routeName, routeDescription, options = {}) {
  const warnings = [];

  // 1. 推断目的地
  const destination = toSimplified(options.destination || inferDestination(routeName, routeDescription));
  if (!destination) warnings.push('无法推断目的地，请通过 options.destination 指定');

  // 2. 确定 waypoints
  let waypoints = options.waypoints || parseWaypointsFromDescription(routeDescription, destination);
  if (!waypoints || waypoints.length === 0) {
    // 兜底：用目的地中心点生成一个占位 waypoint
    const center = DESTINATION_CENTER[destination];
    waypoints = center ? [{ name: destination, lat: center.lat, lng: center.lng, type: 'arrival', day: 'Day1', plan: '抵达' + destination }] : [];
    warnings.push('未找到 waypoints，使用目的地中心点兜底');
  }

  // 3. 获取行政区边界
  const boundary = loadBoundaryFromLocal(destination);
  if (!boundary || boundary.length === 0) warnings.push(`未找到 ${destination} 的行政区边界GeoJSON`);

  // 4. 简体中文转换（数值不被转换）
  waypoints = waypoints.map((wp) => ({
    ...toSimplifiedDeep({
      id: wp.id || `wp${Math.random().toString(36).slice(2, 7)}`,
      name: wp.name,
      type: wp.type || 'spot',
      day: wp.day || '',
      plan: wp.plan || '',
      address: wp.address || '',
      spots: wp.spots || [],
      spot_images: wp.spot_images || [],
      spot_desc: wp.spot_desc || '',
    }),
    lat: wp.lat,
    lng: wp.lng,
  }));

  // 5. 艺术/丘陵底图（可关闭：FLATTALK_ROUTE_MAP_AI=0 或 options.aiArt=false）
  const routeId = options.routeId || slugify(routeName);
  const version = options.version || 'standard';
  let artBg = '';
  const enableAi = options.aiArt !== false && String(process.env.FLATTALK_ROUTE_MAP_AI || '1') !== '0';
  try {
    const lats = waypoints.map((w) => Number(w.lat)).filter(Number.isFinite);
    const lngs = waypoints.map((w) => Number(w.lng)).filter(Number.isFinite);
    if (lats.length && lngs.length) {
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
      const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
      let zoom = 11;
      if (span > 1.5) zoom = 8;
      else if (span > 0.8) zoom = 9;
      else if (span > 0.4) zoom = 10;
      else if (span > 0.15) zoom = 11;
      else if (span > 0.06) zoom = 12;
      else zoom = 13;
      const mapAdapter = new TencentMapAdapter();
      const art = await buildRouteMapArtBackground({
        routeId: version === 'elder' ? `${routeId}_elder` : routeId,
        routeName,
        destination,
        waypoints,
        centerLat,
        centerLng,
        zoom,
        size: version === 'elder' ? '800*960' : '800*840',
        enableAi,
        downloadImageAsBase64: downloadImageAsBase64Quick,
        buildStaticMapUrl: (c, m, o) => mapAdapter.buildStaticMapUrl(c, m, o),
      });
      if (art?.ok && art.data_uri) {
        artBg = art.data_uri;
        warnings.push(`art_source=${art.source}`);
      } else if (art?.error) {
        warnings.push(`art_skip=${art.error}`);
      }
    }
  } catch (e) {
    warnings.push(`art_error=${e?.message || e}`);
  }

  // 6. 生成 SVG
  const svg = generateSvg(waypoints, routeId, toSimplified(routeName), version, artBg, boundary);

  // 6. 组装模板数据
  const hasSpots = waypoints.some((w) => (w.spot_images || []).length > 0 || (w.spot_desc || '').length > 0);

  // 景点图鉴：把每个有图片/描述的端点拆成卡片数据，供 Mustache 直接渲染（无需 JS）
  const spot_cards = waypoints
    .filter((w) => (w.spot_images || []).length > 0 || (w.spot_desc || '').length > 0)
    .map((w) => {
      const imgs = (w.spot_images || [])
        .map((img) => (typeof img === 'string' ? img : (img && (img.url || img.src)) || ''))
        .filter(Boolean);
      return {
        name: toSimplified(w.name || ''),
        day: w.day || '',
        desc: toSimplified(w.spot_desc || ''),
        first_image: imgs[0] || '',
        has_image: imgs.length > 0,
        image_count: imgs.length,
      };
    });
  const hasSpotCards = spot_cards.length > 0;

  const templateData = {
    routeTitle: toSimplified(routeName),
    destination,
    summary: toSimplified(extractSummary(routeDescription)),
    season: toSimplified(options.season || '四季皆宜'),
    budgetLevel: toSimplified(options.budgetLevel || '经济舒适'),
    priceLabel: options.priceLabel || '',
    days: options.days || inferDays(routeName),
    suitable: toSimplified(options.suitable || '中老年康养'),
    bookingStatus: toSimplified(options.bookingStatus || '可预订'),
    highlights: (options.highlights || extractHighlights(routeDescription)).map(toSimplified),
    itinerary: (options.itinerary || buildItineraryFromWaypoints(waypoints)).map(toSimplifiedDeep),
    healthNotice: toSimplified(options.healthNotice || ''),
    hasSpots,
    hasSpotCards,
    spot_cards,
    static_svg: svg,
    compact_followups: '',
  };

  // 7. 读取并渲染模板
  const templatePath = path.join(process.cwd(), 'src', 'skills', 'travel_route', 'templates', 'html', 'route_svg.html');
  let html;
  try {
    const template = fs.readFileSync(templatePath, 'utf8');
    html = renderTemplate(template, templateData);
    // 服务端预渲染：把 SVG 直接注入 svgMapContainer，去掉所有 <script>，
    // 使卡片成为纯静态 HTML（无需 iframe 隔离，移动端内联渲染不白屏）
    html = html
      // 把 SVG 注入 svgMapContainer
      .replace(
        /(<div\s+class=["']svg-container["']\s+id=["']svgMapContainer["']>)([\s\S]*?)(<\/div>)/i,
        (m, open, _inner, close) => `${open}\n        ${svg}\n      ${close}`,
      )
      // 去掉 data-static-svg（不再触发 iframe 隔离）
      .replace(/\s+data-static-svg=["']1["']/gi, '')
      // 去掉所有 <script> 块（SVG 已预渲染，JS 交互不再依赖）
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      // 去掉残留的 on* 内联事件（弹窗按钮等）
      .replace(/\son\w+=["'][^"']*["']/gi, '');
  } catch (e) {
    warnings.push(`模板渲染失败: ${e.message}，返回 SVG 原文`);
    html = svg;
  }

  // 8. 返回结果
  return {
    html,
    svg,
    routeData: {
      route_id: routeId,
      route_name: toSimplified(routeName),
      destination,
      waypoints,
      summary: templateData.summary,
      highlights: templateData.highlights,
      itinerary: templateData.itinerary,
      version,
      generated_at: new Date().toISOString(),
    },
    warnings,
  };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 从线路名/描述中推断目的地
 */
function inferDestination(routeName, description) {
  const text = `${routeName} ${description}`;
  // 按已知目的地列表匹配
  for (const dest of Object.keys(DESTINATION_CENTER)) {
    if (text.includes(dest)) return dest;
  }
  // 通用：提取"...康养旅居"前的地名
  const m = text.match(/([\u4e00-\u9fa5]{2,6})(?:\d+天|\d+晚|康养|旅居|线路|游)/);
  return m ? m[1] : '';
}

/**
 * 从描述文本中推断天数
 */
function inferDays(routeName) {
  const m = routeName.match(/(\d+)\s*天/);
  return m ? `${m[1]}天` : '';
}

/**
 * 从描述中提取摘要（前100字）
 */
function extractSummary(description) {
  if (!description) return '';
  // 取第一句或前100字
  const firstSentence = description.split(/[。\n！？]/)[0];
  return firstSentence.length > 100 ? firstSentence.slice(0, 100) + '...' : firstSentence;
}

/**
 * 从描述中提取亮点（按"·""、""，"分隔的关键词）
 */
function extractHighlights(description) {
  if (!description) return [];
  // 匹配"亮点：xxx、xxx" 或 "特色：xxx·xxx" 格式
  const m = description.match(/(?:亮点|特色|行程亮点)\s*[:：]\s*([^\n]+)/);
  if (m) {
    return m[1].split(/[、·,，]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 20).slice(0, 6);
  }
  return [];
}

/**
 * 从描述文本解析 waypoints
 * 支持格式："Day1 百魔洞(24.15,107.05) 溶洞观光"
 * 或 JSON 内嵌格式
 */
function parseWaypointsFromDescription(description, destination) {
  if (!description) return [];
  const waypoints = [];

  // 格式1: "Day1 景点名(纬度,经度) 计划" 或 "Day1 景点名（纬度，经度）计划"
  const regex1 = /(?:Day\s*(\d+|出发|返程))\s+([\u4e00-\u9fa5A-Za-z\s]{2,12})\s*[（(]\s*(-?\d+\.?\d*)\s*[,，]\s*(-?\d+\.?\d*)\s*[)）]\s*([^\n]+)/g;
  let match;
  while ((match = regex1.exec(description)) !== null) {
    const day = `Day${match[1]}`;
    const name = match[2].trim();
    const lat = parseFloat(match[3]);
    const lng = parseFloat(match[4]);
    const plan = match[5].trim().slice(0, 40);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      waypoints.push({ name, lat, lng, day, plan, type: inferWaypointType(name, day, plan) });
    }
  }

  // 格式2: 描述中有 "起点：xxx" "终点：xxx" 等标记
  if (waypoints.length === 0) {
    const startMatch = description.match(/(?:起点|出发地)\s*[:：]\s*([\u4e00-\u9fa5]{2,10})/);
    const endMatch = description.match(/(?:终点|目的地|抵达)\s*[:：]\s*([\u4e00-\u9fa5]{2,10})/);
    if (startMatch) {
      const center = DESTINATION_CENTER[destination] || { lat: 24, lng: 107 };
      waypoints.push({ name: startMatch[1], lat: center.lat, lng: center.lng, type: 'arrival', day: 'Day1', plan: '抵达' });
    }
  }

  return waypoints;
}

/**
 * 推断 waypoint 类型
 */
function inferWaypointType(name, day, plan) {
  if (/返程|回程|离开|depart/.test(name + plan)) return 'departure';
  if (/县城|抵达|出发|基地|中心/.test(name + plan)) return day === 'Day1' ? 'arrival' : 'base';
  if (/康养|疗养|养生|长寿|温泉/.test(name + plan)) return 'wellness';
  return 'spot';
}

/**
 * 从 waypoints 构建行程列表
 */
function buildItineraryFromWaypoints(waypoints) {
  return waypoints.map((wp) => ({
    day: wp.day || '',
    wp_name: wp.name,
    plan: wp.plan || '',
  }));
}

/**
 * 线路名 → routeId
 */
function slugify(name) {
  return String(name || '')
    .replace(/[\s（）()，,。.!！？?]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40) || 'route_' + Date.now();
}

/**
 * 从本地 GeoJSON 加载行政区边界
 */
function loadBoundaryFromLocal(destination) {
  if (!destination) return [];
  const geoDir = path.join(process.cwd(), 'geographicSVG');
  const searchKeys = [destination, ...(DESTINATION_BOUNDARY_MAP[destination] || [])];

  let files = [];
  try { files = fs.readdirSync(geoDir).filter((f) => f.endsWith('.geojson')); }
  catch { return []; }

  for (const file of files) {
    const lower = file.toLowerCase();
    const matched = searchKeys.some((k) => {
      const lk = k.toLowerCase();
      return lower.includes(lk) || lk.includes(lower.replace('.geojson', ''));
    });
    if (!matched) continue;

    try {
      const geojson = JSON.parse(fs.readFileSync(path.join(geoDir, file), 'utf8'));
      const features = geojson.features || [];
      if (features.length === 0) continue;
      const geom = features[0].geometry || {};
      const coords = geom.coordinates || [];
      const gtype = geom.type;
      const polygons = [];
      const parseRing = (ring) => {
        if (!Array.isArray(ring)) return null;
        return ring.filter((pt) => Array.isArray(pt) && pt.length >= 2).map(([lng, lat]) => ({ lat, lng }));
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
      if (polygons.length > 0) return polygons;
    } catch {}
  }
  return [];
}

export { DESTINATION_BOUNDARY_MAP, DESTINATION_CENTER, loadBoundaryFromLocal, inferDestination, selectProductTemplate, loadProductSample, isSampleCompatibleWithDestination };

// ============================================================
// 产品模板库：选择器
// ============================================================

/**
 * 根据线路名和描述，从模板库索引中选择最匹配的产品模板
 * @returns {{id:string, name:string, manifest:Object, sample:Object}|null}
 */
function selectProductTemplate(routeName, description) {
  const index = loadProductIndex();
  if (!index || !Array.isArray(index.products)) return null;

  const text = `${routeName || ''} ${description || ''}`;
  let bestMatch = null;
  let bestScore = 0;

  for (const product of index.products) {
    let score = 0;
    for (const kw of (product.match_keywords || [])) {
      if (kw && text.includes(kw)) score += 2;
    }
    for (const dest of (product.destinations || [])) {
      if (dest && text.includes(dest)) score += 3; // 目的地权重大于泛化主题词
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }
  }

  // 兜底：有明确目的地时按城选型；禁止无目的地时默认落到 wellness（巴马样例）
  if (!bestMatch || bestScore <= 0) {
    if (/北海|防城港|东兴|钦州|银滩|涠洲|海边|海滩|滨海/.test(text)) {
      bestMatch = index.products.find((p) => p.id === 'route_coastal') || index.products[0];
    } else if (/桂林|阳朔|漓江|遇龙河/.test(text)) {
      bestMatch = index.products.find((p) => p.id === 'route_culture' || (p.destinations || []).some((d) => /桂林|阳朔/.test(d)))
        || index.products.find((p) => p.id === 'route_ecology')
        || null;
    } else if (/巴马|百魔洞|长寿村|赐福湖/.test(text)) {
      bestMatch = index.products.find((p) => p.id === 'route_wellness') || index.products[0];
    } else {
      // 泛化「旅居/产品详情」不得静默套巴马 wellness 样例
      bestMatch = null;
    }
  }

  if (!bestMatch) return null;

  const tplDir = path.join(process.cwd(), 'src', 'skills', 'travel_route', 'templates');
  let manifest = {};
  let sample = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(tplDir, bestMatch.manifest), 'utf8'));
  } catch {}
  try {
    sample = JSON.parse(fs.readFileSync(path.join(tplDir, bestMatch.sample), 'utf8'));
  } catch {}

  // 示例数据与目标目的地不一致时，只保留模板类型，不套用异地行程/亮点
  if (!isSampleCompatibleWithDestination(sample, text)) {
    sample = {};
  }

  return { id: bestMatch.id, name: bestMatch.name, manifest, sample };
}

const DESTINATION_LANDMARKS = {
  巴马: ['巴马', '百魔洞', '赐福湖', '盘阳河', '命河', '长寿村', '水晶宫'],
  北海: ['北海', '银滩', '涠洲'],
  防城港: ['防城港', '京族', '白浪滩', '东兴', '芒街', '江山半岛', '嘉路'],
  桂林: ['桂林', '阳朔', '漓江', '象鼻山', '遇龙河'],
  南宁: ['南宁', '青秀山'],
  贺州: ['贺州', '黄姚'],
  七洞乡: ['七洞乡', '七洞'],
};

function inferLandmarkCity(text = '') {
  const raw = String(text || '');
  for (const [city, marks] of Object.entries(DESTINATION_LANDMARKS)) {
    if (raw.includes(city) || marks.some((m) => m !== city && raw.includes(m))) return city;
  }
  return '';
}

function isSampleCompatibleWithDestination(sample, destinationOrText) {
  if (!sample || typeof sample !== 'object') return false;
  const hasContent = !!(
    sample.destination
    || sample.routeTitle
    || (Array.isArray(sample.highlights) && sample.highlights.length)
    || (Array.isArray(sample.itinerary) && sample.itinerary.length)
  );
  if (!hasContent) return false;

  const targetCity = inferLandmarkCity(destinationOrText);
  const sampleCity = inferLandmarkCity([
    sample.destination,
    sample.routeTitle,
    ...(Array.isArray(sample.highlights) ? sample.highlights : []),
    JSON.stringify(sample.itinerary || []),
  ].filter(Boolean).join(' '));

  // 目标无已知城、示例绑了明确城 → 不相容（避免「七洞乡」吃巴马 wellness 样例）
  if (!targetCity && sampleCity) return false;
  if (targetCity && sampleCity && sampleCity !== targetCity) return false;
  // 目标是北海时，绝不能出现巴马地标簇
  if (targetCity === '北海') {
    const blob = JSON.stringify(sample);
    if (/巴马|百魔洞|赐福湖|盘阳河/.test(blob)) return false;
  }
  // 目标非巴马时，不得套用巴马地标样例
  if (targetCity && targetCity !== '巴马') {
    const blob = JSON.stringify(sample);
    if (/百魔洞|赐福湖|盘阳河|命河/.test(blob) && !String(destinationOrText || '').includes('巴马')) {
      return false;
    }
  }
  return true;
}

/**
 * 加载产品模板索引
 */
function loadProductIndex() {
  const indexFile = path.join(process.cwd(), 'src', 'skills', 'travel_route', 'templates', 'route-products.json');
  try {
    return JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 加载指定产品的示例数据
 */
function loadProductSample(productId) {
  const index = loadProductIndex();
  if (!index) return null;
  const product = index.products.find((p) => p.id === productId);
  if (!product) return null;
  const tplDir = path.join(process.cwd(), 'src', 'skills', 'travel_route', 'templates');
  try {
    return JSON.parse(fs.readFileSync(path.join(tplDir, product.sample), 'utf8'));
  } catch {
    return null;
  }
}

function downloadImageAsBase64Quick(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    try {
      const client = String(url || '').startsWith('https') ? https : http;
      const req = client.get(url, { timeout: timeoutMs }, (resp) => {
        if (resp.statusCode !== 200) { resolve(null); return; }
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const buf = Buffer.concat(chunks);
          const mime = resp.headers['content-type'] || 'image/png';
          // 腾讯有时返回 JSON 错误
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
}
