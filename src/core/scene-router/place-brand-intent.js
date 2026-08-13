/**
 * 地点品牌意图：裸说机构/生活圈 → 周边；带旅居路线信号 → 旅居。
 * 举一反三：品牌名不等于线路产品。
 */

const ROUTE_SIGNALS = /旅居|旅游|旅行|线路|路线|行程|规划|套餐|报名|预订|高铁|五日|三日游|文化线|边境线|康养线|体验线|休闲线/;

const NEARBY_SIGNALS = /周边|附近|生活圈|配套|地图|15\s*公?里|15km|打点|分布|大屏/;

/** 嘉路机构/生活圈话术（无路线信号时优先 nearby_resource） */
export function isJialuNearbyOnlyUtterance(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const hasJialuBrand = /嘉路/.test(t)
    && (/康养中心|了解嘉路|嘉路是什么|嘉路周边|嘉路康养|嘉路中心|以嘉路为中心|嘉路为中心|康养生活圈/.test(t)
      || /^(嘉路|嘉路康养|嘉路中心)$/.test(t));
  if (!hasJialuBrand) return false;
  if (ROUTE_SIGNALS.test(t) && !NEARBY_SIGNALS.test(t)) return false;
  return true;
}

/** 是否带明确旅居/线路规划信号 */
export function hasTravelRoutePlanSignal(text) {
  const t = String(text || '');
  return ROUTE_SIGNALS.test(t);
}
