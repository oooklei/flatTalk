import { includesTerm } from '../scoring-engine.js';

// 与 agents/service-quality-eval-agent.js 及 scoreRuleSet 对齐
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

export const serviceQualityEvalRuleSet = {
  scene_key: 'service_quality_eval',
  display_name: '服务质量评估',
  default_intent: 'service_quality_eval.report',
  threshold: 6,
  template_candidates: [
    'institution_quality_report',
    'staff_quality_report',
    'org_quality_ranking',
    'staff_quality_ranking',
    'rectification_suggestion',
    'complaint_detail',
    'evaluation_standard',
  ],
  required_data: ['sqe_eval', 'sqe_trace', 'sqe_score'],
  required_knowledge: [],
  actions_allowed: [
    'service_quality_eval.view_report',
    'service_quality_eval.view_staff',
    'service_quality_eval.view_org_rank',
    'service_quality_eval.view_staff_rank',
    'service_quality_eval.rectify',
    'service_quality_eval.view_complaint',
    'service_quality_eval.view_standard',
    'service_quality_eval.export',
  ],
  followup_policy: 'service_quality_eval.default',
  evidence_groups: [
    { group: 'eval_topic', weight: 3, terms: evalTopicTerms },
    { group: 'safety', weight: 3, terms: safetyTerms },
    { group: 'trace', weight: 3, terms: traceTerms },
    { group: 'score', weight: 3, terms: scoreTerms },
    { group: 'report', weight: 3, terms: reportTerms },
    { group: 'rectify', weight: 3, terms: rectifyTerms },
    { group: 'handoff', weight: 2, terms: handoffTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'village_doctor', 'community_doctor', 'care_worker', 'institution_admin', 'provider_staff', 'community_helper', 'system_admin', 'admin', 'civil_affairs_staff', 'grid_worker'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'service_quality_eval',
    weight: 5,
    terms: ['这个', '这位', '继续', '再', '重新', '复查', '复核', '转交', '整改'],
  },
  conflicts: [
    { group: 'meal_plan', penalty: 4, terms: ['膳食', '饮食', '早餐', '午餐', '晚餐', '菜谱', '控糖餐', '低盐'] },
    { group: 'travel_route', penalty: 4, terms: ['旅居', '旅游', '路线', '线路', '行程', '目的地', '广西', '防城港'] },
    { group: 'find_service', penalty: 4, terms: ['找机构', '找服务', '下单', '预约', '附近', '有哪些', '电话', '地址', '联系方式', '营业', '排班', '介绍机构'] },
    { group: 'dispatch_manage', penalty: 2.5, terms: ['派单', '调度', '接单', '拒单', '改派', '抢单'] },
    { group: 'health_risk_warning', penalty: 8, terms: ['健康风险', '风险预警', '健康预警', '设备信号', '血压', '血糖', '心率', '血氧', '舌诊', '面诊', '体质辨识', '体检报告', '健康报告', '风险研判'] },
    { group: 'acute_health_risk', penalty: 3.5, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '急救', '120'] },
  ],
  infer_intent(input) {
    if (has(input, ['质量报告', '评估报告', '综合评分', '服务质量评估报告'])) return 'service_quality_eval.report';
    if (has(input, ['机构排名', '机构排行', '榜单', '排名榜', '辖区排名'])) return 'service_quality_eval.org_rank';
    if (has(input, ['人员排名', '人员排行', '护理员排名'])) return 'service_quality_eval.staff_rank';
    if (has(input, ['投诉详情', '投诉工单', '工单详情', '投诉记录'])) return 'service_quality_eval.complaint';
    if (has(input, ['整改', '改进', '建议', '归因', '成因', '补训', '复检'])) return 'service_quality_eval.rectify';
    if (has(input, ['维度', '标准', '权重', '口径', '评分标准'])) return 'service_quality_eval.standard';
    if (has(input, ['人员', '护理员', '评估档案', '个人评估', '这位护理员'])) return 'service_quality_eval.staff';
    if (has(input, ['机构', '综合评分', '质量报告', '评估报告', '投诉', '巡检', '回访', '满意度', '检查', '评估', '评价'])) return 'service_quality_eval.report';
    return 'service_quality_eval.report';
  },
};

function has(input, terms) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  return terms.some((term) => includesTerm(text, term));
}
