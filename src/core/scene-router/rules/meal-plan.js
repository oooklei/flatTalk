import { includesTerm } from '../scoring-engine.js';

const mealTopicTerms = [
  '膳食', '饮食', '饭菜', '饭', '吃什么', '吃啥', '餐食', '食谱', '菜谱',
  '营养餐', '配餐', '助餐', '老人餐', '餐单', '菜单',
  '总览', '看板', '仪表盘', '时间线', '数据看板', '膳食数据',
  // 英文关键词
  'meal', 'diet', 'nutrition', 'recipe', 'breakfast', 'lunch', 'dinner',
  'meal plan', 'mealplan', 'what to eat', 'food plan',
];

const mealTimeTerms = [
  '早餐', '早饭', '午餐', '午饭', '晚餐', '晚饭', '一周', '七天', '周计划',
  '明天', '今天', '今日', '每日', '本周', '下周',
  // 英文关键词
  'breakfast', 'lunch', 'dinner', 'weekly', 'one week', '7 days', '7-day',
];

const healthConditionTerms = [
  '糖尿病', '血糖', '低糖', '控糖', '高血压', '血压', '低盐', '痛风', '尿酸',
  '肾病', '高血脂', '血脂', '冠心病', '便秘', '吞咽', '咀嚼', '术后',
  // 英文关键词
  'diabetes', 'blood sugar', 'low sugar', 'low-sugar', 'hypertension',
  'high blood pressure', 'low salt', 'gout', 'high cholesterol',
];

const mealIntentTerms = [
  '推荐', '安排', '计划', '生成', '制定', '搭配', '调整', '换成', '改成',
  '适合', '怎么吃', '能吃', '不能吃', '低糖版', '清淡点',
  // 英文关键词
  'recommend', 'plan', 'suggest', 'generate', 'arrange', 'what should',
];

const elderConstraintTerms = [
  '老人餐', '老人饭', '老年餐', '长者', '老年人', '爷爷', '奶奶', '外公', '外婆', '爸妈', '父亲',
  '母亲', '家属', '家里老人', '独居老人', '失能', '半失能',
];

export const mealPlanRuleSet = {
  scene_key: 'meal_plan',
  default_intent: 'meal_plan_advice',
  threshold: 5,
  template_candidates: ['diet_card', 'weekly_plan', 'fallback'],
  required_data: ['elder_profile', 'meal_rules', 'diet_contraindications'],
  required_knowledge: ['meal_plan'],
  actions_allowed: [
    'meal_plan.generate_weekly_plan',
    'meal_plan.adjust_for_condition',
  ],
  followup_policy: 'meal_plan.default',
  evidence_groups: [
    { group: 'meal_topic', weight: 3, terms: mealTopicTerms },
    { group: 'meal_time', weight: 2.5, terms: mealTimeTerms },
    { group: 'health_condition', weight: 2, terms: healthConditionTerms },
    { group: 'meal_intent', weight: 3, terms: mealIntentTerms },
    { group: 'elder_constraint', weight: 1.5, terms: elderConstraintTerms },
  ],
  role_boost: {
    roles: ['elder', 'elder_family', 'family', 'village_doctor', 'community_doctor', 'care_worker', 'institution_admin'],
    weight: 1,
  },
  context_boost: {
    previous_scene: 'meal_plan',
    weight: 5,
    terms: ['换成', '调整', '改成', '低糖版', '清淡点', '一周', '明天', '继续', '再推荐', '这个', '这份'],
  },
  conflicts: [
    { group: 'travel_route', penalty: 4, terms: ['路线', '导航', '怎么走', '公交', '地铁', '打车', '到医院', '去哪里'] },
    { group: 'find_service', penalty: 4, terms: ['找护工', '找机构', '养老院', '上门服务', '家政', '护理员', '预约服务'] },
    { group: 'dispatch_manage', penalty: 5, terms: ['派单', '工单', '调度', '转人工', '客服处理', '处理进度', '催单'] },
    { group: 'acute_health_risk', penalty: 3.5, terms: ['胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120'] },
  ],
  infer_intent(input) {
    if (has(input, ['一周', '七天', '周计划', '本周', '下周', 'weekly', 'one week', '7 days'])) return 'meal_plan_weekly_plan';
    if (has(input, ['总览', '概览'])) return 'meal_plan_overview';
    if (has(input, ['看板', '仪表盘', '数据看板', '膳食数据'])) return 'meal_plan_dashboard';
    if (has(input, ['时间线', '按时间', '几点吃'])) return 'meal_plan_timeline';
    if (has(input, ['早餐', '早饭', 'breakfast'])) return 'meal_plan_breakfast_advice';
    if (has(input, ['午餐', '午饭', 'lunch'])) return 'meal_plan_lunch_advice';
    if (has(input, ['晚餐', '晚饭', 'dinner'])) return 'meal_plan_dinner_advice';
    if (has(input, healthConditionTerms)) return 'meal_plan_condition_advice';
    return 'meal_plan_advice';
  },
};

function has(input, terms) {
  const text = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  return terms.some((term) => includesTerm(text, term));
}
