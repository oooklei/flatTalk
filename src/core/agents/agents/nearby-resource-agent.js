import { createBaseAgent } from '../base-agent.js';

const placeTerms = ['周边', '附近', '周围', '旁边', '就近'];
const mapTerms = ['地图', '位置', '在哪', '怎么去', '地址', '导航'];
const resourceCategoryTerms = ['餐厅', '吃饭', '超市', '购物', '买', '药店', '医院', '诊所', '公园', '景点', '游玩', '休闲', '娱乐', '银行', 'ATM', '公交', '地铁', '车站', '机场', '高铁'];
const nearbyIntentTerms = ['找', '推荐', '哪里有', '有没有', '多远', '怎么去'];
const boundaryTerms = ['膳食', '饮食', '食谱', '吃什么', '旅居', '旅游', '行程', '护工', '养老院', '派单', '工单'];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan', '吃什么': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route', '行程': 'travel_route',
  '护工': 'find_service', '养老院': 'find_service',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
};

export function createNearbyResourceAgent() {
  return createBaseAgent({
    key: 'nearby_resource', name: '周边助手', actionPrefix: 'nearby_resource',
    evidenceGroups: [
      { group: 'place', weight: 3, terms: placeTerms },
      { group: 'map', weight: 2, terms: mapTerms },
      { group: 'category', weight: 2.5, terms: resourceCategoryTerms },
      { group: 'intent', weight: 2, terms: nearbyIntentTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 4,
  });
}
