import { includesTerm } from '../scoring-engine.js';

const policyTopicTerms = [
  '养老政策', '政策', '补贴', '高龄津贴', '长护险', '长期护理保险', '护理补贴',
  '养老保险', '养老金', '社区居家养老', '居家养老', '养老服务', '助餐补贴',
  '适老化改造', '失能评估', '能力评估', '民政', '人社',
];

const serviceIntentTerms = [
  '有什么', '有哪些', '怎么申请', '如何申请', '申请条件', '办理条件', '怎么办理',
  '去哪办', '需要材料', '流程', '标准', '多少钱', '怎么算', '查询', '咨询', '指引',
];

const assistantUsageTerms = [
  '养老助手', '桂小养', '怎么用', '能做什么', '可以做什么', '使用方法', '功能',
  '帮我', '助手',
];

const elderTerms = [
  '老人', '长者', '老年人', '家属', '爸妈', '父母', '爷爷', '奶奶', '失能',
  '半失能', '独居', '高龄',
];

export const elderPolicyRuleSet = {
  scene_key: 'common',
  default_intent: 'elder_policy_consult',
  threshold: 5,
  template_candidates: ['policy_card', 'answer'],
  required_data: [],
  required_knowledge: ['common'],
  actions_allowed: [],
  followup_policy: 'common.policy',
  evidence_groups: [
    { group: 'policy_topic', weight: 4, terms: policyTopicTerms },
    { group: 'service_intent', weight: 2.5, terms: serviceIntentTerms },
    { group: 'assistant_usage', weight: 4, terms: assistantUsageTerms },
    { group: 'elder_context', weight: 1.5, terms: elderTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'service', 'partner', 'system_admin'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'common',
    weight: 3,
    terms: ['这个', '这些', '继续', '怎么办', '怎么申请', '需要什么'],
  },
  conflicts: [
    { group: 'meal_plan', penalty: 4, terms: ['膳食', '饮食', '早餐', '午餐', '晚餐', '控糖', '低盐', '营养餐'] },
    { group: 'travel_route', penalty: 4, terms: ['旅居', '旅游', '路线', '行程', '巴马', '北海', '交通接驳'] },
    { group: 'acute_health_risk', penalty: 4, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '急救', '120'] },
  ],
  infer_intent(input) {
    if (has(input, assistantUsageTerms)) return 'elder_assistant_usage';
    if (has(input, ['补贴', '津贴', '长护险', '养老金', '养老保险'])) return 'elder_policy_benefit';
    if (has(input, ['怎么申请', '如何申请', '办理', '材料', '流程', '条件'])) return 'elder_policy_apply';
    return 'elder_policy_consult';
  },
};

function has(input, terms) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  return terms.some((term) => includesTerm(text, term));
}
