// 周边资源类卡片：nearby_map_overview / nearby_map_category / nearby_map_route / nearby_radar /
// nearby_compare / nearby_recommend / nearby_wellness / nearby_stay_card / nearby_food_card /
// nearby_spot_card / nearby_list / nearby_summary。
// 决策核心是 nbDecide：基于消息关键词 + intent_context 推断分类与模板。
// 地图静态图降级 URL 走 utils.buildStaticMapUrl（与 travel-cards 共享）。

import { sanitizeModelResult, buildStaticMapUrl, NEARBY_TENCENT_JS_KEY } from './utils.js';
import { nearbyEntityParams, withEntityParams } from '../conversation/entity-params.js';

const NB_COLORS = {
  stay: '#3B82A0', food: '#F2994A', spot: '#2BAE8E', leisure: '#8E6FD8',
  shop: '#E08AC0', transit: '#6B7A8F', wellness: '#E5484D', other: '#9AA7B2',
};

const NB_EMOJI = {
  stay: '🏠', food: '🍜', spot: '🏖️', leisure: '🎣',
  shop: '🛍️', transit: '🚐', wellness: '🏥', other: '📍',
};

function fillNearbyResourceCard({
  message = '', business_data = {}, intent_context = {}, template_id: incomingTemplateId = '',
} = {}) {
  // 取数：优先使用 orchestrator 注入的共享数据层结果（已为全量周边配套）
  const facilities = Array.isArray(business_data?.jialu_facilities) ? business_data.jialu_facilities : [];
  const center = business_data?.jialu_center || { lng: 108.166816, lat: 21.527905, name: '嘉路康养中心' };
  const intent = intent_context?.intent || 'nearby_resource.all';
  const actionKey = intent_context?.action_key || '';
  const radiusKm = parseInt(String(message).match(/(\d+)\s*(公里|千米|km)/i)?.[1] || '15', 10);

  // 归一化全部 POI；距离一律按当前中心重算（避免嘉路静态「距离_公里」在 GPS 中心下误用）
  const all = (facilities || []).map((f) => {
    const m = nbToMarker(f);
    if (center?.lat && center?.lng && m.lat && m.lng) {
      const km = nbHaversineKm(center.lat, center.lng, m.lat, m.lng);
      m.distance = Number(km.toFixed(2));
      m.distance_text = m.distance.toFixed(1);
    }
    return m;
  }).filter((m) => m.lng && m.lat);
  const within = all.filter((m) => m.distance <= radiusKm); // 康养生活圈半径过滤
  const stats = nbBuildStats(within);

  // 决定分类与模板（基于意图 + 语义）
  const decided = nbDecide({ message, intent, actionKey });
  const cat = decided.cat;
  // 模板以上游选定值为准：它可能来自 LIS 下发的 template_id（与 catalog 1:1 绑定），
  // 优先级高于 nbDecide 的关键词猜测。cat 仍由 nbDecide 决定 —— 它用于筛 POI，
  // 与出哪张卡是两件事。
  const template_id = incomingTemplateId || decided.template_id;
  const catMarkers = cat ? within.filter((m) => m.cat === cat) : within;

  const center_json = JSON.stringify(center);
  const base = {
    centerName: center.name || '嘉路康养中心',
    centerLat: center.lat,
    centerLng: center.lng,
    radiusKm,
    map_key: process.env.TENCENT_MAP_JS_KEY || NEARBY_TENCENT_JS_KEY,
    center_json,
    stats,
    statsLabels: nbStatsLabels(stats),
    category: cat,
    categoryLabel: nbCatLabel(cat),
    isDefaultLocation: business_data?._is_default_location || false,
  };

  let markers = template_id === 'nearby_map_overview' ? within : catMarkers;
  const total = markers.length;
  // 生成静态图降级 URL（用 WebService Key+SK 签名，与前端 JS Key 独立）
  base.static_map_url = buildStaticMapUrl(center, markers.slice(0, 30));
  base.static_map_url_json = JSON.stringify(base.static_map_url || '');
  const answerText = nbAnswerText({ template_id, cat, total, radiusKm, stats });
  const nearbyParams = nearbyEntityParams({
    center: center.name || '嘉路康养中心',
    center_name: center.name || '嘉路康养中心',
  }, business_data || {});
  const data = {
    ...base,
    center: nearbyParams.center || center.name || '嘉路康养中心',
    markers,
    markers_json: JSON.stringify(markers),
    total,
  };

  // 移动端静态渲染：Mustache 可直接渲染的 POI 列表 + 预计算导航链接
  const NAV_REFERER = 'KI4BZ-5GGLT-POOXY-LQK77-6XA62-YVFPH';
  const buildNavUrl = (p) =>
    `https://apis.map.qq.com/uri/v1/routeplan?type=walk&from=coord:${center.lat},${center.lng};title:${encodeURIComponent(center.name || '当前位置')}&to=coord:${p.lat},${p.lng};title:${encodeURIComponent(p.name || '')}&policy=1&referer=${NAV_REFERER}`;
  data.poi_items = markers.map((p) => ({
    emoji: p.emoji || '📍',
    name: p.name || '未命名',
    distance_text: p.distance_text || `${(parseFloat(p.distance) || 0).toFixed(1)}km`,
    address: p.address || '地址未知',
    biz_status: p.biz_status || '',
    open_time: p.open_time || '',
    tags_text: p.tags_text || '',
    tel: p.tel || '',
    color: p.color || '#9AA7B2',
    cat: p.cat || 'other',
    nav_url: buildNavUrl(p),
  }));
  data.has_poi_items = data.poi_items.length > 0;
  data.static_map_img = base.static_map_url || '';
  data.has_static_map = !!data.static_map_img;

  // 对比 / 推荐：提取 Top3（标签多、距离近优先）
  if (template_id === 'nearby_compare' || template_id === 'nearby_recommend') {
    const pool = catMarkers.length ? catMarkers : within;
    data.picks = nbPickTop(pool, 3).map((m, i) => ({ ...nbWithReason(m), rank: i + 1 }));
    data.picks_json = JSON.stringify(data.picks);
  }
  // 路线：编排一日康养游
  if (template_id === 'nearby_map_route') {
    data.routeStops = nbBuildRoute(within);
    data.routeStops_json = JSON.stringify(data.routeStops);
    markers = within;
    data.markers = markers;
    data.markers_json = JSON.stringify(markers);
    data.total = markers.length;
    // 移动端静态渲染：路线步骤 Mustache 数组
    data.route_steps = data.routeStops.map((p, i) => ({
      index: i + 1,
      emoji: p.emoji || '📍',
      name: p.name || '未命名',
      role: p.role || '',
      distance_text: `${(parseFloat(p.distance) || 0).toFixed(1)}km`,
      biz_status: p.biz_status || '营业中',
      tags_text: p.tags_text || '',
      color: p.color || '#E8843C',
      nav_url: buildNavUrl(p),
    }));
    data.has_route_steps = data.route_steps.length > 0;
  }
  // 雷达：步行可达（≤1.5km）
  if (template_id === 'nearby_radar') {
    data.walkItems = within.filter((m) => m.distance <= 1.5);
    data.walkCount = data.walkItems.length;
    data.walkItems_json = JSON.stringify(data.walkItems);
    // 移动端静态渲染
    data.poi_items = data.walkItems.map((p) => ({
      emoji: p.emoji || '📍',
      name: p.name || '未命名',
      distance_text: p.distance_text || `${(parseFloat(p.distance) || 0).toFixed(1)}km`,
      address: p.address || '地址未知',
      biz_status: p.biz_status || '',
      open_time: p.open_time || '',
      tags_text: p.tags_text || '',
      tel: p.tel || '',
      color: p.color || '#9AA7B2',
      cat: p.cat || 'other',
      nav_url: buildNavUrl(p),
    }));
    data.has_poi_items = data.poi_items.length > 0;
  }
  // 康养配套：养 + 住（康养小院/医疗）
  if (template_id === 'nearby_wellness') {
    const wi = within.filter((m) => m.cat === 'wellness' || m.cat === 'stay');
    data.wellnessItems = wi;
    data.wellnessItems_json = JSON.stringify(wi);
    markers = wi;
    data.markers = markers;
    data.markers_json = JSON.stringify(markers);
    data.total = wi.length;
  }
  // 语音摘要
  if (template_id === 'nearby_summary') {
    data.summaryText = nbSummaryText({ radiusKm, stats });
  }

  const compactFollowups = [
    {
      label: '周边导航',
      action_key: 'nearby_resource.route',
      input: {
        type: 'select',
        placeholder: '选择目的地类型',
        param_key: 'category',
        options: [
          { value: 'food', label: '🍽️ 餐饮' },
          { value: 'stay', label: '🏠 住宿' },
          { value: 'spot', label: '🏖️ 景点' },
          { value: 'medical', label: '🏥 医疗' },
          { value: 'leisure', label: '🎣 休闲' },
        ],
      },
    },
  ];

  return sanitizeModelResult({
    template_id,
    answer_text: answerText,
    answer: answerText,
    data,
    actions: nbActions(),
    followup_suggestions: nbFollowups(nearbyParams),
    compact_followups: withEntityParams(compactFollowups, nearbyParams),
    template_fit_notes: ['nearby_resource_' + (cat || 'all')],
  });
}

function nbHaversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 将原始 POI 映射为模板统一字段（评分字段真实数据为空，固定留空，改用距离/标签作质量信号）
function nbToMarker(f) {
  // 腾讯检索会预写英文 cat（stay/food/…）；nbCat 主要认中文 amap_type，
  // 若忽略预写 cat，易全部落到 other → 图例住/吃/游全 0，但「全部」仍有点位。
  const preset = String(f.cat || '').toLowerCase();
  const cat = (preset && NB_COLORS[preset]) ? preset : nbCat(f);
  const raw = String(f.service_tags || '');
  const tags = raw.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  return {
    poi_id: f.poi_id || '',
    name: f.name || f.名称 || '未命名',
    address: f.address || f.地址 || '',
    lng: parseFloat(f.lng ?? f.经度) || 0,
    lat: parseFloat(f.lat ?? f.纬度) || 0,
    distance: parseFloat(f['距离_公里'] ?? f.distance) || 0,
    distance_text: (parseFloat(f['距离_公里'] ?? f.distance) || 0).toFixed(1),
    category: f.category || '',
    amap_type: f.amap_type || '',
    cat,
    color: NB_COLORS[cat] || NB_COLORS.other,
    emoji: NB_EMOJI[cat] || NB_EMOJI.other,
    biz_status: String(f.biz_status || '').trim(),
    tel: f.tel || f.电话 || '',
    open_time: String(f.open_time || '').trim(),
    tags,
    tags_text: tags.join('·'),
    rating: '',
    // ★ 预编码的导航参数 JSON（避免 Mustache 转义破坏 JSON）
    nav_params: JSON.stringify({ lat: parseFloat(f.lat ?? f.纬度) || 0, lng: parseFloat(f.lng ?? f.经度) || 0, name: f.name || f.名称 || '未命名' }),
    // ★ 富化字段透传
    source: f._source || 'local',
    enriched_description: f.enriched_description || '',
    enriched_images: f.enriched_images || [],
    enriched_rating_hint: f.enriched_rating_hint || '',
  };
}

