import { includesTerm } from '../scoring-engine.js';

const travelTopicTerms = [
  '旅居', '旅游', '旅行', '康养', '旅养', '路线', '线路', '行程', '目的地', '基地', '景点',
  '广西', '百色', '南宁', '桂林', '北海', '巴马', '防城港', '钦州', '崇左',
  'winter care', 'travel route', 'route plan',
  // 防城港旅居试点线路相关场景词
  '防城港旅居', '旅居养老', '京族', '芒街', '东兴', '十万大山', '嘉路', '嘉路康旅', '嘉路滨海',
  '银发爱情', '跨境', '非遗', '长寿', '药膳', '大本营', '康养基地', '旅居机构', '适老化旅居',
  '森林轻氧', '壮村民俗', '滨海文化', '边境风情',
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
  '血压', '糖尿病', '心脏', '医疗', '医院', '安全',
];

const bookingTerms = ['预订', '预约', '下单', '报名', '可订', '余量', '入住', '付款'];

export const travelRouteRuleSet = {
  scene_key: 'travel_route',
  default_intent: 'travel_route_plan',
  threshold: 8,
  template_candidates: ['travel_itinerary_card', 'route_card', 'base_candidates', 'booking_handoff', 'fallback'],
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
    { group: 'elder_travel_constraint', weight: 2, terms: elderTravelTerms },
    { group: 'booking', weight: 2, terms: bookingTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'travel_base', 'system_admin'],
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
  ],
  infer_intent(input) {
    if (has(input, bookingTerms)) return 'travel_route_booking';
    if (has(input, ['对比', '比较', '哪个更适合'])) return 'travel_route_compare';
    if (has(input, ['天气', '下雨', '温度'])) return 'travel_route_weather_risk';
    if (has(input, ['预算', '多少钱', '费用', '价格', '套餐', '优惠', '零售价', '立减'])) return 'travel_route_budget';
    if (has(input, ['交通', '接驳', '怎么去', '高铁', '机场'])) return 'travel_route_transport';
    if (has(input, ['详情', '介绍', '适合谁', '适配人群', '时间安排', '一日行程', '资源嵌入', '线路', '路线'])) return 'travel_route_query';
    return 'travel_route_plan';
  },
};

function has(input, terms) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  return terms.some((term) => includesTerm(text, term));
}
