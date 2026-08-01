import { createBaseAgent } from '../base-agent.js';

const travelTopicTerms = ['旅居', '旅游', '出行', '旅行', '出游', '游玩', '度假', '康养游', '行程', '攻略', 'travel'];
const routePlanTerms = ['路线', '导航', '怎么走', '公交', '地铁', '打车', '高铁', '飞机', '地图', '出发', '到达'];
const travelIntentTerms = ['推荐', '规划', '安排', '设计', '定制', '景点', '景区', '门票', '酒店', '民宿', '住宿', '预订'];
const boundaryTerms = ['膳食', '饮食', '吃什么', '食谱', '护工', '机构', '养老院', '周边', '附近', '派单', '工单', '胸痛', '昏迷', '呼吸困难', '急救', '120'];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '吃什么': 'meal_plan', '食谱': 'meal_plan',
  '护工': 'find_service', '机构': 'find_service', '养老院': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '呼吸困难': 'health_risk_warning', '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createTravelRouteAgent() {
  return createBaseAgent({
    key: 'travel_route', name: '旅居助手', actionPrefix: 'travel_route',
    evidenceGroups: [
      { group: 'travel_topic', weight: 3, terms: travelTopicTerms },
      { group: 'route_plan', weight: 4, terms: routePlanTerms },
      { group: 'travel_intent', weight: 3, terms: travelIntentTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 6,
  });
}
