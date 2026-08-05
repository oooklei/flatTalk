/**
 * 防城港本地旅居线路知识库服务
 * 从 data/fangchenggang-routes.json 加载 5 条官方认证线路，提供关键词匹配查询。
 *
 * 接入点：jtd-service.js 的 queryLocalKnowledge() 在本地缓存之前优先查询本模块。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchCategory } from '../nearby-resource/tavily-nearby-adapter.js';
import { toSimplified } from '../../core/utils/simplified-chinese.js';
import { lookupDashboardSpotImages } from '../../skills/travel_route/dashboard-spot-kb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_FILE = resolve(__dirname, '../../../data/fangchenggang-routes.json');

let _routesCache = null;

/** 加载 5 条线路数据 */
export function loadLocalRoutes() {
  if (_routesCache !== null) return _routesCache;
  if (!existsSync(ROUTES_FILE)) {
    console.warn('[local-routes] 线路数据文件不存在:', ROUTES_FILE);
    _routesCache = [];
    return _routesCache;
  }
  try {
    _routesCache = JSON.parse(readFileSync(ROUTES_FILE, 'utf8'));
    console.log(`[local-routes] 已加载 ${_routesCache.length} 条防城港旅居线路`);
    return _routesCache;
  } catch (e) {
    console.warn('[local-routes] 加载失败:', e?.message || e);
    _routesCache = [];
    return _routesCache;
  }
}

// 关键词匹配表：用户消息 → 线路 ID
const ROUTE_KEYWORDS = [
  { id: 'fcg_route_001', keywords: ['京族', '滨海文化', '独弦琴', '金滩', '哈节', '渔耕', '京族三岛'] },
  { id: 'fcg_route_002', keywords: ['银发爱情', '边境', '夫妻', '国门', '友谊大桥', '界碑', '中越'] },
  { id: 'fcg_route_003', keywords: ['壮村', '民俗康养', '壮乡', '壮锦', '竹竿舞', '田园', '上思', '壮药'] },
  { id: 'fcg_route_004', keywords: ['森林', '轻氧', '十万大山', '负氧', '森林步道', '茶疗', '慢病调理'] },
  { id: 'fcg_route_005', keywords: ['芒街', '跨境', '越南', '出境', '护照', '签证', '芒街教堂'] },
];

/**
 * 按用户消息匹配本地线路。
 * @param {string} message - 用户消息
 * @param {string} [productDomain] - 'sojourn_route' | 'sojourn_base'
 * @returns {Array} 匹配到的线路列表（按相关度排序）
 */
export function matchLocalRoutes(message = '', productDomain = '') {
  const routes = loadLocalRoutes();
  if (!routes.length) return [];

  // 过滤 domain
  let pool = routes;
  if (productDomain) {
    const filtered = routes.filter((r) => !r.product_domain || r.product_domain === productDomain);
    if (filtered.length) pool = filtered;
  }

  const text = String(message || '').toLowerCase();
  if (!text) return pool;

  // 1. 精确匹配线路名
  const exactName = pool.find((r) => text.includes(r.product_name.toLowerCase()));
  if (exactName) return [exactName];

  // 2. 关键词匹配（按命中数排序）
  const scored = pool.map((route) => {
    const kwEntry = ROUTE_KEYWORDS.find((k) => k.id === route.product_id);
    const keywords = kwEntry?.keywords || [];
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) score += 1;
    }
    // 防城港通用关键词也给基础分
    if (/防城港|嘉路|旅居线路|康养线路/.test(text)) score += 0.5;
    return { route, score };
  });

  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (matched.length) return matched.map((s) => s.route);

  // 3. 防城港通用查询 → 返回全部 5 条
  if (/防城港|嘉路/.test(text)) return pool;

  return [];
}

/**
 * 选择最佳匹配线路（取第一条）。
 */
export function selectLocalRoute(message = '', productDomain = '') {
  const matches = matchLocalRoutes(message, productDomain);
  return matches[0] || null;
}

/**
 * 为本地线路 waypoints 补景点图/描述。
 * 默认走 dashboard 本地知识库；仅 SPOT_IMAGES_TAVILY=1 时才回退 Tavily。
 */
