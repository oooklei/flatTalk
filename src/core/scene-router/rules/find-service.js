import { includesTerm } from '../scoring-engine.js';

const serviceTopicTerms = [
  '养老服务', '护工', '护理', '养老院', '机构', '上门', '助浴', '陪诊', '助餐', '送餐',
  '清洁', '康复', '认知症', '护理员', '家政', '照护', '服务', '康养',
  '服务机构', '服务中心', '居家养老', '养老服务中心',
  '理发', '扦脚', '代办', '跑腿', '适老化', '健康随访', '慢病', '中医', '理疗',
  '日间照料', '喘息', '托养', '智能设备', '手环', '远程看护', '陪伴', '心理疏导', '老年大学', '紧急呼叫', '安全守护',
];
const serviceIntentTerms = [
  '找', '推荐', '预约', '安排', '下单', '订', '匹配', '查询', '查看', '申请', '需要', '我要', '帮我',
  '有哪些', '入住', '想', '希望', '了解', '咨询', '问', '询问',
  '目录', '全部', '订单', '我的订单', '服务订单',
];
const serviceTypeTerms = [
  '上门护理', '助浴', '陪诊就医', '陪诊', '康复训练', '助餐', '居家清洁',
  '养老机构', '服务机构', '养老服务机构', '机构养老', '养老床位', '认知症照护', '护理站',
  '服务中心', '居家养老', '居家养老服务中心', '养老服务中心',
  '理发', '扦脚', '代办', '跑腿', '清洗', '适老化', '健康随访', '慢病管理', '中医', '理疗', '日间照料', '喘息', '短期托养',
  '智能设备', '紧急呼叫', '陪伴', '心理疏导', '老年大学',
  '订单', '服务订单', '目录',
];
const elderConstraintTerms = [
  '老人', '长者', '老年人', '爷爷', '奶奶', '爸妈', '父母', '家属', '失能', '半失能', '独居', '高龄',
];

export const findServiceRuleSet = {
  scene_key: 'find_service',
  default_intent: 'find_service_discover',
  threshold: 6,
  template_candidates: ['service_recommend', 'service_catalog', 'org_profile', 'worker_profile', 'order_preview', 'order_status', 'service_trace', 'service_review', 'fallback'],
  required_data: ['fs_service_catalog', 'fs_org', 'fs_worker', 'fs_service_order'],
  required_knowledge: ['find_service'],
  actions_allowed: [
    'find_service.recommend',
    'find_service.catalog',
    'find_service.list_orgs',
    'find_service.list_workers',
    'find_service.detail_order',
    'find_service.trace',
    'find_service.review',
  ],
  followup_policy: 'find_service.default',
  evidence_groups: [
    { group: 'service_topic', weight: 3, terms: serviceTopicTerms },
    { group: 'service_intent', weight: 3, terms: serviceIntentTerms },
    { group: 'service_type', weight: 2.5, terms: serviceTypeTerms },
    { group: 'elder_constraint', weight: 1.5, terms: elderConstraintTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'village_doctor', 'community_doctor', 'care_worker', 'institution_admin', 'provider_staff', 'community_helper', 'system_admin', 'admin', 'civil_affairs_staff', 'grid_worker'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'find_service',
    weight: 5,
    terms: ['这个', '这位', '预约', '下单', '接单', '安排', '继续', '再推荐', '换一个'],
  },
  conflicts: [
    { group: 'meal_plan', penalty: 4, terms: ['膳食', '饮食', '早餐', '午餐', '晚餐', '菜谱', '控糖餐', '低盐'] },
    { group: 'travel_route', penalty: 4, terms: ['旅居', '旅游', '路线', '线路', '行程', '目的地', '广西', '防城港'] },
    { group: 'dispatch_manage', penalty: 4, terms: ['派单', '工单', '调度', '接单', '拒单', '改派'] },
    { group: 'service_quality_eval', penalty: 5, terms: ['服务质量', '质量评估', '服务评价', '质量报告', '整改', '巡检', '督导', '防滑', '规范', '工单质量', '质量等级', '问题归因', '满意度'] },
    { group: 'nearby_resource', penalty: 4, terms: ['周边资源', '附近地图', '嘉路周边', '生活圈', '配套地图'] },
    { group: 'acute_health_risk', penalty: 3.5, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '急救', '120'] },
  ],
  infer_intent(input) {
    if (has(input, ['养老院', '养老机构', '服务机构', '养老服务机构', '护理站', '服务中心', '居家养老', '机构入住'])) return 'find_service_org';
    if (has(input, ['下单成功', '订单号', '预定完成', '下单完成'])) return 'find_service_order_ticket';
    if (has(input, ['确认订单', '预览', '查看订单信息', '提交前'])) return 'find_service_order_preview';
    if (has(input, ['订单', '我的订单', '服务订单', '查看订单', '订单到哪', '订单进度'])) return 'find_service_order_view';
    if (has(input, ['预约', '我要预定', '我要订', '预定', '帮我下单', '我要下单', '安排'])) return 'find_service_order';
    if (has(input, ['目录', '全部', '分类', '有哪些服务', '有哪些'])) return 'find_service_catalog';
    if (has(input, ['特色', '介绍', '详情', '怎么样'])) return 'find_service_detail';
    if (has(input, ['服务追溯', '追溯', '过程', '时间线', '做了什么', '服务记录', '服务过程'])) return 'find_service_trace';
    if (has(input, ['口碑', '评价', '好评', '评分', '差评', '评论'])) return 'find_service_review';
    if (has(input, ['其他', '拓展', '空闲', '环境', '响应', '优质'])) return 'find_service_expand';
    if (has(input, ['猜', '精选', '喜欢'])) return 'find_service_guess_like';
    // worker 仅匹配"资质/介绍/查看+护工"等详情查询，推荐意图走 discover
    if (has(input, ['护工资质', '护理员介绍', '查看护工', '上门人员是谁'])) return 'find_service_worker';
    return 'find_service_discover';
  },
};

export function identifyFindServiceScene(input) {
  const text = extractText(input);
  for (const g of findServiceRuleSet.evidence_groups) {
    const hit = g.terms.find((t) => includesTerm(text, t));
    if (hit) {
      return {
        scene_key: 'find_service',
        intent: findServiceRuleSet.default_intent,
        scene_name: '找养老服务',
        confidence: 0.9,
        skill_key: 'find_service',
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
