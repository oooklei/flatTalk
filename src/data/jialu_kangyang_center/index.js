// 跨技能共享数据层：嘉路康养中心周边资源
// travel_route 与 nearby_resource 共用此单一数据源，避免重复维护 185KB 数据。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 嘉路康养中心中心坐标（GCJ-02，与高德/腾讯地图同源，可直接打点无需转换）
export const JIALU_CENTER = { lng: 108.166816, lat: 21.527905, name: '嘉路康养中心' };

// 默认检索半径（公里）
export const DEFAULT_RADIUS_KM = 15;

let facilitiesCache = null;

function loadFacilities() {
  if (facilitiesCache) return facilitiesCache;
  const file = path.join(__dirname, 'jialu_facilities.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    facilitiesCache = Array.isArray(raw) ? raw : raw.data || [];
  } catch (err) {
    console.error('[jialu_kangyang_center] 加载周边配套失败:', err.message);
    facilitiesCache = [];
  }
  return facilitiesCache;
}

/**
 * 获取嘉路康养中心周边配套
 * @param {Object} options
 * @param {string} options.type - 设施类型关键词（医院/餐厅/景点/医养…），按 category 或 amap_type 模糊匹配
 * @param {number} options.maxDistance - 最大距离（公里），默认 15
 * @param {number} options.limit - 返回条数
 * @returns {Array} POI 列表（按距离升序）
 */
// 类型别名：支持英文意图（stay/food/spot/leisure/shop/transit/wellness）与中文关键词双向匹配
// 真实数据来自「嘉路康养中心周边 15 公里生活圈」：民宿/康养小院、滨海景区、特色餐饮、垂钓休闲、购物、包车等
const TYPE_ALIASES = {
  stay: ['民宿', '住宿', '酒店', '旅馆', '客栈', '康养小院', '商务住宅', '入住', '住'],
  food: ['餐厅', '餐饮', '美食', '饭店', '酒楼', '小吃', '食', '海鲜', '私房菜', '大排档', '吃'],
  spot: ['景区', '景点', '公园', '游玩', '旅游', '文化', '博物', '游乐', '度假', '温泉', '海滨', '滨海', '海边', '游'],
  leisure: ['垂钓', '休闲', '体育', '娱乐', '健身', '钓', '娱'],
  shop: ['购物', '商店', '超市', '市场', '特产', '购'],
  transit: ['包车', '交通', '出租', '客运', '车站', '行'],
  wellness: ['医疗', '卫生', '药店', '诊所', '疾控', '保健', '养老', '医养', '医院', '养'],
};

// 分类元数据：与模板分类色、意图一一对应，供地图着色、筛选胶囊、POI 图标复用
export const CATEGORY_META = {
  stay: { key: 'stay', label: '住', emoji: '🏠', color: '#3B82A0', intent: 'nearby_resource.stay', desc: '民宿·康养小院' },
  food: { key: 'food', label: '吃', emoji: '🍜', color: '#F2994A', intent: 'nearby_resource.food', desc: '特色餐饮·海鲜' },
  spot: { key: 'spot', label: '游', emoji: '🏖️', color: '#2BAE8E', intent: 'nearby_resource.spot', desc: '滨海景区' },
  leisure: { key: 'leisure', label: '娱', emoji: '🎣', color: '#8E6FD8', intent: 'nearby_resource.leisure', desc: '垂钓·休闲' },
  shop: { key: 'shop', label: '购', emoji: '🛍️', color: '#E08AC0', intent: 'nearby_resource.shop', desc: '购物·特产' },
  transit: { key: 'transit', label: '行', emoji: '🚐', color: '#6B7A8F', intent: 'nearby_resource.transit', desc: '包车·交通' },
  wellness: { key: 'wellness', label: '养', emoji: '🏥', color: '#E5484D', intent: 'nearby_resource.wellness', desc: '医疗·康养' },
  other: { key: 'other', label: '其他', emoji: '📍', color: '#9AA7B2', intent: 'nearby_resource.all', desc: '其他配套' },
};

export function getJialuFacilities({ type = '', maxDistance = DEFAULT_RADIUS_KM, limit = 0 } = {}) {
  let list = loadFacilities().slice();

  const t = String(type || '').toLowerCase();
  if (t && t !== 'all' && t !== '全部') {
    const aliases = TYPE_ALIASES[t] || [t];
    list = list.filter((f) => {
      const category = (f.category || '').toLowerCase();
      const amapType = (f.amap_type || '').toLowerCase();
      const hay = category + ' ' + amapType;
      return aliases.some((a) => hay.includes(a));
    });
  }

  if (maxDistance > 0) {
    list = list.filter((f) => {
      const dist = parseFloat(f['距离_公里']) || 0;
      return dist <= maxDistance;
    });
  }

  list.sort((a, b) => {
    const da = parseFloat(a['距离_公里']) || 999;
    const db = parseFloat(b['距离_公里']) || 999;
    return da - db;
  });

  return limit > 0 ? list.slice(0, limit) : list;
}

// 统一分类标签（住/吃/游/娱/购/行/养），与 CATEGORY_META 对齐，供地图着色与筛选使用
// 注意：原始数据 category 为松散人工标签（常与 amap_type 不一致），amap_type（高德层级码）才是权威类型，
// 故以 amap_type 优先匹配，category 作为兜底，确保购物/医疗等真实资源不被淹没。
export function normalizeCategory(f) {
  const cat = (f.category || '').toLowerCase();
  const amap = (f.amap_type || '').toLowerCase();
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

export function getJialuCenter() {
  return JIALU_CENTER;
}

export default { JIALU_CENTER, DEFAULT_RADIUS_KM, getJialuFacilities, getJialuCenter, normalizeCategory, CATEGORY_META };
