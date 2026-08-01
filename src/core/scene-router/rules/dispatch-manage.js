import { includesTerm } from '../scoring-engine.js';

const dispatchTopicTerms = [
  '派单', '工单', '调度', '接单', '拒单', '改派', '转派', '抢单', '派工',
  '我的单', '转交', '供应商处理', '一票否决',
];
const dispatchIntentTerms = [
  '查看', '处理', '接', '催', '查询', '列表', '详情', '进度', '状态', '改约', '更新',
  '我的', '看一下', '不接', '拒接',
];
const dispatchStatusTerms = [
  '进度', '状态', '改约', '更新', '流转', '跟踪',
];
const serviceLinkTerms = [
  '订单', '服务进度', '处理进度', '客服',
];

export const dispatchManageRuleSet = {
  scene_key: 'dispatch_manage',
  default_intent: 'dispatch_list',
  threshold: 5,
  template_candidates: ['dispatch_list', 'dispatch_detail', 'work_order', 'dispatch_status', 'fallback'],
  required_data: ['dm_dispatch_order', 'fs_service_order', 'fs_worker'],
  required_knowledge: ['dispatch_manage'],
  actions_allowed: [
    'dispatch_manage.list',
    'dispatch_manage.work_order',
    'dispatch_manage.status',
    'dispatch_manage.detail',
  ],
  followup_policy: 'dispatch_manage.default',
  evidence_groups: [
    { group: 'dispatch_topic', weight: 3, terms: dispatchTopicTerms },
    { group: 'dispatch_intent', weight: 3, terms: dispatchIntentTerms },
    { group: 'dispatch_status', weight: 2.5, terms: dispatchStatusTerms },
    { group: 'service_link', weight: 1.5, terms: serviceLinkTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'village_doctor', 'community_doctor', 'care_worker', 'institution_admin', 'system_admin', 'admin', 'grid_worker', 'community_helper'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'dispatch_manage',
    weight: 5,
    terms: ['这条', '这个单', '接下', '改派', '继续', '再催', '转派'],
  },
  conflicts: [
    { group: 'meal_plan', penalty: 4, terms: ['膳食', '饮食', '早餐', '午餐', '晚餐', '菜谱'] },
    { group: 'travel_route', penalty: 4, terms: ['旅居', '旅游', '路线', '线路', '行程'] },
    { group: 'find_service', penalty: 4, terms: ['找护工', '找机构', '养老院', '上门服务', '家政', '护理员', '预约服务', '养老服务'] },
    { group: 'acute_health_risk', penalty: 3.5, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '急救', '120'] },
  ],
  infer_intent(input) {
    if (has(input, ['接单', '接', '确认接'])) return 'dispatch_accept';
    if (has(input, ['拒单', '拒绝', '不接', '拒接'])) return 'dispatch_reject';
    if (has(input, ['供应商', '一票否决'])) return 'dispatch_supplier';
    if (has(input, ['转交', '转派', '改派', '转给'])) return 'dispatch_transfer';
    if (has(input, ['工单', '服务工单'])) return 'dispatch_work_order';
    if (has(input, ['进度', '状态', '催', '改约'])) return 'dispatch_status';
    if (has(input, ['详情', '处理', '看一下'])) return 'dispatch_detail';
    return 'dispatch_list';
  },
};

export function identifyDispatchManageScene(input) {
  const text = extractText(input);
  for (const g of dispatchManageRuleSet.evidence_groups) {
    const hit = g.terms.find((t) => includesTerm(text, t));
    if (hit) {
      return {
        scene_key: 'dispatch_manage',
        intent: dispatchManageRuleSet.default_intent,
        scene_name: '派单调度',
        confidence: 0.9,
        skill_key: 'dispatch_manage',
        matched_keyword: hit,
      };
    }
  }
  return null;
}

function has(input, terms) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  return terms.some((term) => includesTerm(text, term));
}

function extractText(input) {
  if (typeof input === 'string') return input;
  return [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
}
