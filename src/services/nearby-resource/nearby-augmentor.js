/**
 * Nearby Augmentor — nearby_resource 富化编排器
 *
 * 三层数据融合：
 *   ① 静态 JSON（388条，主数据源）
 *   ② 腾讯地图实时 POI（低覆盖分类补充）
 *   ③ Tavily 网页搜索（描述/图片/评价富化）
 *
 * 带内存缓存（10分钟 TTL）和超时降级。
 */
import TencentMapAdapter from '../map/tencent-map-adapter.js';
import { enrichCategories, attachEnrichment } from './tavily-nearby-adapter.js';
import * as poiCache from './poi-cache.js';

// ── 配置 ──
const CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟
const TENCENT_TIMEOUT_MS = 2000;
const TAVILY_TIMEOUT_MS = 3000;
const LOW_COVERAGE_THRESHOLD = 5; // wellness/医疗 类少于5条触发补充
const ZERO_CATEGORY_THRESHOLD = 0; // 某分类=0时触发

// 腾讯地图分类关键词映射
const TENCENT_KEYWORDS = {
  food: '餐厅 美食',
  spot: '景点 旅游',
  wellness: '医院 药店 社区卫生',
  stay: '酒店 民宿 住宿',
  leisure: '休闲 娱乐',
  shop: '购物 超市 特产',
  transit: '交通 站点',
};

// ── 缓存 ──
const _cache = new Map();

function makeCacheKey(center, intent) {
  return `${center.lng?.toFixed(4)},${center.lat?.toFixed(4)},${intent || 'all'}`;
}

// ── 覆盖率检测 ──
function detectLowCoverage(facilities) {
  const counts = {};
  for (const f of facilities) {
    const cat = f.cat || f._nbCat || 'other';
    counts[cat] = (counts[cat] || 0) + 1;
  }
  const lowCats = [];
  for (const cat of Object.keys(TENCENT_KEYWORDS)) {
    const count = counts[cat] || 0;
    if (count === ZERO_CATEGORY_THRESHOLD) {
      lowCats.push({ cat, count, reason: 'zero' });
    } else if (cat === 'wellness' && count < LOW_COVERAGE_THRESHOLD) {
      lowCats.push({ cat, count, reason: 'low_wellness' });
    }
  }
  return { counts, lowCats };
}

// ── 腾讯地图补充 ──
async function supplementFromTencent(lowCats, center, radiusMeters = 15000) {
  if (lowCats.length === 0) return { pois: [], cacheStatus: 'disabled' };
  let adapter;
  try {
    adapter = new TencentMapAdapter();
  } catch (err) {
    console.warn('[nearby-augmentor] TencentMapAdapter init failed:', err.message);
    return { pois: [], cacheStatus: poiCache.isDisabled() ? 'disabled' : 'miss' };
  }

  // 聚合每个分类的缓存命中情况
  const statuses = [];

  const results = await Promise.all(
    lowCats.map(async ({ cat }) => {
      const keyword = TENCENT_KEYWORDS[cat];
      if (!keyword) return [];

      // ★ POI 缓存检查（命中则跳过腾讯地图 API 调用）
      const cacheKey = poiCache.makeKey(center.lat, center.lng, cat, radiusMeters);
      if (!poiCache.isDisabled()) {
        const cached = poiCache.get(cacheKey);
        if (cached) {
          statuses.push('hit');
          console.log('[nearby-augmentor] POI cache hit:', cacheKey);
          return cached;
        }
      }

      // 未命中（或缓存禁用），调用腾讯地图 API
      try {
        const pois = await Promise.race([
          adapter.searchNearby(keyword, center.lat, center.lng, radiusMeters, 10),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('tencent_timeout')), TENCENT_TIMEOUT_MS)
          ),
        ]);
        const mapped = pois.map((p) => ({
          poi_id: `tc_${p.id || Math.random().toString(36).slice(2)}`,
          name: p.title || '',
          address: p.address || '',
          lng: p.location?.lng || 0,
          lat: p.location?.lat || 0,
          distance: p.distance ? (p.distance / 1000).toFixed(1) : 0,
          category: cat,
          amap_type: p.type || '',
          cat,
          biz_status: '',
          tel: p.tel || '',
          open_time: '',
          service_tags: '',
          _source: 'tencent',
        }));
        poiCache.set(cacheKey, mapped);
        statuses.push(poiCache.isDisabled() ? 'disabled' : 'miss');
        return mapped;
      } catch (err) {
        console.warn(`[nearby-augmentor] Tencent ${cat} supplement failed:`, err.message);
        statuses.push(poiCache.isDisabled() ? 'disabled' : 'miss');
        return [];
      }
    })
  );

  // 聚合缓存状态：任一未命中 → miss；全部命中 → hit；否则 disabled
  let cacheStatus = 'disabled';
  if (statuses.includes('miss')) {
    cacheStatus = 'miss';
  } else if (statuses.includes('hit')) {
    cacheStatus = 'hit';
  }

  return { pois: results.flat(), cacheStatus };
}

