import 'dotenv/config';
import { toSimplified } from '../../core/utils/simplified-chinese.js';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || process.env.WEB_SEARCH_API_KEY || '';
const TAVILY_BASE = String(process.env.TAVILY_BASE_URL || 'https://api.tavily.com').replace(/\/+$/, '');
const DISABLE_SIM_FALLBACK = process.env.FLATTALK_DISABLE_SIM_FALLBACK === '1'
  || process.env.FLATTALK_TAVILY_DISABLE_SIM_FALLBACK === '1';

const CATEGORY_QUERIES = {
  food: (center) => `${center.name || '嘉路康养中心'} 附近 餐厅 美食 老人友好 推荐`,
  spot: (center) => `${center.name || '嘉路康养中心'} 附近 景点 游玩 康养`,
  wellness: (center) => `${center.name || '嘉路康养中心'} 附近 医院 药店 社区卫生 服务`,
  stay: (center) => `${center.name || '嘉路康养中心'} 附近 民宿 康养 住宿`,
  leisure: (center) => `${center.name || '嘉路康养中心'} 附近 休闲 娱乐 活动`,
  shop: (center) => `${center.name || '嘉路康养中心'} 附近 购物 特产 超市`,
  transit: (center) => `${center.name || '嘉路康养中心'} 附近 交通 出行 包车`,
};

export async function searchCategory(category, center, timeoutMs = 3000, options = {}) {
  const queryFn = CATEGORY_QUERIES[category];
  if (!queryFn) return emptyResult('unsupported_category');
  const query = queryFn(center || {});

  if (!TAVILY_API_KEY) {
    return simulatedOrEmpty(category, center, 'not_configured', '未配置 TAVILY_API_KEY');
  }

  const attempts = [
    {
      name: 'search_basic_with_images',
      body: {
        query,
        max_results: 5,
        search_depth: 'basic',
        include_answer: 'basic',
        include_images: true,
      },
    },
    {
      name: 'search_basic_no_images',
      body: {
        query,
        max_results: 5,
        search_depth: 'basic',
        include_answer: true,
      },
    },
    {
      name: 'search_minimal',
      body: {
        query,
        max_results: 5,
      },
    },
  ];

  const errors = [];
  for (const attempt of attempts) {
    const response = await callTavily(attempt.body, timeoutMs, options.fetchImpl);
    if (response.ok) return normalizeTavilyResponse(response.data, attempt.name);
    errors.push({ attempt: attempt.name, status: response.status, error: response.error });
    if (response.status === 401 || response.status === 403) break;
  }

  return simulatedOrEmpty(category, center, 'remote_failed', errors[0]?.error || 'tavily_search_failed', { errors });
}

export async function enrichCategories(categories, center, timeoutMs = 3000, options = {}) {
  const unique = [...new Set((categories || []).filter(Boolean))];
  const results = await Promise.all(
    unique.map((cat) => searchCategory(cat, center, timeoutMs, options))
  );
  const map = {};
  unique.forEach((cat, index) => {
    map[cat] = results[index];
  });
  return map;
}

