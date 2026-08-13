import { createBaseAgent } from '../base-agent.js';

// 与 scene-router/rules/service-quality-eval.js evidence_groups 对齐
const evalTopicTerms = [
  '服务质量', '质量评估', '服务评价', '满意度', '投诉处理', '投诉', '巡检',
  '例行检查', '工单回访', '督导', '质量抽查', '护理质量', '服务规范',
  '评价', '复盘', '复查', '追溯', '质量', '整改建议', '问题归因',
];
const safetyTerms = ['防滑', '安全防护', '未达标', '不到位', '失职', '超时', '态度差', '规范'];
const traceTerms = ['追溯', '过程', '时间线', '工单', '打卡', '节点', '做了什么', '服务记录', '过程追溯', '服务过程'];
const scoreTerms = ['评分', '打分', '质量分', '得分', '等级', '维度', '综合分', '质量评分', '质量等级'];
const reportTerms = ['质量报告', '评估报告', '服务质量评估报告', '本月报告', '月度报告'];
const rectifyTerms = ['整改', '改进', '建议', '归因', '成因', '补训', '复检'];
const handoffTerms = ['督导', '转交', '缺口', '缺资料', '远程', '补证', '介入'];

// 与其他技能保持统一的边界词，避免跨技能误判
const boundaryTerms = [
  '膳食', '饮食', '食谱', '吃什么',
  '旅居', '旅游', '行程',
  '周边', '附近', '地图',
  '派单', '工单', '调度',
  '健康风险', '风险预警', '血压', '血糖', '舌诊', '体检报告',
  '胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120',
];
const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan', '吃什么': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route', '行程': 'travel_route',
  '周边': 'nearby_resource', '附近': 'nearby_resource', '地图': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage', '调度': 'dispatch_manage',
  '健康风险': 'health_risk_warning', '风险预警': 'health_risk_warning',
  '血压': 'health_risk_warning', '血糖': 'health_risk_warning',
  '舌诊': 'health_risk_warning', '体检报告': 'health_risk_warning',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '呼吸困难': 'health_risk_warning',
  '中风': 'health_risk_warning', '抽搐': 'health_risk_warning', '大出血': 'health_risk_warning',
  '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createServiceQualityEvalAgent() {
  return createBaseAgent({
    key: 'service_quality_eval',
    name: '服务质量评估技能',
    actionPrefix: 'service_quality_eval',
    evidenceGroups: [
      { group: 'eval_topic', weight: 3, terms: evalTopicTerms },
      { group: 'safety', weight: 3, terms: safetyTerms },
      { group: 'trace', weight: 3, terms: traceTerms },
      { group: 'score', weight: 3, terms: scoreTerms },
      { group: 'report', weight: 3, terms: reportTerms },
      { group: 'rectify', weight: 3, terms: rectifyTerms },
      { group: 'handoff', weight: 2, terms: handoffTerms },
    ],
    boundaryTerms,
    boundaryMap,
    threshold: 6,
  });
}