function nbCat(f) {
  const cat = (String(f.category || '')).toLowerCase();
  const amap = (String(f.amap_type || '')).toLowerCase();
  // 英文 category key（腾讯周边检索写入）直接认可
  if (NB_COLORS[cat] && cat !== 'other') return cat;
  if (/垂钓|钓鱼/.test(amap)) return 'leisure';
  if (/药房|医药|保健|医疗|卫生|疾控|诊所|医院|养老/.test(amap)) return 'wellness';
  if (/购物|市场|超市|商店|便利店|专卖店|农副|特产|商场/.test(amap)) return 'shop';
  if (/海滨浴场|风景名胜|公园|广场|寺庙|教堂|纪念馆|科技馆|水族馆|观景点|景点|旅游|湿地/.test(amap)) return 'spot';
  if (/体育休闲|休闲场所|休闲娱乐|度假|营地|游乐/.test(amap)) return 'leisure';
  if (/餐饮|餐厅|酒楼|饭店|食|海鲜/.test(amap)) return 'food';
  if (/住宿|酒店|旅馆|招待所|宾馆|客栈|民宿/.test(amap)) return 'stay';
  if (/包车|租赁|停车场|车站|交通|道路|公交|地铁/.test(amap)) return 'transit';
  if (/民宿|康养小院|商务住宅/.test(cat)) return 'stay';
  if (/餐厅|餐饮|美食|饭店|私房菜|大排档/.test(cat)) return 'food';
  if (/景区|景点|滨海|海边/.test(cat)) return 'spot';
  if (/垂钓|休闲|钓鱼/.test(cat)) return 'leisure';
  if (/购物|特产|买/.test(cat)) return 'shop';
  if (/包车|交通/.test(cat)) return 'transit';
  if (/医养|养老|wellness|eldercare|medical/.test(cat)) return 'wellness';
  return 'other';
}

