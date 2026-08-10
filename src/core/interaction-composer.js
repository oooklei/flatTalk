import { dedupeFollowups, normalizeCompactFollowups } from './compact-followups/renderer.js';
import { normalizeActionDisplayItem } from './actions/action-labels.js';
import { entityParamsForScene, withEntityParams } from './conversation/entity-params.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const CATEGORY_RANK = { tight: 0, other: 1 };
const FOLLOWUP_CAP = 6;

/**
 * 加载模板静态追问（src/skills/<skill>/templates/followups/<id>.json）。
 * 这是「追问挂载」的运行时接入点：admin 编辑的追问在此被读取并参与组装。
 */
export function loadStaticFollowups(skillKey, templateId) {
  if (!skillKey || !templateId) return [];
  const file = path.join(ROOT, 'src', 'skills', skillKey, 'templates', 'followups', `${templateId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed?.followup_suggestions) ? parsed.followup_suggestions : [];
    return list
      .filter((f) => f && f.label && f.user_prompt)
      .map((f) => ({ ...f, category: f.category === 'other' ? 'other' : 'tight' }));
  } catch {
    return [];
  }
}

// 聊天侧默认 CTA 一律走 followup_suggestions（见 FOLLOWUP_POLICIES）。
// actions 仅保留卡片内特殊操作（如 SOS tel:），避免与追问双栏重复。
const DEFAULT_ACTIONS_BY_SCENE = {};

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
    intent: 'health_risk_warning.dietary',
    action_key: 'health_risk_warning.view_advice',
  },
  {
    label: '综合风险评估',
    user_prompt: '查看综合风险评估',
    template_id: 'risk_assessment_card',
    intent: 'health_risk_warning.assessment',
    action_key: 'health_risk_warning.view_assessment',
  },
  {
    label: '体质详情',
    user_prompt: '查看中医体质辨识',
    template_id: 'constitution_card',
    intent: 'health_risk_warning.constitution',
    action_key: 'health_risk_warning.view_constitution',
  },
  {
    label: '调理方案',
    user_prompt: '查看个性化调理方案',
    template_id: 'care_advice_card',
    intent: 'health_risk_warning.advice',
    action_key: 'health_risk_warning.view_advice',
  },
];

// 旅居路线 followup
const DEFAULT_FOLLOWUPS_BY_TRAVEL = [
  {
    label: '检查可订',
    user_prompt: '请检查这条旅居路线近期是否可预订',
    template_id: 'travel_availability_card',
    intent: 'travel_route_availability',
    action_key: 'travel_route.check_availability',
  },
  {
    label: '测算预算',
    user_prompt: '请按当前预算档测算这条旅居路线费用',
    template_id: 'travel_plan_summary_card',
    intent: 'travel_route_budget',
    action_key: 'travel_route.calculate_budget',
  },
  {
    label: '天气风险',
    user_prompt: '请检查目的地的天气风险',
    template_id: 'travel_weather_risk_card',
    intent: 'travel_route_weather',
    action_key: 'travel_route.check_weather_risk',
  },
];

// 找服务 followup
const DEFAULT_FOLLOWUPS_BY_SERVICE = [
  {
    label: '智能推荐',
    user_prompt: '请智能推荐适合的养老服务',
    template_id: 'service_recommend',
    intent: 'find_service_recommend',
    action_key: 'find_service.recommend',
  },
  {
    label: '全部服务',
    user_prompt: '查看全部养老服务目录',
    template_id: 'service_catalog',
    intent: 'find_service_catalog',
    action_key: 'find_service.catalog',
  },
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
];

// 派单调度 followup
const DEFAULT_FOLLOWUPS_BY_DISPATCH = [
  {
    label: '派单列表',
    user_prompt: '查看派单列表',
    template_id: 'dispatch_list',
    intent: 'dispatch_list',
    action_key: 'dispatch_manage.list',
  },
  {
    label: '查看工单',
    user_prompt: '查看对应的服务工单',
    template_id: 'work_order',
    intent: 'dispatch_work_order',
    action_key: 'dispatch_manage.work_order',
  },
  {
    label: '查看进度',
    user_prompt: '帮我查看这条派单的进度',
    template_id: 'dispatch_status',
    intent: 'dispatch_status',
    action_key: 'dispatch_manage.status',
  },
];

// 周边资源 followup
const DEFAULT_FOLLOWUPS_BY_NEARBY = [
  {
    label: '全部资源',
    user_prompt: '请展示嘉路康养中心周边全部资源',
    template_id: 'nearby_map',
    intent: 'nearby_resource.all',
    action_key: 'nearby_resource.all',
  },
  {
    label: '只看医疗',
    user_prompt: '请展示嘉路康养中心周边15公里内的医疗资源',
    template_id: 'nearby_map_category',
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
  'meal_plan.default': [
    { label: '一周食谱', user_prompt: '帮我生成一周食谱', action_key: 'meal_plan.generate_weekly_plan' },
    { label: '今日三餐', user_prompt: '今天吃什么', action_key: 'meal_plan.daily_diet' },
    { label: '换一天', user_prompt: '换一天的食谱', action_key: 'meal_plan.daily_diet' },
  ],
  'health_risk_warning.default': DEFAULT_FOLLOWUPS_BY_HEALTH,
  'travel_route.default': DEFAULT_FOLLOWUPS_BY_TRAVEL,
  'find_service.default': DEFAULT_FOLLOWUPS_BY_SERVICE,
  'dispatch_manage.default': DEFAULT_FOLLOWUPS_BY_DISPATCH,
  'nearby_resource.default': DEFAULT_FOLLOWUPS_BY_NEARBY,
  'service_quality_eval.default': [
    { label: '机构报告', user_prompt: '查看机构服务质量报告', action_key: 'service_quality_eval.view_report' },
    { label: '人员评估', user_prompt: '查看护理员服务质量评估', action_key: 'service_quality_eval.view_staff' },
    { label: '整改建议', user_prompt: '查看服务质量整改建议', action_key: 'service_quality_eval.rectify' },
    { label: '查看投诉详情', user_prompt: '查看服务质量投诉详情', action_key: 'service_quality_eval.view_complaint' },
  ],
};

function filterByScene(items, sceneKey) {
  if (!sceneKey) return items;
  const prefix = sceneKey + '.';
  return items.filter(item => {
    if (item.action_key && !item.action_key.startsWith(prefix)) {
      return false;
    }
    return true;
  });
}

/**
 * 把 LIS 的次意图建议（matcher 的 suggestions）转成追问项。
 *
 * LIS 只给 { intent_id, confidence, skill_key, template_id, label }，
 * 没有 `user_prompt` —— 而 isFollowupAllowed 要求 label + user_prompt 都在，
 * 缺了会被静默丢弃。这里用目录描述作为点击后发送的消息。
 *
 * **不设 action_key**：followupIntentKey 会原样返回 action_key，
 * 若填 LIS 的 intent_id（如 travel_route_weather_risk），就无法与场景既有的
 * 同义追问（travel_route.check_weather_risk）归并 —— 卡片底部会出现
 * 「查看天气风险」和「查询旅居目的地天气与出行风险」两个近义按钮。
 * 留空 action_key 可让 followupIntentKey 走文案归一，交给 uniqueFollowup 去重。
 * 真正的路由靠 user_prompt 重新过一遍 LIS 分拣。
 *
 * @param {Array<object>} suggestions - matcher 返回的 suggestions
 * @param {Set<string>} allowed - 场景允许的 action_key 集合
 * @returns {Array<object>}
 */
function normalizeLisSuggestions(suggestions, allowed) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return [];
  return suggestions
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const intentId = String(s.intent_id || '').trim();
      if (!intentId) return null;
      const label = String(s.label || intentId).trim();
      if (!label) return null;
      return normalizeActionDisplayItem({
        label,
        // 点击后实际发送的消息；LIS 会重新分拣到该 intent
        user_prompt: label,
        intent: intentId,
        template_id: s.template_id || undefined,
        skill_key: s.skill_key || undefined,
        category: 'other',
        source: 'lis_secondary',
      });
    })
    .filter(Boolean)
    .filter((item) => isFollowupAllowed(item, allowed));
}

export function composeInteractions({
  sceneDecision = {},
  modelResult = {},
  staticFollowups = [],
  entityParams = null,
  lisSuggestions = [],
} = {}) {
  if (sceneDecision.decision !== 'accept') {
    return {
      actions: [],
      followup_suggestions: [],
    };
  }

  const allowed = new Set(sceneDecision.actions_allowed || []);
  const sceneKey = sceneDecision.scene_key || '';
  const modelActions = Array.isArray(modelResult.actions) ? modelResult.actions : [];
  const defaultActions = DEFAULT_ACTIONS_BY_SCENE[sceneDecision.scene_key] || [];
  const modelFollowups = Array.isArray(modelResult.followup_suggestions) ? modelResult.followup_suggestions : [];

  // 根据 followup_policy 获取默认 followups
  const followupPolicy = sceneDecision.followup_policy || defaultFollowupPolicyForScene(sceneKey);
  const defaultFollowups = FOLLOWUP_POLICIES[followupPolicy] || [];

  const compactFollowups = normalizeCompactFollowups(modelResult.compact_followups);

  // 全局实体 params：默认策略追问也带上锁定实体，避免「查看详情」丢上下文
  const lockedEntityParams = {
    ...entityParamsForScene(sceneKey, modelResult.data || {}, {}),
    ...(entityParams || {}),
  };

  // LIS 次意图建议：跨技能，不能走 filterByScene（前缀检查会全部丢掉），
  // 但必须参与 uniqueFollowup —— 否则会与场景既有的同义追问重复。
  const lisFollowups = normalizeLisSuggestions(lisSuggestions, allowed);

  // 原则：聊天侧以追问（followup_suggestions）为主；actions 仅保留追问未覆盖的操作键
  let rawFollowups = [...staticFollowups, ...modelFollowups, ...defaultFollowups]
    .map(normalizeActionDisplayItem)
    .filter((followup) => isFollowupAllowed(followup, allowed))
    .filter(uniqueFollowup)
    .map((followup) => ({ ...followup, category: followup.category === 'other' ? 'other' : 'tight' }))
    .sort((a, b) => (CATEGORY_RANK[a.category] ?? 0) - (CATEGORY_RANK[b.category] ?? 0));
  rawFollowups = filterByScene(rawFollowups, sceneKey);

  // 场景内追问优先（放前面），LIS 建议补在其后；再整体去重
  rawFollowups = [...rawFollowups, ...lisFollowups].filter(uniqueFollowup);

  const followups = withEntityParams(
    dedupeFollowups(compactFollowups, rawFollowups).slice(0, FOLLOWUP_CAP),
    lockedEntityParams,
  );

  const followupKeys = new Set([
    ...compactFollowups.map((f) => f.action_key).filter(Boolean),
    ...followups.map((f) => f.action_key).filter(Boolean),
  ]);
  const followupIntents = new Set([
    ...compactFollowups.map((f) => followupIntentKey(f)).filter(Boolean),
    ...followups.map((f) => followupIntentKey(f)).filter(Boolean),
  ]);
  const compactPrompts = new Set(compactFollowups.map((f) => normalizePrompt(f.user_prompt)).filter(Boolean));

  let actions = [...modelActions, ...defaultActions]
    .map(normalizeActionDisplayItem)
    .filter((action) => isActionAllowed(action, allowed))
    .filter(uniqueAction)
    .filter((action) => !followupKeys.has(action.action_key))
    .filter((action) => !followupIntents.has(followupIntentKey(action)))
    .filter((action) => !compactPrompts.has(normalizePrompt(action.user_prompt || action.label)))
    .slice(0, 4);
  actions = withEntityParams(filterByScene(actions, sceneKey), lockedEntityParams);

  return {
    actions,
    compact_followups: withEntityParams(compactFollowups, lockedEntityParams),
    followup_suggestions: followups,
  };
}

function uniqueAction(action, index, actions) {
  const key = `${action.action_key}:${action.label}`;
  return actions.findIndex((item) => `${item.action_key}:${item.label}` === key) === index;
}

function uniqueFollowup(followup, index, followups) {
  const intent = followupIntentKey(followup);
  const label = normalizeFollowupKey(followup.label);
  const prompt = normalizeFollowupKey(followup.user_prompt);
  return followups.findIndex((item) => {
    if (intent && followupIntentKey(item) === intent) return true;
    if (item.action_key && followup.action_key && item.action_key === followup.action_key) return true;
    return normalizeFollowupKey(item.label) === label
      || normalizeFollowupKey(item.user_prompt) === prompt;
  }) === index;
}

/** 把同义文案收成同一意图键，用于追问去重（全场景） */
function followupIntentKey(followup = {}) {
  if (followup.action_key) return String(followup.action_key).trim().toLowerCase();
  const text = `${followup.label || ''}${followup.user_prompt || ''}`.toLowerCase();
  // travel
  if (/天气|潮汐/.test(text)) return 'travel_route.check_weather_risk';
  if (/可订|预订|预定/.test(text)) return 'travel_route.check_availability';
  if (/预算/.test(text)) return 'travel_route.calculate_budget';
  if (/对比|比较/.test(text) && /(目的地|路线|基地)/.test(text)) return 'travel_route.compare_destinations';
  if (/重新规划|换.*(路线|目的地)/.test(text)) return 'travel_route.replan';
  // find_service
  if (/智能推荐|推荐服务/.test(text)) return 'find_service.recommend';
  if (/全部服务|服务目录/.test(text)) return 'find_service.catalog';
  if (/护工|护理人员|上门护理/.test(text)) return 'find_service.list_workers';
  if (/养老机构|服务机构|看机构|入住机构|养老院/.test(text)) return 'find_service.list_orgs';
  // nearby
  if (/全部.*(资源|配套)|全部配套/.test(text)) return 'nearby_resource.all';
  if (/只看医疗|医疗资源/.test(text)) return 'nearby_resource.medical';
  if (/餐馆|吃饭|餐饮/.test(text)) return 'nearby_resource.food';
  if (/游玩|景点|好玩/.test(text)) return 'nearby_resource.leisure';
  // health
  if (/重新读取|刷新信号/.test(text)) return 'health_risk_warning.refresh_signals';
  if (/规则命中/.test(text)) return 'health_risk_warning.view_rule_detail';
  if (/人工复核|转人工/.test(text)) return 'health_risk_warning.request_manual_review';
  if (/调理方案/.test(text)) return 'health_risk_warning.view_advice';
  // meal
  if (/一周计划|一周食谱/.test(text)) return 'meal_plan.generate_weekly_plan';
  if (/慢病调整|按慢病/.test(text)) return 'meal_plan.adjust_for_condition';
  // dispatch
  if (/派单列表/.test(text)) return 'dispatch_manage.list';
  if (/查看工单|服务工单/.test(text)) return 'dispatch_manage.work_order';
  if (/查看进度|派单进度/.test(text)) return 'dispatch_manage.status';
  return '';
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
  if (!followup.action_key || allowed.size === 0 || allowed.has(followup.action_key)) return true;
  return Array.from(allowed).some((entry) => (
    typeof entry === 'string'
    && entry.endsWith('.*')
    && followup.action_key.startsWith(entry.slice(0, -1))
  ));
}

function defaultFollowupPolicyForScene(sceneKey) {
  if (!sceneKey) return '';
  const policy = `${sceneKey}.default`;
  return FOLLOWUP_POLICIES[policy] ? policy : '';
}

function normalizeFollowupKey(value) {
  return String(value || '').replace(/[？?。！!，,\s]/g, '').trim();
}

function normalizePrompt(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, '');
}
