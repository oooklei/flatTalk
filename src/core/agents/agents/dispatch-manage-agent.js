import { createBaseAgent } from '../base-agent.js';

const dispatchTopicTerms = ['派单', '工单', '调度', '派工', '改派', '接单', '完工', '签到'];
const dispatchIntentTerms = ['查看', '查询', '进度', '状态', '催单', '取消', '确认', '评价'];
const dispatchStatusTerms = ['待接单', '进行中', '已完成', '已取消', '待派发'];
const boundaryTerms = ['膳食', '饮食', '食谱', '旅居', '旅游', '护工', '机构', '周边', '附近', '胸痛', '昏迷', '急救', '120'];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route',
  '护工': 'find_service', '机构': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createDispatchManageAgent() {
  return createBaseAgent({
    key: 'dispatch_manage', name: '调度助手', actionPrefix: 'dispatch_manage',
    evidenceGroups: [
      { group: 'topic', weight: 3, terms: dispatchTopicTerms },
      { group: 'intent', weight: 3, terms: dispatchIntentTerms },
      { group: 'status', weight: 2.5, terms: dispatchStatusTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 5,
  });
}
