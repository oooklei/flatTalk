import { createBaseAgent } from '../base-agent.js';

// 与 scene-router/rules/dispatch-manage.js evidence_groups 对齐
const dispatchTopicTerms = [
  '派单', '工单', '调度', '接单', '拒单', '改派', '转派', '抢单', '派工',
  '我的单', '转交', '供应商处理', '一票否决',
];
const dispatchIntentTerms = [
  // 不用裸「详情」：会与「舌诊详情/面诊详情/线路详情」等跨域短语抢分
  '查看', '处理', '接', '催', '查询', '列表', '派单详情', '工单详情', '进度', '状态', '改约', '更新',
  '我的', '看一下', '不接', '拒接',
];
const dispatchStatusTerms = [
  '进度', '状态', '改约', '更新', '流转', '跟踪',
];
const serviceLinkTerms = [
  '订单', '服务进度', '处理进度', '客服',
];

const boundaryTerms = [
  '膳食', '饮食', '食谱',
  '旅居', '旅游',
  '护工', '机构', '养老院', '上门服务',
  '周边', '附近',
  // 急症移交词
  '胸痛', '昏迷', '呼吸困难', '中风', '急救', '120',
];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route',
  '护工': 'find_service', '机构': 'find_service', '养老院': 'find_service', '上门服务': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '呼吸困难': 'health_risk_warning',
  '中风': 'health_risk_warning', '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createDispatchManageAgent() {
  return createBaseAgent({
    key: 'dispatch_manage', name: '调度助手', actionPrefix: 'dispatch_manage',
    evidenceGroups: [
      { group: 'dispatch_topic', weight: 3, terms: dispatchTopicTerms },
      { group: 'dispatch_intent', weight: 3, terms: dispatchIntentTerms },
      { group: 'dispatch_status', weight: 2.5, terms: dispatchStatusTerms },
      { group: 'service_link', weight: 1.5, terms: serviceLinkTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 5,
  });
}
