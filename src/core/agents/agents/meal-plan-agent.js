import { createBaseAgent } from '../base-agent.js';

const mealTopicTerms = [
  '膳食', '饮食', '饭菜', '吃什么', '吃啥', '餐食', '食谱', '菜谱',
  '营养餐', '配餐', '助餐', '老人餐', '餐单', '菜单',
  'meal', 'diet', 'nutrition', 'recipe',
];
const mealTimeTerms = [
  '早餐', '早饭', '午餐', '午饭', '晚餐', '晚饭', '一周', '七天', '周计划',
  '明天', '今天', '本周', '下周',
];
const healthConditionTerms = [
  '糖尿病', '血糖', '低糖', '控糖', '高血压', '血压', '低盐', '痛风', '尿酸',
  '肾病', '高血脂', '咀嚼', '吞咽',
];
const mealIntentTerms = [
  '推荐', '安排', '计划', '生成', '制定', '搭配', '调整', '换成', '改成',
  '适合', '怎么吃', '能吃', '不能吃', '低糖版', '清淡点',
];
const boundaryTerms = [
  '旅居', '旅游', '出行', '景点', '路线', '导航',
  '护工', '机构', '养老院', '上门服务',
  '周边', '附近', '地图',
  '派单', '工单', '调度',
];
const boundaryMap = {
  '旅居': 'travel_route', '旅游': 'travel_route', '出行': 'travel_route', '景点': 'travel_route',
  '路线': 'travel_route', '导航': 'travel_route',
  '护工': 'find_service', '机构': 'find_service', '养老院': 'find_service', '上门服务': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource', '地图': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage', '调度': 'dispatch_manage',
};

export function createMealPlanAgent() {
  return createBaseAgent({
    key: 'meal_plan', name: '膳食助手', actionPrefix: 'meal_plan',
    evidenceGroups: [
      { group: 'meal_topic', weight: 3, terms: mealTopicTerms },
      { group: 'meal_time', weight: 2.5, terms: mealTimeTerms },
      { group: 'health_condition', weight: 2, terms: healthConditionTerms },
      { group: 'meal_intent', weight: 3, terms: mealIntentTerms },
    ],
    boundaryTerms, boundaryMap, threshold: 5,
  });
}
