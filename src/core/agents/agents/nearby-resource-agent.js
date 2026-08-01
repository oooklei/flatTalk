import { createBaseAgent } from '../base-agent.js';

// 与 scene-router/rules/nearby-resource.js evidence_groups 对齐
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
  '医疗', '卫生所', '药店', '诊所', '卫生院', '医养', '康养配套', '养老',
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
  '清单', '走路', '步行', '可达', '对比', '哪家好', '推荐几个',
  '只看', '单看',
];

const boundaryTerms = [
  '膳食', '饮食', '食谱', '吃什么',
  '旅居', '旅游', '行程',
  '护工', '养老院',
  '派单', '工单',
  // 急症移交词
  '胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120',
];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan', '吃什么': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route', '行程': 'travel_route',
  '护工': 'find_service', '养老院': 'find_service',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '呼吸困难': 'health_risk_warning',
  '中风': 'health_risk_warning', '抽搐': 'health_risk_warning', '大出血': 'health_risk_warning',
  '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createNearbyResourceAgent() {
  return createBaseAgent({
    key: 'nearby_resource', name: '周边助手', actionPrefix: 'nearby_resource',
    evidenceGroups: [
      { group: 'place', weight: 3.5, terms: placeTerms },
      { group: 'map', weight: 3.5, terms: mapTerms },
      { group: 'resource_category', weight: 3, terms: resourceCategoryTerms },
      { group: 'nearby_intent', weight: 2, terms: nearbyIntentTerms },
      { group: 'nearby_specific', weight: 4, terms: nearbySpecificTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 4,
  });
}