export async function enrichLocalRouteWaypoints(route) {
  if (!route?.waypoints?.length) return [];
  const destination = route.destination || '防城港';
  const allowTavily = String(process.env.SPOT_IMAGES_TAVILY || '').trim() === '1';

  const enriched = await Promise.all(
    route.waypoints.map(async (wp) => {
      if (wp.type === 'base' || wp.type === 'arrival' || wp.type === 'departure') {
        const localBase = lookupDashboardSpotImages(wp.name) || lookupDashboardSpotImages(destination);
        return {
          ...wp,
          spots: (localBase?.related_spots || []).slice(0, 3).map((s) => ({
            name: s.name,
            desc: s.address || '',
            url: '',
            lat: wp.lat,
            lng: wp.lng,
          })),
          spot_images: localBase?.spot_images || wp.spot_images || [],
          spot_desc: wp.spot_desc || localBase?.spot_desc || '',
        };
      }

      const local = lookupDashboardSpotImages(wp.name)
        || lookupDashboardSpotImages(`${destination} ${wp.name}`);
      if (local?.spot_images?.length) {
        return {
          ...wp,
          spots: (local.related_spots || []).slice(0, 3).map((s, i) => ({
            name: s.name,
            desc: s.address || s.category || '',
            url: '',
            lat: Number((wp.lat + (Math.random() - 0.5) * 0.015).toFixed(6)),
            lng: Number((wp.lng + (Math.random() - 0.5) * 0.015).toFixed(6)),
          })),
          spot_images: local.spot_images,
          spot_desc: wp.spot_desc || local.spot_desc || '',
        };
      }

      if (!allowTavily) {
        return { ...wp, spots: [], spot_images: wp.spot_images || [] };
      }

      try {
        const center = { name: `${destination} ${wp.name}`, lat: wp.lat, lng: wp.lng };
        const result = await searchCategory('spot', center, 5000);
        const spots = (result?.source_results || [])
          .filter((item) => {
            const name = String(item.title || '').trim();
            if (!name || name.length < 3) return false;
            if (/[a-z]{20,}/i.test(name)) return false;
            if (/景点大全|排行榜|自助游|攻略|旅游网|首页|当前位置|实景|卫星地图|trip\.com|最新消息|資訊|海峽兩岸/i.test(name)) return false;
            const garbleRatio = (name.replace(/[\u4e00-\u9fa5a-zA-Z0-9\s（）()、，。·\-_|]/g, '').length) / Math.max(name.length, 1);
            if (garbleRatio > 0.3) return false;
            return true;
          })
          .slice(0, 3).map((item, i) => {
            const cleanName = cleanSpotText(item.title || `景点${i + 1}`);
            const cleanDesc = cleanSpotText(String(item.content || '').slice(0, 100));
            return {
              name: cleanName,
              desc: cleanDesc,
              url: item.url || '',
              lat: Number((wp.lat + (Math.random() - 0.5) * 0.015).toFixed(6)),
              lng: Number((wp.lng + (Math.random() - 0.5) * 0.015).toFixed(6)),
            };
          })
          .filter((s) => s.name && s.name.length >= 2);
        const images = Array.isArray(result?.images) ? result.images.slice(0, 2) : [];
        return { ...wp, spots, spot_images: images };
      } catch (e) {
        return { ...wp, spots: [] };
      }
    })
  );
  return enriched;
}

/**
 * 清洗景点文本：去除网页导航、SEO聚合页、广告语、乱码、重复句
 */
function cleanSpotText(raw = '') {
  let text = String(raw).trim();
  // 截断常见噪声分隔符
  text = text.split(/\s*[-_|·]\s*/)[0];
  // 去除域名残留
  text = text.replace(/^.*\.com\s*/i, '').replace(/^.*\.cn\s*/i, '');
  // 去除尾部括号说明
  text = text.replace(/[（(].*$/, '');
  // 去除网页导航 / SEO 关键词
  text = text.replace(/首页|当前位置|景点大全|排行榜|自助游|攻略|旅游网|最新消息|資訊|海峽兩岸|Association\s+For\s+Tourism/i, '');
  // 去除重复句
  text = text.replace(/(.{5,30})\1{2,}/g, '$1');
  // 乱码检测：乱码占比过高 → 清空
  const garbleRatio = (text.replace(/[\u4e00-\u9fa5a-zA-Z0-9\s（）()、，。！？；：·"%\-/]/g, '').length) / Math.max(text.length, 1);
  if (garbleRatio > 0.25) return '';
  return toSimplified(text.trim());
}

/**
 * 构建本地线路上下文（兼容 jtd-service 返回格式）。
 * 供 fillRouteCard 直接消费。
 */
export async function buildLocalRouteContext(message = '', productDomain = 'sojourn_route') {
  const route = selectLocalRoute(message, productDomain);
  if (!route) return null;

  // Tavily 增强景点
  let enrichedWaypoints = route.waypoints || [];
  try {
    enrichedWaypoints = await enrichLocalRouteWaypoints(route);
  } catch (e) {
    console.warn('[local-routes] Tavily 增强失败:', e?.message || e);
  }

  return {
    provider: 'local_routes',
    required: true,
    source_status: 'local_kb_cache',
    data_source: 'local_routes',
    product_domain: route.product_domain || 'sojourn_route',
    product_type: route.product_type || '旅居线路',
    products: [route],
    selected_product: route,
    waypoints: enrichedWaypoints,
    detail: null,
    availability: null,
    handoff_enabled: false,
    calls: [],
    warnings: [],
    // 本地线路特有字段
    base_camp: '嘉路滨海旅居基地（嘉路康旅酒店）',
    combo_price: route.price_combo,
    discount: route.discount,
  };
}
