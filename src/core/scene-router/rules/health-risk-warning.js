import { includesTerm } from '../scoring-engine.js';

const healthRiskAlertTerms = [
  '健康风险', '风险预警', '健康预警', '预警', '风险研判', '报警', '异常信号',
  '风险等级', '信号', '研判',
];

const healthRiskVitalTerms = [
  '血压高', '血压偏高', '高血压', '血糖高', '血糖异常', '低血糖', '心率异常',
  '跌倒', '跌倒风险', '居家安全', '夜间离床', '呼吸异常', '血氧异常',
];

const healthRiskIntentTerms = [
  '研判', '判定', '评估', '分析', '提醒', '预警值', '阈值',
];

const elderConstraintTerms = [
  '老人', '长者', '长辈', '父母', '家属', '护理员', '慢病', '康复',
];

export const healthRiskWarningRuleSet = {
  scene_key: 'health_risk_warning',
  default_intent: 'health_risk_warning.assess',
  threshold: 5,
  template_candidates: ['health_warning_card', 'health_risk_signal_card', 'health_risk_rule_card', 'fallback'],
  required_data: ['health_risk_warning_business'],
  required_knowledge: ['health_risk_warning'],
  actions_allowed: [
    'health_risk_warning.refresh_signals',
    'health_risk_warning.view_rule_detail',
    'health_risk_warning.request_manual_review',
    'health_risk_warning.fill_elder_info',
    'health_risk_warning.fill_remote_info',
  ],
  followup_policy: 'health_risk_warning.default',
  evidence_groups: [
    // 明确的健康风险预警意图词（强信号，单独即可路由）
    { group: 'health_risk_alert', weight: 4, terms: healthRiskAlertTerms },
    // 生命体征/风险事件词（弱信号，仅在与告警意图或老人上下文同现时提升）
    { group: 'health_risk_vital', weight: 1.5, terms: healthRiskVitalTerms },
    { group: 'health_risk_intent', weight: 3, terms: healthRiskIntentTerms },
    { group: 'elder_constraint', weight: 1.5, terms: elderConstraintTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'village_doctor', 'care_worker', 'care_doctor', 'supervisor', 'system_admin'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'health_risk_warning',
    weight: 5,
    terms: ['信号', '规则', '等级', '继续', '这个', '再看', '转人工', '复核', '补充'],
  },
  conflicts: [
    { group: 'meal_plan', penalty: 3, terms: ['膳食', '饮食', '菜谱', '控糖餐', '低盐', '早饭', '午饭', '晚饭', '晚餐'] },
    { group: 'travel_route', penalty: 3, terms: ['旅居', '旅游', '路线', '行程', '巴马', '北海', '交通接驳'] },
    { group: 'acute_health_risk', penalty: 4, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120'] },
  ],
  infer_intent(input) {
    if (has(input, ['转人工', '复核', '人工复核'])) return 'health_risk_warning.manual_review';
    if (has(input, ['规则', '命中', '研判', '判定'])) return 'health_risk_warning.rule_detail';
    if (has(input, ['设备信号明细', '信号明细', '查看信号'])) return 'health_risk_warning.signal_detail';
    return 'health_risk_warning.assess';
  },
};

function has(input, terms) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  return terms.some((term) => includesTerm(text, term));
}

export default healthRiskWarningRuleSet;
