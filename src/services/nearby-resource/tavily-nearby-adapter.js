/**
 * Tavily Nearby Adapter — 为 nearby_resource 技能提供 POI 富化搜索
 *
 * 调用 Tavily /search API，按分类查询周边推荐信息，
 * 提取 description / images / rating_hint 附加到 POI。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从 .env 读取 Key
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '..', '..', '..', '.env');
    const raw = readFileSync(envPath, 'utf-8');
    const lines = raw.split('\n');
    const env = {};
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch {
    return {};
  }
}

const _env = loadEnv();
const TAVILY_API_KEY = _env.TAVILY_API_KEY || _env.WEB_SEARCH_API_KEY || '';
const TAVILY_BASE = 'https://api.tavily.com';

// 分类 → Tavily 搜索关键词映射
const CATEGORY_QUERIES = {
  food: (center) => `${center.name || '康养中心'}附近 餐厅 美食 推荐 适老`,
  spot: (center) => `${center.name || '康养中心'}附近 景点 游玩 推荐`,
  wellness: (center) => `${center.name || '康养中心'}附近 医疗 社区卫生 服务`,
  stay: (center) => `${center.name || '康养中心'}附近 民宿 康养 住宿`,
  leisure: (center) => `${center.name || '康养中心'}附近 休闲 娱乐 活动`,
  shop: (center) => `${center.name || '康养中心'}附近 购物 特产 超市`,
  transit: (center) => `${center.name || '康养中心'}附近 交通 出行`,
};

/**
 * 按分类搜索周边富化信息
 * @param {string} category - food/spot/wellness/stay/leisure/shop/transit
 * @param {{name:string,lng:number,lat:number}} center
 * @param {number} timeoutMs - 超时毫秒，默认3000
 * @returns {Promise<{description:string, images:string[], rating_hint:string, source_results:Array}>}
 */
export async function searchCategory(category, center, timeoutMs = 3000) {
  if (!TAVILY_API_KEY) {
    return { description: '', images: [], rating_hint: '', source_results: [] };
  }

  const queryFn = CATEGORY_QUERIES[category];
  if (!queryFn) {
    return { description: '', images: [], rating_hint: '', source_results: [] };
  }

  const query = queryFn(center);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${TAVILY_BASE}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        max_results: 5,
        include_images: true,
        include_answer: true,
        search_depth: 'basic',
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`[tavily-nearby] ${category} search failed: HTTP ${resp.status}`);
      return { description: '', images: [], rating_hint: '', source_results: [] };
    }

    const data = await resp.json();

    // 提取 AI 摘要作为分类描述
    const description = data.answer || '';

    // 提取图片（最多3张）
    const images = Array.isArray(data.images) ? data.images.slice(0, 3) : [];

    // 提取评价提示（从结果标题/内容推断）
    let rating_hint = '';
    if (data.results && data.results.length > 0) {
      const titles = data.results.map((r) => r.title || '').join(' ');
      if (/好评|推荐|不错|值得|口碑佳|老字号/.test(titles)) {
        rating_hint = '口碑佳';
      } else if (/特色|招牌|正宗|地道/.test(titles)) {
        rating_hint = '特色推荐';
      }
    }

    // 按 name 模糊匹配，将结果关联到 POI
    const source_results = (data.results || []).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      content: (r.content || '').slice(0, 200),
    }));

    return { description, images, rating_hint, source_results };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.warn(`[tavily-nearby] ${category} search timeout (${timeoutMs}ms)`);
    } else {
      console.warn(`[tavily-nearby] ${category} search error:`, err.message);
    }
    return { description: '', images: [], rating_hint: '', source_results: [] };
  }
}

/**
 * 批量富化多个分类
 * @param {string[]} categories
 * @param {{name:string,lng:number,lat:number}} center
 * @param {number} timeoutMs
 * @returns {Promise<Record<string, {description,images,rating_hint,source_results}>>}
 */
export async function enrichCategories(categories, center, timeoutMs = 3000) {
  const results = await Promise.all(
    categories.map((cat) => searchCategory(cat, center, timeoutMs))
  );
  const map = {};
  categories.forEach((cat, i) => {
    map[cat] = results[i];
  });
  return map;
}

/**
 * 将 Tavily 富化结果匹配到具体 POI
 * @param {Array} pois - 已归一化的 POI 列表
 * @param {Record<string, {description,images,rating_hint,source_results}>} enrichMap
 * @returns {Array} 富化后的 POI 列表
 */
export function attachEnrichment(pois, enrichMap) {
  return pois.map((poi) => {
    const cat = poi.cat || 'other';
    const enrich = enrichMap[cat];
    if (!enrich) return poi;

    // 尝试按 name 在 source_results 中找到最匹配的
    let poi_description = '';
    let poi_images = [];

    if (enrich.source_results && enrich.source_results.length > 0) {
      const matched = enrich.source_results.find(
        (r) => r.title && poi.name && similarity(r.title, poi.name) > 0.4
      );
      if (matched) {
        poi_description = matched.content || '';
      }
    }

    // 如果没匹配到具体 POI，用分类级描述
    if (!poi_description && enrich.description) {
      poi_description = enrich.description.slice(0, 120);
    }

    // 图片：分类级图片
    if (enrich.images && enrich.images.length > 0) {
      poi_images = enrich.images.slice(0, 2);
    }

    return {
      ...poi,
      enriched_description: poi_description,
      enriched_images: poi_images,
      enriched_rating_hint: enrich.rating_hint || '',
    };
  });
}

/**
 * 简单字符串相似度（基于共同字符比例）
 */
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

export { TAVILY_API_KEY };
export default { searchCategory, enrichCategories, attachEnrichment };
