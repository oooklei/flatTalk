const SOS_PHONE_ACTIONS = new Set(['sos.call_120', 'sos.notify_family']);

const SERVER_SKILL_PREFIXES = ['meal_plan.', 'travel_route.', 'health_risk_warning.', 'find_service.', 'dispatch_manage.', 'nearby_resource.', 'sos.'];

export function classifyAction(actionKey) {
  if (!actionKey || typeof actionKey !== 'string') return 'invalid';
  if (SOS_PHONE_ACTIONS.has(actionKey)) return 'client_only'; // 电话拨号由前端处理
  if (SERVER_SKILL_PREFIXES.some((prefix) => actionKey.startsWith(prefix))) return 'server_skill';
  return 'invalid';
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

  // client_only（仅 SOS 电话拨号）
  return { ok: true, status: 200, action_key: actionKey, action_type: actionType, result_type: 'client_ack', params: request.params || {} };
}

function skillFromAction(actionKey) {
  return String(actionKey).split('.')[0] || 'common';
}

function templateIdFromAction(actionKey, params = {}) {
  if (actionKey === 'sos.call_120' || actionKey === 'sos.notify_family') return 'service_emergency';
  if (actionKey === 'meal_plan.generate_weekly_plan') return 'weekly_plan';
  if (actionKey === 'travel_route.check_weather_risk') return 'travel_weather_risk_card';
  if (String(actionKey || '').startsWith('travel_route.')) return params?.template_id || 'route_card';
  if (String(actionKey || '').startsWith('health_risk_warning.')) {
    if (actionKey === 'health_risk_warning.refresh_signals') return 'health_risk_signal_card';
    if (actionKey === 'health_risk_warning.view_rule_detail') return 'health_risk_rule_card';
    return params?.template_id || 'health_warning_card';
  }
  if (String(actionKey || '').startsWith('find_service.')) {
    if (actionKey === 'find_service.catalog') return 'service_catalog';
    if (actionKey === 'find_service.list_orgs') return 'org_profile';
    if (actionKey === 'find_service.list_workers') return 'worker_profile';
    if (actionKey === 'find_service.detail_order') return 'order_status';
    if (actionKey === 'find_service.detail_service') return 'service_detail';
    return params?.template_id || 'service_recommend';
  }
  if (String(actionKey || '').startsWith('dispatch_manage.')) {
    if (actionKey === 'dispatch_manage.detail') return 'dispatch_detail';
    if (actionKey === 'dispatch_manage.work_order') return 'work_order';
    if (actionKey === 'dispatch_manage.status') return 'dispatch_status';
    return params?.template_id || 'dispatch_list';
  }
  if (String(actionKey || '').startsWith('nearby_resource.')) {
    const map = {
      'nearby_resource.compare': 'nearby_compare',
      'nearby_resource.recommend': 'nearby_recommend',
      'nearby_resource.route': 'nearby_map_route',
      'nearby_resource.radar': 'nearby_radar',
      'nearby_resource.wellness': 'nearby_wellness',
      'nearby_resource.summary': 'nearby_summary',
      'nearby_resource.all': 'nearby_map_overview',
      'nearby_resource.spot': 'nearby_spot_card',
      'nearby_resource.stay': 'nearby_stay_card',
      'nearby_resource.food': 'nearby_food_card',
      'nearby_resource.medical': 'nearby_wellness',
      'nearby_resource.shop': 'nearby_list',
      'nearby_resource.transit': 'nearby_list',
      'nearby_resource.leisure': 'nearby_list',
    };
    if (map[actionKey]) return params?.template_id || map[actionKey];
    return params?.template_id || 'nearby_list';
  }
  return params?.template_id || '';
}

function actionKeyToPrompt(actionKey, params = {}) {
  if (actionKey === 'sos.call_120') return '紧急情况，需要拨打120';
  if (actionKey === 'sos.notify_family') return '紧急情况，需要通知家属';
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
  if (String(actionKey || '').startsWith('find_service.')) {
    const map = {
      'find_service.recommend': '帮我智能推荐养老服务',
      'find_service.catalog': '查看全部养老服务',
      'find_service.detail_service': '查看这项服务的详情',
      'find_service.list_orgs': '有哪些养老机构可以入住',
      'find_service.list_workers': '推荐上门护理人员',
      'find_service.detail_order': '查看我的服务订单',
    };
    return map[actionKey] || actionKey;
  }
  if (String(actionKey || '').startsWith('dispatch_manage.')) {
    const map = {
      'dispatch_manage.list': '查看派单列表',
      'dispatch_manage.detail': '查看这条派单详情',
      'dispatch_manage.work_order': '查看对应的服务工单',
      'dispatch_manage.status': '查询这个派单的进度',
    };
    return map[actionKey] || actionKey;
  }
  if (String(actionKey || '').startsWith('nearby_resource.')) {
    const map = {
      'nearby_resource.all': '嘉路周边全部生活配套',
      'nearby_resource.stay': '嘉路周边民宿和康养小院',
      'nearby_resource.food': '嘉路周边餐厅餐饮',
      'nearby_resource.spot': '嘉路周边滨海景区',
      'nearby_resource.medical': '嘉路周边医疗康养',
      'nearby_resource.leisure': '嘉路周边垂钓休闲',
      'nearby_resource.shop': '嘉路周边购物特产',
      'nearby_resource.transit': '嘉路周边包车交通',
      'nearby_resource.wellness': '嘉路周边医疗康养',
      'nearby_resource.compare': '嘉路周边同类资源对比',
      'nearby_resource.recommend': '嘉路周边适合老人的推荐',
      'nearby_resource.route': '帮我规划嘉路周边一日康养游路线',
      'nearby_resource.radar': '嘉路周边步行能到的配套',
      'nearby_resource.summary': '简单告诉我嘉路周边有什么配套',
    };
    return map[actionKey] || actionKey;
  }
  return actionKey;
}