// ── 去重 ──
function deduplicate(merged) {
  const seen = [];
  const result = [];
  for (const poi of merged) {
    const isDup = seen.some((s) => {
      if (s.name && poi.name && similarity(s.name, poi.name) > 0.8) {
        const dist = Math.abs(s.lng - poi.lng) + Math.abs(s.lat - poi.lat);
        return dist < 0.001; // ~100m
      }
      return false;
    });
    if (!isDup) {
      if (poi._source && poi._source !== 'local') {
        poi._source = poi._source;
      } else {
        poi._source = poi._source || 'local';
      }
      seen.push(poi);
      result.push(poi);
    } else {
      // 合并：标记为 merged
      const orig = seen.find((s) => similarity(s.name, poi.name) > 0.8);
      if (orig && orig._source === 'local') {
        orig._source = 'merged';
      }
    }
  }
  return result;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.toLowerCase().split(''));
  const setB = new Set(b.toLowerCase().split(''));
  let common = 0;
  for (const ch of setA) {
    if (setB.has(ch)) common++;
  }
  return common / Math.max(setA.size, setB.size);
}

// ── 主入口 ──

/**
 * 富化 nearby_resource 的 POI 数据
 * @param {Array} facilities - 静态 JSON POI 列表（原始字段）
 * @param {{name:string,lng:number,lat:number}} center - 中心坐标
 * @param {string} intent - 用户意图分类（如 'nearby_resource.food'）
 * @param {object} [options] - 可选参数
 * @returns {Promise<{facilities: Array, stats: object}>}
 */
