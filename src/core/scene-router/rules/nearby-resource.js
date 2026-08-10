import { includesTerm } from '../scoring-engine.js';

// 嘉路康养中心「周边 15 公里康养生活圈」意图识别
// 真实数据类型：民宿/康养小院(住)、滨海景区(游)、特色餐饮(吃)、垂钓休闲(娱)、购物特产(购)、包车交通(行)、医疗康养(养)
const placeTerms = [
  '嘉路', '康养中心', '嘉路康养', '嘉路中心', '中心周边', '附近', '周边', '周围',
  '15公里', '15千米', '15km', '周边15', '周围15', '附近15', '三公里', '5公里', '十公里',
  '生活圈', '生活配套', '周边配套',
  '海边', '医院', '配套',
];

const mapTerms = [
  '地图', '打点', '标记', '分布', '位置', '在哪', '大屏', '定位', '地图展示', '展示地图',
  'map', 'Map', '地图上看', '标出来', '在地图', '地图标记', '资源分布', '配套分布', '周边分布',
];

const resourceCategoryTerms = [
  '民宿', '住宿', '住', '康养小院', '入住',
  '景区', '滨海', '海边', '海滩', '逛',
  '餐饮', '餐厅', '吃饭', '美食', '饭店', '海鲜', '私房菜', '大排档', '食', '吃',
  '垂钓', '钓鱼', '休闲', '娱乐', '健身',
  '购物', '特产', '买', '超市', '市场',
  '包车', '交通', '出行', '怎么去',
  '医疗', '卫生所', '药店', '诊所', '卫生院', '医养', '康养配套', '养老设施',
  '配套', '资源', '设施', '服务资源', '周边资源',
];

const nearbyIntentTerms = [
  '查看', '展示', '看看', '查一下', '搜一下', '有哪些', '有什么', '附近有', '周边有',
  '推荐', '找', '列出', '罗列', 'show', 'nearby', 'around', 'map',
  '能游玩的', '能吃饭', '能去', '有什么好', '有哪些好', '周边资源', '周边配套',
  '清单', '列出来', '走路能到', '步行可达',
];

const nearbySpecificTerms = [
  '周边资源', '周边配套', '地图展示', '地图上看', '展示地图', '资源分布', '配套分布',
  '周边分布', '大屏', '打点', '标出来', '在地图', '地图标记', '以嘉路为中心', '嘉路为中心',
  '15公里', '15千米', '15km', '周边15', '周围15', '附近15', '康养生活圈',
  '嘉路康养中心', '了解嘉路', '嘉路康养', '嘉路是什么',
  '清单', '走路', '步行', '可达', '对比', '哪家好', '推荐几个',
  '只看', '单看',
];

