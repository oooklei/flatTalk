const CLIENT_ONLY_ACTIONS = new Set([
  'client.copy',
  'client.expand',
  'client.switch_template_view',
]);

const SERVER_SKILL_PREFIXES = ['meal_plan.', 'travel_route.', 'health_risk_warning.', 'guixiaoyang_dispatch.'];

export function classifyAction(actionKey) {
  if (!actionKey || typeof actionKey !== 'string') return 'invalid';
  if (CLIENT_ONLY_ACTIONS.has(actionKey)) return 'client_only';
  if (SERVER_SKILL_PREFIXES.some((prefix) => actionKey.startsWith(prefix))) return 'server_skill';
  return 'external_api';
}

export async function dispatchAction(request = {}, handlers = {}) {
  const actionKey = request.action_key || request.actionKey;
  const actionType = classifyAction(actionKey);
  const actionTemplateId = templateIdFromAction(actionKey, request.params);
  if (actionType === 'invalid') {
    return { ok: false, status: 400, error: 'action_key_required' };
  }

  if (actionType === 'server_skill') {
    const envelope = await handlers.runSkill?.({
      ...request,
      action_key: actionKey,
      skill_key: request.skill_key || request.skillKey || skillFromAction(actionKey),
      template_id: request.template_id || request.templateId || actionTemplateId,
      message: request.user_prompt || request.message || actionKeyToPrompt(actionKey, request.params),
      context: {
        ...(request.context || {}),
        action_key: actionKey,
        action_params: request.params || {},
        previous_turn_id: request.previous_turn_id,
      },
    });
    return { ok: true, status: 200, action_key: actionKey, action_type: actionType, result_type: 'skill_run', envelope };
  }

  if (actionType === 'client_only') {
    return { ok: true, status: 200, action_key: actionKey, action_type: actionType, result_type: 'client_ack', params: request.params || {} };
  }

  return {
    ok: true,
    status: 200,
    action_key: actionKey,
    action_type: actionType,
    result_type: 'external_api_skipped',
    skipped: true,
    reason: 'external_api_adapter_not_configured',
    params: request.params || {},
  };
}

function skillFromAction(actionKey) {
  return String(actionKey).split('.')[0] || 'common';
}

function templateIdFromAction(actionKey, params = {}) {
  if (actionKey === 'meal_plan.generate_weekly_plan') return 'weekly_plan';
  if (String(actionKey || '').startsWith('travel_route.')) return params?.template_id || 'route_card';
  if (String(actionKey || '').startsWith('health_risk_warning.')) {
    if (actionKey === 'health_risk_warning.refresh_signals') return 'health_risk_signal_card';
    if (actionKey === 'health_risk_warning.view_rule_detail') return 'health_risk_rule_card';
    return params?.template_id || 'health_warning_card';
  }
  return params?.template_id || '';
}

function actionKeyToPrompt(actionKey, params = {}) {
  if (actionKey === 'meal_plan.generate_weekly_plan') return '生成一周三餐计划 weekly meal plan for seven days';
  if (actionKey === 'meal_plan.adjust_for_condition') return `meal plan for ${params.condition || 'diabetes'} elder`;
  if (actionKey === 'travel_route.replan') return '重新规划广西老人康养旅居路线';
  if (actionKey === 'travel_route.compare_destinations') return '对比广西巴马和北海老人旅居路线';
  if (actionKey === 'travel_route.check_availability') return '检查这条老人旅居路线近期是否可预订';
  if (actionKey === 'travel_route.calculate_budget') return '测算老人旅居路线预算';
  if (actionKey === 'travel_route.check_weather_risk') return '检查老人旅居路线天气风险';
  if (actionKey === 'travel_route.plan_transport') return '规划老人旅居路线交通接驳';
  if (actionKey === 'travel_route.view_product_detail') return '查看金跳动旅居产品详情';
  if (actionKey === 'travel_route.booking_handoff') return '确认旅居日期并进行金跳动可售校验';
  if (actionKey === 'travel_route.request_manual_review') return '金跳动旅居产品接口不可用，请求人工复核';
  if (actionKey === 'travel_route.fill_preferences') return '补充旅居出行日期、人数、预算和照护偏好';
  if (actionKey === 'health_risk_warning.refresh_signals') return '重新读取老人设备信号并刷新健康风险研判';
  if (actionKey === 'health_risk_warning.view_rule_detail') return '查看本次命中的健康风险规则详情';
  if (actionKey === 'health_risk_warning.request_manual_review') return '本地设备信号研判后请求人工复核/转接';
  if (actionKey === 'health_risk_warning.fill_elder_info') return '补充老人姓名、年龄、基础病史与用药情况';
  if (actionKey === 'health_risk_warning.fill_remote_info') return '补充远程体检指标（云诊365）以提升判定置信度';
  return actionKey;
}
