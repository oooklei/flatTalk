import { createBaseAgent } from '../base-agent.js';

// 与 scene-router/rules/find-service.js evidence_groups 对齐
const serviceTopicTerms = [
  '养老服务', '护工', '护理', '养老院', '机构', '上门', '助浴', '陪诊', '助餐', '送餐',
  '清洁', '康复', '认知症', '护理员', '家政', '照护', '服务', '康养',
];
const serviceIntentTerms = [
  '找', '推荐', '预约', '安排', '下单', '订', '匹配', '查询', '查看', '申请', '需要', '我要', '帮我',
  '有哪些', '入住', '想', '希望', '了解', '咨询',
  '目录', '全部', '订单', '我的订单', '服务订单',
];
const serviceTypeTerms = [
  '上门护理', '助浴', '陪诊就医', '陪诊', '康复训练', '助餐', '居家清洁', '养老机构', '机构养老', '养老床位', '认知症照护', '护理站',
  '订单', '服务订单', '目录',
];
const elderConstraintTerms = [
  '老人', '长者', '老年人', '爷爷', '奶奶', '爸妈', '父母', '家属', '失能', '半失能', '独居', '高龄',
];

const boundaryTerms = [
  '膳食', '饮食', '食谱', '吃什么',
  '旅居', '旅游', '行程',
  '周边', '附近', '地图',
  '派单', '工单', '调度',
  // 急症移交词
  '胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120',
];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan', '吃什么': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route', '行程': 'travel_route',
  '周边': 'nearby_resource', '附近': 'nearby_resource', '地图': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage', '调度': 'dispatch_manage',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '呼吸困难': 'health_risk_warning',
  '中风': 'health_risk_warning', '抽搐': 'health_risk_warning', '大出血': 'health_risk_warning',
  '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createFindServiceAgent() {
  return createBaseAgent({
    key: 'find_service', name: '服务助手', actionPrefix: 'find_service',
    evidenceGroups: [
      { group: 'service_topic', weight: 3, terms: serviceTopicTerms },
      { group: 'service_intent', weight: 3, terms: serviceIntentTerms },
      { group: 'service_type', weight: 2.5, terms: serviceTypeTerms },
      { group: 'elder_constraint', weight: 1.5, terms: elderConstraintTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 6,
  });
}
