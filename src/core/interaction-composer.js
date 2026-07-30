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
};

const DEFAULT_FOLLOWUPS_BY_POLICY = [
  { label: '查询补贴条件', user_prompt: '老人有什么补贴，申请条件是什么' },
  { label: '整理办理材料', user_prompt: '办理养老补贴需要准备哪些材料' },
  { label: '查询办理流程', user_prompt: '养老政策补贴应该去哪里办理，流程是什么' },
];

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
  const defaultFollowups = sceneDecision.followup_policy === 'common.policy' ? DEFAULT_FOLLOWUPS_BY_POLICY : [];
  const actions = [...modelActions, ...defaultActions]
    .filter((action) => isActionAllowed(action, allowed))
    .filter(uniqueAction)
    .slice(0, 4);

  return {
    actions,
    followup_suggestions: [...modelFollowups, ...defaultFollowups]
      .filter((followup) => isFollowupAllowed(followup, allowed))
      .filter(uniqueFollowup)
      .slice(0, 3),
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