export async function enrich(facilities, center, intent = 'all', options = {}) {
  const cacheKey = makeCacheKey(center, intent);

  // 1. 检查缓存
  if (!options.skipCache && _cache.has(cacheKey)) {
    const cached = _cache.get(cacheKey);
    if (Date.now() - cached.ts < CACHE_TTL_MS) {
      console.log('[nearby-augmentor] cache hit:', cacheKey);
      return cached.data;
    }
    _cache.delete(cacheKey);
  }

  // 2. 预处理：归一化分类 + 标记本地数据 source
  const localFacilities = facilities.map((f) => ({
    ...f,
    _source: f._source || 'local',
    cat: f.cat || normalizeCat(f), // ★ 先归一化再检测覆盖率
  }));

  // 3. 覆盖率检测（基于已归一化的 cat 字段）
  const { counts, lowCats } = detectLowCoverage(localFacilities);
  console.log('[nearby-augmentor] coverage:', counts, 'lowCats:', lowCats.map((c) => c.cat));

  // 4. 腾讯地图补充低覆盖分类
  let supplemented = [];
  let tencentCacheStatus = 'disabled';
  if (lowCats.length > 0 && !options.skipTencent) {
    console.log('[nearby-augmentor] supplementing from Tencent Maps:', lowCats.map((c) => c.cat));
    const tencentResult = await supplementFromTencent(lowCats, center);
    supplemented = tencentResult.pois;
    tencentCacheStatus = tencentResult.cacheStatus;
    console.log('[nearby-augmentor] Tencent supplemented:', supplemented.length, 'POIs (cache:', tencentCacheStatus + ')');
  }

  // 5. 合并 + 去重
  let merged = deduplicate([...localFacilities, ...supplemented]);

  // 6. Tavily 富化（按当前意图分类或全量低覆盖分类）
  if (!options.skipTavily) {
    // 确定需要 Tavily 富化的分类
    const intentCat = intent.replace('nearby_resource.', '');
    const catsToEnrich = intentCat !== 'all' && intentCat !== 'nearby_resource'
      ? [intentCat]
      : lowCats.length > 0
        ? lowCats.map((c) => c.cat)
        : ['food', 'spot']; // 默认富化吃和游

    console.log('[nearby-augmentor] Tavily enriching categories:', catsToEnrich);
    const enrichMap = await enrichCategories(catsToEnrich, center, TAVILY_TIMEOUT_MS);

    // 将 Tavily 信息附加到 POI（cat 已在第2步归一化）
    merged = attachEnrichment(merged, enrichMap);
  }

  // 7. 统计
  const stats = {
    total: merged.length,
    local: merged.filter((m) => m._source === 'local').length,
    tencent: merged.filter((m) => m._source === 'tencent').length,
    merged: merged.filter((m) => m._source === 'merged').length,
    enriched: merged.filter((m) => m.enriched_description || m.enriched_images?.length).length,
  };

  console.log('[nearby-augmentor] enrichment stats:', stats);

  const result = { facilities: merged, stats, cache_status: tencentCacheStatus };

  // 8. 写入缓存
  if (!options.skipCache) {
    _cache.set(cacheKey, { data: result, ts: Date.now() });
  }

  return result;
}

// 轻量分类归一化（与 model-service.js 的 nbCat 对齐）
function normalizeCat(f) {
  const cat = (String(f.category || '')).toLowerCase();
  const amap = (String(f.amap_type || '')).toLowerCase();
  if (/垂钓|钓鱼/.test(amap)) return 'leisure';
  if (/药房|医药|保健|医疗|卫生|疾控|诊所|医院/.test(amap)) return 'wellness';
  if (/购物|市场|超市|商店|便利店|专卖店|农副|特产/.test(amap)) return 'shop';
  if (/海滨浴场|风景名胜|公园|广场|寺庙|教堂|纪念馆|科技馆|水族馆|观景点|景点|旅游|湿地/.test(amap)) return 'spot';
  if (/体育休闲|休闲场所|度假|营地|游乐/.test(amap)) return 'leisure';
  if (/餐饮|餐厅|酒楼|饭店|食|海鲜/.test(amap)) return 'food';
  if (/住宿|酒店|旅馆|招待所|宾馆|客栈/.test(amap)) return 'stay';
  if (/包车|租赁|停车场|车站|交通|道路/.test(amap)) return 'transit';
  if (/民宿|康养小院|商务住宅/.test(cat)) return 'stay';
  if (/餐厅|餐饮|美食|饭店|私房菜|大排档/.test(cat)) return 'food';
  if (/景区|景点|滨海|海边/.test(cat)) return 'spot';
  if (/垂钓|休闲|钓鱼/.test(cat)) return 'leisure';
  if (/购物|特产|买/.test(cat)) return 'shop';
  if (/包车|交通/.test(cat)) return 'transit';
  if (/医养|养老/.test(cat)) return 'wellness';
  return 'other';
}

/**
 * 清除缓存
 */
export function clearCache() {
  _cache.clear();
}

export default { enrich, clearCache };
