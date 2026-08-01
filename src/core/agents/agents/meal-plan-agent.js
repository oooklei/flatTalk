import { createBaseAgent } from '../base-agent.js';

// 与 scene-router/rules/meal-plan.js evidence_groups 对齐
const mealTopicTerms = [
  '膳食', '饮食', '饭菜', '饭', '吃什么', '吃啥', '餐食', '食谱', '菜谱',
  '营养餐', '配餐', '助餐', '老人餐', '餐单', '菜单',
  '总览', '看板', '仪表盘', '时间线', '数据看板', '膳食数据',
  'meal', 'diet', 'nutrition', 'recipe', 'breakfast', 'lunch', 'dinner',
  'meal plan', 'mealplan', 'what to eat', 'food plan',
];
const mealTimeTerms = [
  '早餐', '早饭', '午餐', '午饭', '晚餐', '晚饭', '一周', '七天', '周计划',
  '明天', '今天', '今日', '每日', '本周', '下周',
  'breakfast', 'lunch', 'dinner', 'weekly', 'one week', '7 days', '7-day',
];
const healthConditionTerms = [
  '糖尿病', '血糖', '低糖', '控糖', '高血压', '血压', '低盐', '痛风', '尿酸',
  '肾病', '高血脂', '血脂', '冠心病', '便秘', '吞咽', '咀嚼', '术后',
  'diabetes', 'blood sugar', 'low sugar', 'low-sugar', 'hypertension',
  'high blood pressure', 'low salt', 'gout', 'high cholesterol',
];
const mealIntentTerms = [
  '推荐', '安排', '计划', '生成', '制定', '搭配', '调整', '换成', '改成',
  '适合', '怎么吃', '能吃', '不能吃', '低糖版', '清淡点',
  'recommend', 'plan', 'suggest', 'generate', 'arrange', 'what should',
];
const elderConstraintTerms = [
  '老人餐', '老人饭', '老年餐', '长者', '老年人', '爷爷', '奶奶', '外公', '外婆', '爸妈', '父亲',
  '母亲', '家属', '家里老人', '独居老人', '失能', '半失能',
];

const boundaryTerms = [
  '旅居', '旅游', '出行', '景点', '路线', '导航',
  '护工', '机构', '养老院', '上门服务',
  '周边', '附近', '地图',
  '派单', '工单', '调度',
  // 急症移交词（rule conflicts.acute_health_risk）
  '胸痛', '昏迷', '呼吸困难', '中风', '急救', '120',
];
const boundaryMap = {
  '旅居': 'travel_route', '旅游': 'travel_route', '出行': 'travel_route', '景点': 'travel_route',
  '路线': 'travel_route', '导航': 'travel_route',
  '护工': 'find_service', '机构': 'find_service', '养老院': 'find_service', '上门服务': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource', '地图': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage', '调度': 'dispatch_manage',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '呼吸困难': 'health_risk_warning',
  '中风': 'health_risk_warning', '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createMealPlanAgent() {
  return createBaseAgent({
    key: 'meal_plan', name: '膳食助手', actionPrefix: 'meal_plan',
    evidenceGroups: [
      { group: 'meal_topic', weight: 3, terms: mealTopicTerms },
      { group: 'meal_time', weight: 2.5, terms: mealTimeTerms },
      { group: 'health_condition', weight: 2, terms: healthConditionTerms },
      { group: 'meal_intent', weight: 3, terms: mealIntentTerms },
      { group: 'elder_constraint', weight: 1.5, terms: elderConstraintTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 5,
  });
}
