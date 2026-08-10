import { createBaseAgent } from '../base-agent.js';

// 与 scene-router/rules/health-risk-warning.js evidence_groups 对齐
// 注意：急性急救词（胸痛/昏迷/120 等）在该场景 rule 中是 conflicts.acute_health_risk 惩罚词，
// 不应作为本 agent 正向 evidence——急症由 supervisor SOS 机制接管。
const healthRiskAlertTerms = [
  '健康风险', '风险预警', '健康预警', '预警', '风险研判', '报警', '异常信号',
  '风险等级', '信号', '研判',
  '健康报告', '完整报告', '预警提示', '风险提示',
  // 下钻卡：缺这些时「舌诊详情」只命中 dispatch 的泛词「详情」
  '舌诊', '舌象', '面诊', '面象', '体质', '证候', '证型', '调理方案',
];
const healthRiskVitalTerms = [
  '血压高', '血压偏高', '高血压', '血糖高', '血糖异常', '低血糖', '心率异常',
  '跌倒', '跌倒风险', '居家安全', '夜间离床', '呼吸异常', '血氧异常',
  '血压', '血糖', '心率', '血氧', '偏高', '异常信号',
  '怎么办', '有什么风险', '需要注意',
];
const healthRiskIntentTerms = ['研判', '判定', '健康评估', '风险评估', '分析', '提醒', '预警值', '频率'];
const elderConstraintTerms = ['老人', '长者', '长辈', '父母', '家属', '护理员', '慢病', '康复'];

const boundaryTerms = [
  '膳食', '饮食', '食谱', '旅居', '旅游', '护工', '机构', '周边', '附近', '派单', '工单',
  '服务质量', '质量评估', '整改建议', '质量报告',
];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route',
  '护工': 'find_service', '机构': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
  '服务质量': 'service_quality_eval', '质量评估': 'service_quality_eval',
  '整改建议': 'service_quality_eval', '质量报告': 'service_quality_eval',
};

export function createHealthRiskAgent() {
  return createBaseAgent({
    key: 'health_risk_warning', name: '健康预警助手', actionPrefix: 'health_risk_warning',
    evidenceGroups: [
      { group: 'health_risk_alert', weight: 4, terms: healthRiskAlertTerms },
      { group: 'health_risk_vital', weight: 1.5, terms: healthRiskVitalTerms },
      { group: 'health_risk_intent', weight: 3, terms: healthRiskIntentTerms },
      { group: 'elder_constraint', weight: 1.5, terms: elderConstraintTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 4,
  });
}