export const nearbyResourceRuleSet = {
  scene_key: 'nearby_resource',
  default_intent: 'nearby_resource.all',
  threshold: 4,
  template_candidates: ['nearby_map_overview', 'nearby_map_category', 'nearby_list', 'fallback'],
  required_data: ['jialu_facilities'],
  required_knowledge: ['jialu_kangyang_center'],
  actions_allowed: [
    'nearby_resource.all',
    'nearby_resource.stay',
    'nearby_resource.food',
    'nearby_resource.spot',
    'nearby_resource.leisure',
    'nearby_resource.shop',
    'nearby_resource.transit',
    'nearby_resource.wellness',
    'nearby_resource.medical',
    'nearby_resource.compare',
    'nearby_resource.recommend',
    'nearby_resource.route',
    'nearby_resource.radar',
    'nearby_resource.summary',
  ],
  followup_policy: 'nearby_resource.default',
  evidence_groups: [
    { group: 'place', weight: 3.5, terms: placeTerms },
    { group: 'map', weight: 3.5, terms: mapTerms },
    { group: 'resource_category', weight: 3, terms: resourceCategoryTerms },
    { group: 'nearby_intent', weight: 2, terms: nearbyIntentTerms },
    { group: 'nearby_specific', weight: 4, terms: nearbySpecificTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'village_doctor', 'community_doctor', 'care_worker', 'institution_admin'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'nearby_resource',
    weight: 4,
    terms: ['周边', '附近配套', '继续看', '切换分类', '再看周边'],
  },
  conflicts: [
    { group: 'travel_route', penalty: 3.5, terms: ['路线', '导航', '怎么走', '公交', '地铁', '打车', '行程', '旅居', '旅游', '百色', '巴马', '北海'] },
    { group: 'meal_plan', penalty: 3, terms: ['膳食', '食谱', '一周饮食', '营养餐', '三餐'] },
    { group: 'find_service', penalty: 5.5, terms: ['找护工', '找机构', '服务机构', '养老机构', '养老服务机构', '服务中心', '居家养老', '护理站', '养老院', '上门服务', '家政', '护理员', '预约服务', '建单', '下单', '助浴', '助餐', '陪诊'] },
    { group: 'dispatch_manage', penalty: 4, terms: ['派单', '工单', '调度', '转人工', '客服处理', '处理进度', '催单'] },
    { group: 'service_quality_eval', penalty: 5, terms: ['服务质量', '质量评估', '服务评价', '满意度', '投诉', '整改', '评分', '督导', '评估报告'] },
    { group: 'acute_health_risk', penalty: 3.5, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120'] },
  ],
  infer_intent(input) {
    // 「服务机构/养老机构」属于找服务，不要因「入住」等宽词落到住宿宾馆
    if (has(input, ['服务机构', '养老机构', '养老服务机构', '服务中心', '居家养老', '护理站', '养老院', '敬老院'])) {
      return 'nearby_resource.wellness';
    }
    if (has(input, ['民宿', '住宿', '住', '康养小院', 'stay', 'hotel'])) return 'nearby_resource.stay';
    // 「入住」单独出现且无机构语境时，仍按住宿；有机构语境已在上方拦截
    if (has(input, ['入住']) && !has(input, ['机构', '护理', '养老'])) return 'nearby_resource.stay';
    if (has(input, ['景区', '滨海', '海边', '海滩', '逛', 'spot', 'tour', 'scenic'])) return 'nearby_resource.spot';
    if (has(input, ['餐饮', '餐厅', '吃饭', '美食', '饭店', '海鲜', '私房菜', '大排档', '食', '吃', 'food', 'restaurant'])) return 'nearby_resource.food';
    if (has(input, ['垂钓', '钓鱼', '休闲', '娱乐', '健身', 'leisure'])) return 'nearby_resource.leisure';
    if (has(input, ['购物', '特产', '买', '超市', '市场', 'shop', 'shopping'])) return 'nearby_resource.shop';
    if (has(input, ['包车', '交通', '出行', '怎么去', 'transit'])) return 'nearby_resource.transit';
    if (has(input, ['只看医疗', '医疗资源'])) return 'nearby_resource.medical';
    if (has(input, ['医疗', '卫生所', '药店', '诊所', '卫生院', '医养', '康养配套', '养老设施', 'wellness', 'medical', 'hospital'])) return 'nearby_resource.wellness';
    if (has(input, ['清单', '列出来', '列出'])) return 'nearby_resource.list';
    if (has(input, ['走路', '步行', '可达', '遛弯'])) return 'nearby_resource.radar';
    if (has(input, ['对比', '哪家好', '比较'])) return 'nearby_resource.compare';
    if (has(input, ['推荐几个', '推荐', '精选'])) return 'nearby_resource.recommend';
    if (has(input, ['简单', '一句话', '语音', '小结', '概括'])) return 'nearby_resource.summary';
    if (has(input, ['路线', '一日游', '怎么玩'])) return 'nearby_resource.route';
    if (has(input, ['只看', '分类', '单类'])) return 'nearby_resource.category';
    return 'nearby_resource.all';
  },
};

function has(input, terms) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  return terms.some((term) => includesTerm(text, term));
}