function nbDecide({ message, intent, actionKey }) {
  const m = String(message || '');
  const isIntent = (s) => intent === s;
  const wantMap = /地图|分布|打点|标记|位置|在哪|大屏|标出来|看地图|周边分布|资源分布/.test(m);
  const wantRoute = /规划|一天|路线|行程|怎么玩|怎么安排|攻略|itinera|玩法/.test(m);
  const wantRadar = /步行|走路|可达|近一点|附近走|溜达|遛弯|走路能到/.test(m);
  const wantCompare = /对比|比较|哪家好|哪个好|选哪个|挑一个|怎么选/.test(m);
  const wantRecommend = /推荐|适合|给我挑|有个性的|个性化|精选|必去|必吃|挑几个/.test(m);
  // 注意：「康养」二字因出现在中心名「嘉路康养中心」中过于宽泛，故仅匹配明确的康养/医养意图
  const wantWellness = /康养配套|医养|养老设施|康养生态|适老|医疗康养/.test(m);
  const wantNearbyPlace = /附近|周边|周围|地图|分布|在哪|生活圈/.test(m);
  const wantSummary = /简单|语音|念|概括|小结|告诉我有什么|大概|罗列一下|一句话|语音播报/.test(m);

  let cat = '';
  // 优先从 action_key 推断分类（bypass 路径）
  if (actionKey === 'nearby_resource.stay') cat = 'stay';
  else if (actionKey === 'nearby_resource.food') cat = 'food';
  else if (actionKey === 'nearby_resource.spot') cat = 'spot';
  else if (actionKey === 'nearby_resource.leisure') cat = 'leisure';
  else if (actionKey === 'nearby_resource.shop') cat = 'shop';
  else if (actionKey === 'nearby_resource.transit') cat = 'transit';
  else if (actionKey === 'nearby_resource.wellness' || actionKey === 'nearby_resource.medical') cat = 'wellness';
  if (!cat) {
    if (isIntent('nearby_resource.stay')) cat = 'stay';
    else if (isIntent('nearby_resource.food')) cat = 'food';
    else if (isIntent('nearby_resource.spot')) cat = 'spot';
    else if (isIntent('nearby_resource.leisure')) cat = 'leisure';
    else if (isIntent('nearby_resource.shop')) cat = 'shop';
    else if (isIntent('nearby_resource.transit')) cat = 'transit';
    else if (isIntent('nearby_resource.wellness')) cat = 'wellness';
  }
  if (!cat) {
    if (/民宿|住哪|住宿|康养小院|入住/.test(m)) cat = 'stay';
    else if (/吃|餐厅|餐饮|美食|海鲜|私房菜|大排档/.test(m)) cat = 'food';
    else if (/景区|景点|海边|滨海|游玩|玩/.test(m)) cat = 'spot';
    else if (/垂钓|休闲|钓鱼|娱乐/.test(m)) cat = 'leisure';
    else if (/购物|特产|买/.test(m)) cat = 'shop';
    else if (/包车|交通|怎么去|出行/.test(m)) cat = 'transit';
    else if (/医养|医疗|养老机构|养老院|敬老院/.test(m)) cat = 'wellness';
  }

  // 展示形态优先（与分类无关）
  if (wantSummary) return { cat, template_id: 'nearby_summary' };
  if (wantRoute) return { cat, template_id: 'nearby_map_route' };
  if (wantRadar) return { cat, template_id: 'nearby_radar' };
  if (wantCompare) return { cat, template_id: 'nearby_compare' };
  if (wantRecommend) return { cat, template_id: 'nearby_recommend' };
  if (wantMap) return { cat: cat || '', template_id: cat ? 'nearby_map_category' : 'nearby_map_overview' };
  // 分类意图优先于 wellness（避免「康养小院」被误判为医养）
  // 「只看医疗 / medical」必须走分类地图且仅 wellness，禁止 nearby_wellness（会混入 stay 住宿）
  if (actionKey === 'nearby_resource.medical' || isIntent('nearby_resource.medical') || /只看医疗|医疗资源/.test(m)) {
    return { cat: 'wellness', template_id: 'nearby_map_category' };
  }
  // 「附近有养老机构吗」等：要地图分布，不要无地图的 nearby_wellness 列表卡（否则用户感知为「地图空白」）
  if (wantNearbyPlace && (cat === 'wellness' || /养老机构|养老院|敬老院|医疗|医养/.test(m))) {
    return { cat: 'wellness', template_id: 'nearby_map_category' };
  }
  if (cat === 'wellness' || (wantWellness && !cat)) return { cat: cat || 'wellness', template_id: 'nearby_wellness' };
  if (cat === 'stay') return { cat, template_id: 'nearby_stay_card' };
  if (cat === 'food') return { cat, template_id: 'nearby_food_card' };
  if (cat === 'spot') return { cat, template_id: 'nearby_spot_card' };
  if (cat === 'leisure' || cat === 'shop' || cat === 'transit') return { cat, template_id: 'nearby_list' };
  return { cat: '', template_id: 'nearby_map_overview' };
}

