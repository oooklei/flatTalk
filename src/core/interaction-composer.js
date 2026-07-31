import { dedupeFollowups } from './compact-followups/renderer.js';

const DEFAULT_ACTIONS_BY_SCENE = {
  meal_plan: [
    { action_key: 'meal_plan.generate_weekly_plan', label: '生成一周计划', params: { template_id: 'weekly_plan' } },
    { action_key: 'meal_plan.adjust_for_condition', label: '按慢病调整', params: {} },
    { action_key: 'meal_plan.save_preference', label: '保存偏好', params: {} },
  ],
  health_risk_warning: [
    { action_key: 'health_risk_warning.refresh_signals', label: '重新读取设备信号', params: { template_id: 'health_risk_signal_card' } },
    { action_key: 'health_risk_warning.view_rule_detail', label: '查看规则命中', params: { template_id: 'health_risk_rule_card' } },
    { action_key: 'health_risk_warning.request_manual_review', label: '请求人工复核', params: {} },
  ],
  nearby_resource: [
    { action_key: 'nearby_resource.all', label: '全部资源', params: {} },
    { action_key: 'nearby_resource.medical', label: '只看医疗', params: {} },
    { action_key: 'nearby_resource.food', label: '只看餐馆', params: {} },
    { action_key: 'nearby_resource.leisure', label: '只看游玩', params: {} },
  ],
  find_service: [
    { action_key: 'find_service.recommend', label: '智能推荐', params: {} },
    { action_key: 'find_service.catalog', label: '全部服务', params: { template_id: 'service_catalog' } },
    { action_key: 'find_service.list_workers', label: '找护理人员', params: { template_id: 'worker_profile' } },
  ],
  dispatch_manage: [
    { action_key: 'dispatch_manage.list', label: '派单列表', params: { template_id: 'dispatch_list' } },
    { action_key: 'dispatch_manage.work_order', label: '查看工单', params: { template_id: 'work_order' } },
  ],
};

// 政策咨询 followup
const DEFAULT_FOLLOWUPS_BY_POLICY = [
  {
    label: '查询补贴条件',
    user_prompt: '老人有什么补贴，申请条件是什么',
    template_id: 'policy_list_card',
    intent: 'elder_policy_benefit',
  },
  {
    label: '整理办理材料',
    user_prompt: '办理养老补贴需要准备哪些材料',
    template_id: 'policy_apply_guide_card',
    intent: 'elder_policy_apply',
  },
  {
    label: '查询办理流程',
    user_prompt: '养老补贴应该去哪里办理，流程是什么',
    template_id: 'policy_apply_guide_card',
    intent: 'elder_policy_apply',
  },
];

// 膳食计划 followup
const DEFAULT_FOLLOWUPS_BY_MEAL = [
  {
    label: '生成一周计划',
    user_prompt: '请基于这份膳食建议生成一周三餐计划',
    template_id: 'weekly_plan',
    intent: 'meal_plan_weekly_plan',
    action_key: 'meal_plan.generate_weekly_plan',
  },
  {
    label: '按慢病调整',
    user_prompt: '请结合老人的慢病情况调整这份膳食建议',
    template_id: 'diet_card',
    intent: 'meal_plan_adjust',
    action_key: 'meal_plan.adjust_for_condition',
  },
  {
    label: '换成软烂版',
    user_prompt: '请把这份膳食建议调整为软烂易咀嚼版本',
    template_id: 'diet_card',
    intent: 'meal_plan_adjust',
    action_key: 'meal_plan.adjust_for_condition',
  },
  {
    label: '采购清单',
    user_prompt: '请整理这一周膳食计划的采购清单',
    template_id: 'diet_card',
    intent: 'meal_plan_shopping',
  },
];

// 健康风险预警 followup
const DEFAULT_FOLLOWUPS_BY_HEALTH = [
  {
    label: '重新读取信号',
    user_prompt: '请重新读取设备健康信号',
    template_id: 'health_risk_signal_card',
    intent: 'health_risk_refresh',
    action_key: 'health_risk_warning.refresh_signals',
  },
  {
    label: '查看规则命中',
    user_prompt: '请展示触发预警的具体规则',
    template_id: 'health_risk_rule_card',
    intent: 'health_risk_rules',
    action_key: 'health_risk_warning.view_rule_detail',
  },
  {
    label: '膳食调养建议',
    user_prompt: '请提供针对当前健康风险的膳食调养建议',
    template_id: 'dietary_regimen_card',
    intent: 'health_risk_dietary',
  },
];

// 旅居路线 followup
const DEFAULT_FOLLOWUPS_BY_TRAVEL = [
  {
    label: '对比目的地',
    user_prompt: '请对比巴马和北海哪个更适合老人旅居',
    template_id: 'route_card',
    intent: 'travel_route_compare',
    action_key: 'travel_route.compare_destinations',
  },
  {
    label: '查可订状态',
    user_prompt: '请检查这条旅居路线近期是否可预订',
    template_id: 'route_card',
    intent: 'travel_route_availability',
    action_key: 'travel_route.check_availability',
  },
  {
    label: '调整预算',
    user_prompt: '请按经济型预算重新规划这条旅居路线',
    template_id: 'route_card',
    intent: 'travel_route_budget',
    action_key: 'travel_route.calculate_budget',
  },
  {
    label: '查看天气风险',
    user_prompt: '请检查目的地的天气风险',
    template_id: 'travel_weather_risk_card',
    intent: 'travel_route_weather',
  },
];

