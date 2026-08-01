import { createBaseAgent } from '../base-agent.js';

const healthRiskAlertTerms = ['胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120', '晕倒', '摔跤', '跌倒'];
const healthRiskVitalTerms = ['血压', '血糖', '心率', '体温', '血氧', '脉搏'];
const healthRiskIntentTerms = ['预警', '警报', '异常', '超标', '危险', '紧急', '不舒服', '头晕', '恶心'];
const boundaryTerms = ['膳食', '饮食', '食谱', '旅居', '旅游', '护工', '机构', '周边', '附近', '派单', '工单'];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route',
  '护工': 'find_service', '机构': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
};

export function createHealthRiskAgent() {
  return createBaseAgent({
    key: 'health_risk_warning', name: '健康预警助手', actionPrefix: 'health_risk_warning',
    evidenceGroups: [
      { group: 'alert', weight: 4, terms: healthRiskAlertTerms },
      { group: 'vital', weight: 1.5, terms: healthRiskVitalTerms },
      { group: 'intent', weight: 3, terms: healthRiskIntentTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 4,
  });
}