function nbCatLabel(cat) {
  return {
    stay: '民宿', food: '餐饮', spot: '景区', leisure: '休闲',
    shop: '购物', transit: '交通', wellness: '康养', '': '全部',
  }[cat] || '资源';
}

function nbBuildStats(within) {
  const s = { stay: 0, food: 0, spot: 0, leisure: 0, shop: 0, transit: 0, wellness: 0, other: 0 };
  within.forEach((m) => { s[m.cat] = (s[m.cat] || 0) + 1; });
  s.total = within.length;
  return s;
}

function nbStatsLabels(stats) {
  const order = [
    ['stay', '住', '🏠'], ['food', '吃', '🍜'], ['spot', '游', '🏖️'], ['leisure', '娱', '🎣'],
    ['shop', '购', '🛍️'], ['transit', '行', '🚐'], ['wellness', '养', '🏥'],
  ];
  return order.map(([k, label, emoji]) => ({ key: k, label, emoji, count: stats[k] || 0, color: NB_COLORS[k] }));
}

function nbPickTop(pool, n) {
  return pool.slice().sort((a, b) => (b.tags.length - a.tags.length) || (a.distance - b.distance)).slice(0, n);
}

function nbWithReason(m) {
  let reason;
  if (m.cat === 'wellness') reason = '医养配套，适老安心';
  else if (m.tags && m.tags.length) reason = '招牌：' + m.tags_text;
  else reason = '距中心仅 ' + (parseFloat(m.distance) || 0).toFixed(1) + 'km，出行方便';
  return { ...m, reason };
}