// 找服务 followup
const DEFAULT_FOLLOWUPS_BY_SERVICE = [
  {
    label: '找护工上门',
    user_prompt: '我想找护工上门护理',
    template_id: 'worker_profile',
    intent: 'find_service_worker',
    action_key: 'find_service.list_workers',
  },
  {
    label: '看养老机构',
    user_prompt: '有哪些养老机构可以入住',
    template_id: 'org_profile',
    intent: 'find_service_org',
    action_key: 'find_service.list_orgs',
  },
  {
    label: '直接预约',
    user_prompt: '帮我预约上门护理服务',
    template_id: 'order_preview',
    intent: 'find_service_order',
    action_key: 'find_service.book',
  },
];

// 派单调度 followup
const DEFAULT_FOLLOWUPS_BY_DISPATCH = [
  {
    label: '接第一条派单',
    user_prompt: '接下第一条待接派的单子',
    template_id: 'dispatch_detail',
    intent: 'dispatch_accept',
    action_key: 'dispatch_manage.accept_first',
  },
  {
    label: '查看工单',
    user_prompt: '查看对应的服务工单',
    template_id: 'work_order',
    intent: 'dispatch_work_order',
    action_key: 'dispatch_manage.work_order',
  },
  {
    label: '催一下进度',
    user_prompt: '帮我催一下这条派单的进度',
    template_id: 'dispatch_status',
    intent: 'dispatch_status',
    action_key: 'dispatch_manage.urge',
  },
];

// 周边资源 followup
const DEFAULT_FOLLOWUPS_BY_NEARBY = [
  {
    label: '只看医疗',
    user_prompt: '请展示嘉路康养中心周边15公里内的医疗资源',
    template_id: 'nearby_map',
    intent: 'nearby_resource.medical',
    action_key: 'nearby_resource.medical',
  },
  {
    label: '周边餐馆',
    user_prompt: '请展示嘉路康养中心附近能吃饭的餐馆',
    template_id: 'nearby_map',
    intent: 'nearby_resource.food',
    action_key: 'nearby_resource.food',
  },
  {
    label: '好玩的地方',
    user_prompt: '请展示嘉路康养中心周边能游玩的景点',
    template_id: 'nearby_map',
    intent: 'nearby_resource.leisure',
    action_key: 'nearby_resource.leisure',
  },
];

// 根据场景获取默认 followup
const FOLLOWUP_POLICIES = {
  'common.policy': DEFAULT_FOLLOWUPS_BY_POLICY,
  'meal_plan.diet': DEFAULT_FOLLOWUPS_BY_MEAL,
  'meal_plan.weekly': DEFAULT_FOLLOWUPS_BY_MEAL,
  'health_risk_warning.default': DEFAULT_FOLLOWUPS_BY_HEALTH,
  'travel_route.default': DEFAULT_FOLLOWUPS_BY_TRAVEL,
  'find_service.default': DEFAULT_FOLLOWUPS_BY_SERVICE,
  'dispatch_manage.default': DEFAULT_FOLLOWUPS_BY_DISPATCH,
  'nearby_resource.default': DEFAULT_FOLLOWUPS_BY_NEARBY,
};

export function composeInteractions({ sceneDecision = {}, modelResult = {} } = {}) {
  if (sceneDecision.decision !== 'accept') {
    return {
      actions: [],
      followup_suggestions: [],
    };
  }

  const allowed = new Set(sceneDecision.actions_allowed || []);
  const modelActions = Array.isArray(modelResult.actions) ? modelResult.actions : [];
  const defaultActions = DEFAULT_ACTIONS_BY_SCENE[sceneDecision.scene_key] || [];
  const modelFollowups = Array.isArray(modelResult.followup_suggestions) ? modelResult.followup_suggestions : [];

  // 根据 followup_policy 获取默认 followups
  const followupPolicy = sceneDecision.followup_policy || '';
  const defaultFollowups = FOLLOWUP_POLICIES[followupPolicy] || [];

  const actions = [...modelActions, ...defaultActions]
    .filter((action) => isActionAllowed(action, allowed))
    .filter(uniqueAction)
    .slice(0, 4);

  const compactFollowups = Array.isArray(modelResult.compact_followups)
    ? modelResult.compact_followups
    : [];

  const rawFollowups = [...modelFollowups, ...defaultFollowups]
    .filter((followup) => isFollowupAllowed(followup, allowed))
    .filter(uniqueFollowup);

  return {
    actions,
    compact_followups: compactFollowups,
    followup_suggestions: dedupeFollowups(compactFollowups, rawFollowups).slice(0, 4),
  };
}

function uniqueAction(action, index, actions) {
  const key = `${action.action_key}:${action.label}`;
  return actions.findIndex((item) => `${item.action_key}:${item.label}` === key) === index;
}

function uniqueFollowup(followup, index, followups) {
  const label = normalizeFollowupKey(followup.label);
  const prompt = normalizeFollowupKey(followup.user_prompt);
  return followups.findIndex((item) => (
    normalizeFollowupKey(item.label) === label
    || normalizeFollowupKey(item.user_prompt) === prompt
  )) === index;
}

function isActionAllowed(action, allowed) {
  if (!action?.action_key || !action?.label) return false;
  if (allowed.size === 0) return true;
  if (allowed.has(action.action_key)) return true;
  // 支持场景规则中的通配符授权，例如 'health_risk_warning.*' 匹配 'health_risk_warning.refresh_signals'
  return Array.from(allowed).some((entry) => (
    typeof entry === 'string'
    && entry.endsWith('.*')
    && action.action_key.startsWith(entry.slice(0, -1))
  ));
}

function isFollowupAllowed(followup, allowed) {
  if (!followup?.label || !followup?.user_prompt) return false;
  return !followup.action_key || allowed.size === 0 || allowed.has(followup.action_key);
}

function normalizeFollowupKey(value) {
  return String(value || '').replace(/[？?。！!，,\s]/g, '').trim();
}