export function attachEnrichment(pois, enrichMap) {
  return (pois || []).map((poi) => {
    const cat = poi.cat || poi.category || 'other';
    const enrich = enrichMap?.[cat];
    if (!enrich) return poi;

    const matched = (enrich.source_results || []).find(
      (result) => result.title && poi.name && similarity(result.title, poi.name) > 0.4
    );
    let poiDescription = matched?.content || enrich.description || '';
    // ★ 兜底清洗：去除网页导航、SEO聚合页、重复句
    poiDescription = String(poiDescription)
      .replace(/首页|当前位置|景点大全>|排行榜|自助游|实景旅游|卫星地图/g, '')
      .replace(/(.{5,30})\1{2,}/g, '$1')
      .trim();
    // ★ 乱码检测：描述中乱码占比过高则丢弃
    const garbleRatio = (poiDescription.replace(/[\u4e00-\u9fa5a-zA-Z0-9\s（）()、，。！？；：·"%\-/]/g, '').length) / Math.max(poiDescription.length, 1);
    if (garbleRatio > 0.25) poiDescription = '';
    const poiImages = Array.isArray(enrich.images) ? enrich.images.slice(0, 2) : [];

    return {
      ...poi,
      enriched_description: String(poiDescription || '').slice(0, 160),
      enriched_images: poiImages,
      enriched_rating_hint: enrich.rating_hint || '',
      enriched_source_status: enrich.source_status || '',
      enriched_error: enrich.error || '',
    };
  });
}

async function callTavily(body, timeoutMs, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(`${TAVILY_BASE}/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TAVILY_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    const data = safeJson(text);
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: compactError(data?.detail || data?.error || data?.message || text || resp.statusText),
        data,
      };
    }
    return { ok: true, status: resp.status, data };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === 'AbortError' ? 'timeout' : 'request_error',
      error: error?.name === 'AbortError' ? `tavily_timeout_${timeoutMs}ms` : error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTavilyResponse(data = {}, attempt = '') {
  const rawResults = Array.isArray(data.results) ? data.results : [];
  // 质量过滤：剔除广告/旅行社/报名热线等非景点内容
  const results = rawResults.filter((item) => isQualitySpotResult(item));
  const description = typeof data.answer === 'string' ? data.answer : '';
  const images = Array.isArray(data.images) ? data.images.slice(0, 3) : [];
  const titles = results.map((item) => item.title || '').join(' ');
  return {
    description: toSimplified(description),
    images,
    rating_hint: toSimplified(inferRatingHint(titles)),
    source_results: results.map((item) => ({
      title: toSimplified(item.title || ''),
      url: item.url || '',
      content: toSimplified(String(item.content || item.raw_content || '').slice(0, 240)),
    })),
    source_status: 'real_data',
    remote_api: attempt,
  };
}

// 垃圾内容关键词黑名单（旅行社广告、报名热线、旅游网站聚合页等）
const SPAM_KEYWORDS = [
  'whatsapp', '報名', '报名', '熱線', '热线', '查詢熱線', '查询热线',
  '华侨城旅游网', '旅游网', '旅行團', '旅行团', '觀光團', '观光团',
  '广东旅行团', '专线', 'logo', '報名及查詢',
  '行程定制', '旅游报价', '跟团游', '自由行套餐',
];
// 非景点类域名
const SPAM_DOMAINS = [
  'travelce', 'tripadvisor', 'ctrip', 'qunar', 'tuniu',
  'mafengwo', 'lvmama', 'fliggy', 'booking.com',
];

function isQualitySpotResult(item = {}) {
  const title = String(item.title || '').toLowerCase();
  const content = String(item.content || '').toLowerCase();
  const url = String(item.url || '').toLowerCase();
  const text = `${title} ${content}`;

  // 域名黑名单
  if (SPAM_DOMAINS.some((d) => url.includes(d))) return false;

  // 关键词黑名单
  const hitSpam = SPAM_KEYWORDS.find((kw) => {
    const k = kw.toLowerCase();
    return title.includes(k) || content.includes(k);
  });
  if (hitSpam) return false;

  // 标题太短（<4字符）或纯数字符号
  if (title.replace(/[\s\W_]/g, '').length < 4) return false;

  // 内容含大量电话号码（连续8位以上数字）→ 广告
  if (/\d{8,}/.test(content)) return false;

  // 标题含 logo / 网站名 → 非景点
  if (/^logo\b|旅游网$|景点网$/.test(title)) return false;

  // ★ SEO 聚合页 / 网页导航特征检测
  if (/景点大全|排行榜|自助游|攻略|首页|当前位置|实景|卫星地图|广场/.test(text)) return false;

  // ★ 乱码检测：标题中非中文/英文/数字/常见标点的字符占比过高
  const titleGarble = (title.replace(/[\u4e00-\u9fa5a-zA-Z0-9\s（）()、，。·\-_|]/g, '').length) / Math.max(title.length, 1);
  if (titleGarble > 0.3) return false;

  // ★ 描述乱码检测
  const contentGarble = (content.replace(/[\u4e00-\u9fa5a-zA-Z0-9\s（）()、，。！？；：·"%\-/]/g, '').length) / Math.max(content.length, 1);
  if (contentGarble > 0.25) return false;

  return true;
}

function simulatedOrEmpty(category, center, reason, error, extra = {}) {
  if (DISABLE_SIM_FALLBACK) return { ...emptyResult(reason), error, ...extra };
  return {
    ...buildSimulatedEnrichment(category, center),
    source_status: 'simulated_fallback',
    degraded: reason,
    error,
    ...extra,
  };
}

function emptyResult(reason = 'empty') {
  return {
    description: '',
    images: [],
    rating_hint: '',
    source_results: [],
    source_status: reason,
  };
}

function buildSimulatedEnrichment(category, center = {}) {
  const name = center?.name || '嘉路康养中心';
  const map = {
    food: '周边餐饮以海鲜、家常菜和简餐为主，适合老人选择清淡少油、就近步行或短途接送的门店。',
    spot: '周边景点以滨海慢行、低强度观景为主，建议避开高温时段并安排充足休息。',
    wellness: '周边医疗资源建议优先核实营业时间、药品覆盖和急诊可达性，慢病老人出行前准备常用药。',
    stay: '住宿建议选择电梯、无障碍通道、安静房型和可协助联系车辆的场所。',
    leisure: '休闲活动宜选择低强度、可中途休息、离中心较近的项目。',
    shop: '购物补给以超市、药店、特产店为主，建议按老人常用物品清单提前采购。',
    transit: '出行建议优先预约车辆或短途接驳，减少老人等待和步行距离。',
  };
  return {
    description: `${name}${map[category] || '周边资源可按老人身体状态和距离优先级筛选。'}`,
    images: [],
    rating_hint: '仿真参考',
    source_results: [{
      title: `${name}周边${category || '资源'}仿真说明`,
      url: '',
      content: map[category] || '真实 Tavily 搜索不可用时用于业务降级展示。',
    }],
  };
}

function inferRatingHint(text) {
  if (/好评|推荐|不错|值得|口碑|老人友好/.test(text)) return '口碑较好';
  if (/特色|招牌|正宗|地道/.test(text)) return '特色推荐';
  return '';
}

function safeJson(text) {
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

function compactError(value) {
  return String(Array.isArray(value) ? value.map((item) => item.msg || JSON.stringify(item)).join('; ') : value || '').slice(0, 300);
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(String(a).toLowerCase().split(''));
  const setB = new Set(String(b).toLowerCase().split(''));
  let common = 0;
  for (const ch of setA) if (setB.has(ch)) common += 1;
  return common / Math.max(setA.size, setB.size, 1);
}

export { TAVILY_API_KEY };
export default { searchCategory, enrichCategories, attachEnrichment };
