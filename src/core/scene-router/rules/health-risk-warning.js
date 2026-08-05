import { includesTerm } from '../scoring-engine.js';

const healthRiskAlertTerms = [
  '健康风险', '风险预警', '健康预警', '预警', '风险研判', '报警', '异常信号',
  '风险等级', '信号', '研判',
  '健康报告', '完整报告', '预警提示', '风险提示',
];

const healthRiskVitalTerms = [
  '血压高', '血压偏高', '高血压', '血糖高', '血糖异常', '低血糖', '心率异常',
  '跌倒', '跌倒风险', '居家安全', '夜间离床', '呼吸异常', '血氧异常',
  '血压', '血糖', '心率', '血氧', '偏高', '异常信号',
  '怎么办', '有什么风险', '需要注意',
];

const healthRiskIntentTerms = [
  '研判', '判定', '健康评估', '风险评估', '分析', '提醒', '预警值', '频率',
];

const elderConstraintTerms = [
  '老人', '长者', '长辈', '父母', '家属', '护理员', '慢病', '康复',
];

export const healthRiskWarningRuleSet = {
  scene_key: 'health_risk_warning',
  default_intent: 'health_risk_warning.assess',
  threshold: 4,
  template_candidates: ['health_warning_card', 'health_risk_signal_card', 'health_risk_rule_card', 'fallback'],
  required_data: ['health_risk_warning_business'],
  required_knowledge: ['health_risk_warning'],
  actions_allowed: [
    'health_risk_warning.refresh_signals',
    'health_risk_warning.view_rule_detail',
    'health_risk_warning.request_manual_review',
    'health_risk_warning.fill_elder_info',
    'health_risk_warning.fill_remote_info',
    'health_risk_warning.view_report',
    'health_risk_warning.view_advice',
    'health_risk_warning.view_assessment',
    'health_risk_warning.view_constitution',
    'health_risk_warning.view_tongue',
    'health_risk_warning.view_face',
    'health_risk_warning.view_syndrome',
    'health_risk_warning.view_risk_level',
    'health_risk_warning.view_help',
    'health_risk_warning.select_elder',
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
    roles: ['elder', 'elder_family', 'family', 'village_doctor', 'community_doctor', 'care_worker', 'institution_admin', 'system_admin', 'admin', 'grid_worker'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'health_risk_warning',
    weight: 5,
    terms: ['信号', '规则', '等级', '继续', '这个', '再看', '转人工', '复核', '补充'],
  },
  conflicts: [
    // 避免「膳食」裸词误伤「膳食调养」；只惩罚明确的三餐/配餐计划表述
    { group: 'meal_plan', penalty: 4, terms: ['一周食谱', '周计划', '配餐', '控糖餐', '低盐餐', '早饭吃什么', '午饭吃什么', '晚饭吃什么', '吃什么好'] },
    { group: 'travel_route', penalty: 4, terms: ['旅居', '旅游', '路线', '行程', '巴马', '北海', '交通接驳', '滨海', '三日游', '旅居线路', '康养线路'] },
    { group: 'service_quality_eval', penalty: 8, terms: ['服务质量', '质量评估', '服务评价', '机构质量', '护理员质量', '质量报告', '质量评分', '质量等级', '整改建议', '投诉处理', '督导', '巡检', '满意度'] },
    { group: 'acute_health_risk', penalty: 4, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120'] },
  ],
  infer_intent(input) {
    if (has(input, ['转人工', '复核', '人工复核'])) return 'health_risk_warning.manual_review';
    if (has(input, ['规则', '命中', '研判', '判定'])) return 'health_risk_warning.rule_detail';
    if (has(input, ['设备信号明细', '信号明细', '查看信号'])) return 'health_risk_warning.signal_detail';
    if (has(input, ['完整健康报告', '健康报告', '体检报告', '风险报告'])) return 'health_risk_warning.report';
    if (has(input, ['综合风险评估', '风险评估详情', '风险总评'])) return 'health_risk_warning.assessment';
    if (has(input, ['体质辨识', '中医体质', '主体质', '九种体质'])) return 'health_risk_warning.constitution';
    if (has(input, ['舌诊详情', '查看舌诊', '舌象'])) return 'health_risk_warning.tongue';
    if (has(input, ['面诊详情', '查看面诊', '面象'])) return 'health_risk_warning.face';
    if (has(input, ['中医证候', '证型', '证候'])) return 'health_risk_warning.syndrome';
    if (has(input, ['调理方案', '个性化调理', '穴位调理', '中药调理'])) return 'health_risk_warning.advice';
    if (has(input, ['风险等级标准', '五级标准', '等级说明'])) return 'health_risk_warning.risk_level';
    if (has(input, ['使用帮助', '怎么用', '如何使用'])) return 'health_risk_warning.help';
    if (has(input, ['同名', '选择老人', '哪一位'])) return 'health_risk_warning.elder_confirm';
    if (has(input, ['健康评估', '风险评估', '风险等级'])) return 'health_risk_warning.assess';
    if (has(input, ['风险提示', '预警提示', '有什么风险'])) return 'health_risk_warning.warning';
    if (has(input, ['膳食调养', '调养', '宜食', '忌食', '食疗'])) return 'health_risk_warning.dietary';
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