function nbBuildRoute(within) {
  const nearest = (c) => within.filter((m) => m.cat === c).sort((a, b) => a.distance - b.distance)[0];
  const food2 = within.filter((m) => m.cat === 'food').sort((a, b) => a.distance - b.distance)[1];
  const stops = [];
  const stay = nearest('stay'); if (stay) stops.push({ ...stay, role: '入住·出发' });
  const food1 = nearest('food'); if (food1) stops.push({ ...food1, role: '早餐' });
  const spot = nearest('spot'); if (spot) stops.push({ ...spot, role: '滨海游玩' });
  const lei = nearest('leisure'); if (lei) stops.push({ ...lei, role: '休闲体验' });
  if (food2) stops.push({ ...food2, role: '午餐 / 晚餐' });
  if (stay) stops.push({ ...stay, role: '返回·入住' });
  return stops;
}

function nbAnswerText({ template_id, cat, total, radiusKm }) {
  const catName = {
    stay: '住宿（民宿/康养小院）', food: '特色餐饮', spot: '滨海景区', leisure: '垂钓休闲',
    shop: '购物特产', transit: '包车交通', wellness: '医疗康养', '': '各类生活配套',
  }[cat] || '各类生活配套';
  if (template_id === 'nearby_summary') return `已生成嘉路康养中心 ${radiusKm} 公里生活圈语音摘要。`;
  if (template_id === 'nearby_map_route') return '已为您编排一条「一日康养游」路线，串联周边精华配套。';
  if (template_id === 'nearby_radar') return `已标注 ${radiusKm} 公里生活圈内可步行直达的配套。`;
  if (template_id === 'nearby_wellness') return `已汇总嘉路周边康养配套（共 ${total} 个）。`;
  return `已为您整理嘉路康养中心周边 ${radiusKm} 公里内的${catName}（共 ${total} 个）。`;
}

function nbActions() {
  // 聊天侧只走追问，避免与 nbFollowups / compact 重复堆按钮
  return [];
}

function nbFollowups(extra = {}) {
  const params = nearbyEntityParams({ center: '嘉路康养中心', ...extra }, extra);
  return withEntityParams([
    { label: '全部配套', user_prompt: '嘉路周边全部配套', action_key: 'nearby_resource.all' },
    { label: '只看滨海景区', user_prompt: '嘉路周边滨海景区分布图', action_key: 'nearby_resource.spot' },
    { label: '附近能吃饭的', user_prompt: '嘉路周边餐厅餐饮推荐', action_key: 'nearby_resource.food' },
    { label: '规划一日游', user_prompt: '帮我规划嘉路周边一日康养游路线', action_key: 'nearby_resource.route' },
    { label: '步行可达', user_prompt: '嘉路周边步行能到的配套', action_key: 'nearby_resource.radar' },
    { label: '康养配套', user_prompt: '嘉路周边康养配套', action_key: 'nearby_resource.wellness' },
  ], params);
}

function nbSummaryText({ radiusKm, stats }) {
  const parts = [];
  if (stats.stay) parts.push(`住 ${stats.stay} 处（民宿、康养小院）`);
  if (stats.food) parts.push(`吃 ${stats.food} 家（海鲜、私房菜）`);
  if (stats.spot) parts.push(`游 ${stats.spot} 个滨海景区`);
  if (stats.leisure) parts.push(`娱 ${stats.leisure} 处垂钓休闲`);
  if (stats.shop) parts.push(`购 ${stats.shop} 处特产购物`);
  if (stats.transit) parts.push(`行 ${stats.transit} 处包车交通`);
  if (stats.wellness) parts.push(`养 ${stats.wellness} 处医疗康养`);
  const body = parts.length ? parts.join('，') : '暂无配套收录';
  return `嘉路康养中心 ${radiusKm} 公里康养生活圈共收录 ${stats.total} 个配套：${body}。想看哪类，点下方按钮看地图或清单。`;
}

export {
  fillNearbyResourceCard,
};
