import { includesTerm } from '../scoring-engine.js';

const travelTopicTerms = [
  '旅居', '旅游', '旅行', '康养', '旅养', '路线', '线路', '行程', '目的地', '基地', '景点',
  '广西', '百色', '南宁', '桂林', '北海', '巴马', '防城港', '钦州', '崇左',
  // 扩充目的地/产品类型词
  '三江', '龙胜', '靖西', '东兴', '河池', '涠洲岛',
  '德天瀑布', '明仕田园', '花山岩画', '银滩', '白浪滩', '百魔洞', '长寿村', '水晶宫', '赐福湖',
  '风雨桥', '鼓楼', '侗族', '瑶族', '壮族', '苗族',
  'winter care', 'travel route', 'route plan',
  // 防城港旅居试点线路相关场景词
  '防城港旅居', '旅居养老', '京族', '芒街', '十万大山', '嘉路', '嘉路康旅', '嘉路滨海',
  '银发爱情', '跨境', '非遗', '长寿', '药膳', '大本营', '康养基地', '旅居机构', '适老化旅居',
  '森林轻氧', '壮村民俗', '滨海文化', '边境风情',
  // 产品主题词（康养/滨海/文化/生态）
  '海边', '海滩', '海岛', '度假', '海鲜', '沙滩', '滨海',
  '民族文化', '古镇', '民俗', '百家宴', '大歌', '手作',
  '生态', '山水', '喀斯特', '溶洞', '瀑布', '梯田', '森林', '湿地', '漂流', '徒步', '摄影',
  '负氧离子', '地磁', '温泉', '养生', '疗养',
];

const routePlanSignalTerms = [
  '旅行路线', '旅游路线', '旅居路线', '康养路线', '旅行线路', '旅游线路', '旅居线路', '康养线路',
  '路线参考', '线路参考', '行程参考', '路线推荐', '线路推荐', '行程推荐',
  '规划路线', '规划线路', '安排路线', '安排线路', '规划旅居', '旅居规划',
  '帮我规划旅居路线', '帮我规划旅游路线', '帮我规划旅行路线',
  // 防城港5条线路产品名 + 套餐/定价信号
  '防城港旅居养老线路', '防城港五条线路', '防城港线路', '旅居养老线路', '京族滨海文化线',
  '银发爱情边境线', '壮村民俗康养线', '森林轻氧休闲线', '芒街跨境体验线', '五条旅居线路',
  '旅居套餐', '组合套餐', '单日单人', '零售价', '立减',
  '方案确认', '最终方案', '确认方案', '高铁票', '买票',
];

const travelIntentTerms = [
  '推荐', '规划', '安排', '生成', '制定', '对比', '查询', '查看', '预订', '报名',
  '怎么去', '适合去哪', '住哪里', '玩几天', '预算', '交通', '接驳', '天气', '无障碍',
  // 防城港线路意图词
  '线路详情', '线路介绍', '价格', '多少钱', '费用', '优惠', '套餐', '适合谁', '适配人群',
  '时间安排', '一日行程', '资源嵌入', '药膳', '康养', '跨境',
];

const elderTravelTerms = [
  '老人', '长者', '老年人', '爸妈', '父母', '家属', '慢病', '康复', '轮椅', '陪护',
  '安全',
  '适合老人', '长者玩法',
];

const productThemeTerms = [
  // 康养
  '负氧离子', '地磁', '温泉', '养生', '疗养', '康养', '长寿',
  // 滨海
  '海边', '海滩', '海岛', '度假', '海鲜', '沙滩', '滨海',
  // 文化
  '民族文化', '古镇', '民俗', '百家宴', '大歌', '非遗', '风雨桥', '鼓楼',
  // 生态
  '生态', '山水', '喀斯特', '溶洞', '瀑布', '梯田', '森林', '湿地', '漂流', '徒步', '摄影',
];

const bookingTerms = ['预订', '预约', '下单', '报名', '可订', '余量', '入住', '付款'];

