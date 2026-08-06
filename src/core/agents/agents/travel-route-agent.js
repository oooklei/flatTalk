import { createBaseAgent } from '../base-agent.js';

// 与 scene-router/rules/travel-route.js evidence_groups 对齐
const travelTopicTerms = [
  '旅居', '旅游', '旅行', '康养', '旅养', '路线', '线路', '行程', '目的地', '基地', '景点',
  '广西', '百色', '南宁', '桂林', '北海', '巴马', '防城港', '钦州', '崇左',
  'winter care', 'travel route', 'route plan',
  // 防城港旅居试点线路场景词
  '防城港旅居', '旅居养老', '京族', '芒街', '东兴', '十万大山', '嘉路', '嘉路康旅', '嘉路滨海',
  '银发爱情', '跨境', '非遗', '长寿', '药膳', '大本营', '康养基地', '旅居机构', '适老化旅居',
  '森林轻氧', '壮村民俗', '滨海文化', '边境风情',
];
const routePlanSignalTerms = [
  '旅行路线', '旅游路线', '旅居路线', '康养路线', '旅行线路', '旅游线路', '旅居线路', '康养线路',
  '路线参考', '线路参考', '行程参考', '路线推荐', '线路推荐', '行程推荐',
  '规划路线', '规划线路', '安排路线', '安排线路', '规划旅居', '旅居规划',
  '帮我规划旅居路线', '帮我规划旅游路线', '帮我规划旅行路线',
  // 防城港 5 条线路产品名 + 套餐/定价信号
  '防城港旅居养老线路', '防城港五条线路', '防城港线路', '旅居养老线路', '京族滨海文化线',
  '银发爱情边境线', '壮村民俗康养线', '森林轻氧休闲线', '芒街跨境体验线', '五条旅居线路',
  '旅居套餐', '组合套餐', '单日单人', '零售价', '立减',
  '方案确认', '最终方案', '确认方案', '高铁票', '买票',
];
const travelIntentTerms = [
  '推荐', '规划', '安排', '生成', '制定', '对比', '查询', '查看', '预订', '报名',
  '怎么去', '适合去哪', '住哪里', '玩几天', '预算', '交通', '接驳', '天气', '无障碍',
  '线路详情', '线路介绍', '价格', '多少钱', '费用', '优惠', '套餐', '适合谁', '适配人群',
  '时间安排', '一日行程', '资源嵌入', '药膳', '康养', '跨境',
];
const elderTravelTerms = [
  '老人', '长者', '老年人', '爸妈', '父母', '家属', '慢病', '康复', '轮椅', '陪护',
  '血压', '糖尿病', '心脏', '医疗', '医院', '安全',
  '适合老人', '长者玩法',
];
const bookingTerms = ['预订', '预约', '下单', '报名', '可订', '余量', '订立', '付款'];

const boundaryTerms = [
  '膳食', '饮食', '吃什么', '食谱',
  '护工', '机构', '养老院',
  '周边', '附近',
  '派单', '工单',
  // 急症移交词
  '胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120',
];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '吃什么': 'meal_plan', '食谱': 'meal_plan',
  '护工': 'find_service', '机构': 'find_service', '养老院': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '呼吸困难': 'health_risk_warning',
  '中风': 'health_risk_warning', '抽搐': 'health_risk_warning', '大出血': 'health_risk_warning',
  '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

/**
 * Optional FlyAI KB enrich before/when building route card data.
 * On failure returns null so sojourn-maps / JTD path stays unchanged.
 *
 * @param {{ query?: string, linked_route_id?: string, data?: object }} args
 * @returns {Promise<object|null>} patch fields for template data, or null
 */
export async function tryEnrichRouteCardWithFlyai({ query, linked_route_id, data = {} } = {}) {
  try {
    const [
      { createFlyaiKnowledgeBridge },
      { createFlyaiKbStore },
      { createFlyaiClient },
      { buildMapOrderedStreamEvents },
    ] = await Promise.all([
      import('../../../services/flyai/flyai-knowledge-bridge.js'),
      import('../../../services/flyai/flyai-kb-store.js'),
      import('../../../services/flyai/flyai-client.js'),
      import('../../../services/flyai/build-stream-events.js'),
    ]);

    let threshold = Number(process.env.FLYAI_KB_HIT_THRESHOLD || 0.72);
    try {
      const { loadEnv } = await import('../../../config/env.js');
      const env = loadEnv();
      if (Number.isFinite(env?.flyaiKbHitThreshold)) {
        threshold = env.flyaiKbHitThreshold;
      }
    } catch {
      // keep process.env / default
    }

    const bridge = createFlyaiKnowledgeBridge({
      store: createFlyaiKbStore(),
      client: createFlyaiClient(),
      threshold,
    });

    const resolved = await bridge.resolve({
      query: query || '',
      linked_route_id: linked_route_id || undefined,
    });

    if (!resolved?.ok || !resolved.doc) return null;

    const doc = { ...resolved.doc, from_cache: resolved.from_cache };
    const stream_events = buildMapOrderedStreamEvents(doc);
    const patch = { stream_events };

    if (Array.isArray(doc.waypoints) && doc.waypoints.length) {
      patch.waypoints = doc.waypoints;
    }
    if (Array.isArray(doc.highlights) && doc.highlights.length) {
      patch.highlights = doc.highlights;
    }
    if (Array.isArray(doc.products) && doc.products.length) {
      patch.products = doc.products;
    }
    if (doc.title && !data?.routeTitle) {
      patch.flyai_title = doc.title;
    }

    return patch;
  } catch {
    return null;
  }
}

/**
 * Merge FlyAI patch into route card template data (no-op if patch null).
 * @param {object} data
 * @param {object|null} patch
 */
export function applyFlyaiRoutePatch(data = {}, patch = null) {
  if (!patch || typeof patch !== 'object') return data;
  const next = { ...data };
  if (patch.waypoints) next.waypoints = patch.waypoints;
  if (patch.highlights) next.highlights = patch.highlights;
  if (patch.products) next.products = patch.products;
  if (patch.stream_events) next.stream_events = patch.stream_events;
  return next;
}

export function createTravelRouteAgent() {
  const agent = createBaseAgent({
    key: 'travel_route', name: '旅居助手', actionPrefix: 'travel_route',
    evidenceGroups: [
      { group: 'travel_topic', weight: 3, terms: travelTopicTerms },
      { group: 'route_plan_signal', weight: 4, terms: routePlanSignalTerms },
      { group: 'travel_intent', weight: 3, terms: travelIntentTerms },
      { group: 'elder_travel_constraint', weight: 2, terms: elderTravelTerms },
      { group: 'booking', weight: 2, terms: bookingTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 6,
  });

  /** Optional hook: enrich route template data with FlyAI KB + stream_events */
  agent.enrichWithFlyaiKb = tryEnrichRouteCardWithFlyai;

  return agent;
}