export const travelRouteRuleSet = {
  scene_key: 'travel_route',
  default_intent: 'travel_route_plan',
  threshold: 6,
  template_candidates: ['route_svg', 'route_wellness', 'route_coastal', 'route_culture', 'route_ecology', 'sojourn_route', 'travel_itinerary_card', 'sojourn_base', 'booking_handoff', 'fallback'],
  required_data: ['gxy_travel_route_plan'],
  required_knowledge: ['travel_route', 'trace_route'],
  actions_allowed: [
    'travel_route.replan',
    'travel_route.fill_preferences',
    'travel_route.view_detail',
    'travel_route.check_availability',
    'travel_route.booking_handoff',
    'travel_route.compare_destinations',
    'travel_route.check_health_safety',
    'travel_route.check_weather_risk',
    'travel_route.calculate_budget',
    'travel_route.plan_transport',
    'travel_route.view_product_detail',
    'travel_route.request_manual_review',
  ],
  followup_policy: 'travel_route.default',
  evidence_groups: [
    { group: 'travel_topic', weight: 3, terms: travelTopicTerms },
    { group: 'route_plan_signal', weight: 4, terms: routePlanSignalTerms },
    { group: 'travel_intent', weight: 3, terms: travelIntentTerms },
    { group: 'product_theme', weight: 3, terms: productThemeTerms },
    { group: 'elder_travel_constraint', weight: 2, terms: elderTravelTerms },
    { group: 'booking', weight: 2, terms: bookingTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'village_doctor', 'community_doctor', 'care_worker', 'institution_admin', 'system_admin', 'admin'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'travel_route',
    weight: 5,
    terms: ['换一条', '重新规划', '调整', '对比', '预算', '交通', '天气', '预订', '这个', '这条', '继续'],
  },
  conflicts: [
    { group: 'meal_plan', penalty: 4, terms: ['膳食', '饮食', '早餐', '午餐', '晚餐', '菜谱', '控糖餐', '低盐'] },
    { group: 'dispatch_manage', penalty: 4, terms: ['派单', '工单', '调度', '处理进度', '客服'] },
    { group: 'acute_health_risk', penalty: 3.5, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '急救', '120'] },
    { group: 'nearby_resource', penalty: 4, terms: ['地图', '周边', '附近', '打点', '分布', '配套', '资源', '大屏', '15公里', '展示地图', '地图展示', '周边资源', '周边配套', '餐馆', '餐厅', '医疗', '医院', '嘉路康养中心', '嘉路周边', '生活圈'] },
    { group: 'service_quality_eval', penalty: 8, terms: ['服务质量', '质量评估', '服务评价', '满意度', '投诉', '整改', '评分', '督导', '质量报告'] },
    { group: 'health_risk_warning', penalty: 6, terms: ['血压', '血糖', '风险评估', '健康预警', '体质', '舌诊', '慢病风险', '预警报告', '心率异常', '血氧异常'] },
    { group: 'find_service', penalty: 5, terms: ['上门护理', '护工', '找服务', '养老机构', '服务目录', '下单服务', '预约护工'] },
  ],
  infer_intent(input) {
    if (has(input, bookingTerms)) return 'travel_route_booking';
    if (has(input, ['对比', '比较', '哪个更适合'])) return 'travel_route_compare';
    if (has(input, ['天气', '下雨', '温度'])) return 'travel_route_weather_risk';
    if (has(input, ['预算', '多少钱', '费用', '价格', '套餐', '优惠', '零售价', '立减'])) return 'travel_route_budget';
    if (has(input, ['交通', '接驳', '怎么去', '高铁', '机场', '高铁票'])) return 'travel_route_transport';
    if (has(input, ['基地', '康养基地', '住哪个基地'])) return 'travel_route_base';
    if (has(input, ['景点', '景区', '游玩', '适合老人'])) return 'travel_route_spot';
    if (has(input, ['医疗', '医院', '买药', '就医'])) return 'travel_route_medical';
    if (has(input, ['行程', '安排', '日程', '行程表', '时间安排'])) return 'travel_route_itinerary';
    if (has(input, ['规划', '制定', '生成', '路线参考', '线路参考', '行程参考', '路线推荐', '线路推荐', '行程推荐', '帮我规划'])) return 'travel_route_plan';
    if (has(input, ['方案', '确认', '总结', '最终方案'])) return 'travel_route_plan';
    if (has(input, ['详情', '介绍', '适合谁', '适配人群', '线路', '路线'])) return 'travel_route_query';
    return 'travel_route_plan';
  },
};

// ============================================================
// 产品类型推断：康养/滨海/文化/生态
// ============================================================

const ROUTE_TYPE_KEYWORDS = {
  route_wellness: ['康养', '旅居', '长寿', '养生', '负氧离子', '地磁', '温泉', '疗养', '百魔洞', '长寿村', '水晶宫', '赐福湖', '巴马', '慢病', '康复'],
  route_coastal:  ['滨海', '海滩', '海岛', '度假', '海鲜', '沙滩', '海边', '银滩', '白浪滩', '涠洲岛', '京族', '边境', '口岸', '防城港', '北海', '东兴'],
  route_culture:  ['民族文化', '古镇', '非遗', '民俗', '侗族', '瑶族', '壮族', '苗族', '风雨桥', '鼓楼', '百家宴', '大歌', '手作', '三江', '龙胜', '靖西', '花山'],
  route_ecology:  ['生态', '山水', '喀斯特', '溶洞', '瀑布', '梯田', '森林', '湿地', '漂流', '徒步', '摄影', '德天', '明仕', '崇左', '桂林'],
};

/**
 * 从用户输入推断产品类型
 * @param {string|object} input
 * @returns {string} route_wellness | route_coastal | route_culture | route_ecology
 */
export function inferRouteType(input) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');

  let bestType = 'route_wellness'; // 兜底
  let bestScore = 0;
  for (const [type, terms] of Object.entries(ROUTE_TYPE_KEYWORDS)) {
    const score = terms.filter((t) => includesTerm(text, t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }
  return bestType;
}

function has(input, terms) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  return terms.some((term) => includesTerm(text, term));
}
