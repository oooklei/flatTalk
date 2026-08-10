const SOS_PHONE_ACTIONS = new Set(['sos.call_120', 'sos.notify_family']);

const REDIRECT_ACTIONS = new Set(['travel_route.open_h5_external']);

const SERVER_SKILL_PREFIXES = ['meal_plan.', 'travel_route.', 'health_risk_warning.', 'find_service.', 'dispatch_manage.', 'nearby_resource.', 'service_quality_eval.', 'sos.'];

export function classifyAction(actionKey) {
  if (!actionKey || typeof actionKey !== 'string') return 'invalid';
  if (SOS_PHONE_ACTIONS.has(actionKey)) return 'client_only'; // 电话拨号由前端处理
  if (REDIRECT_ACTIONS.has(actionKey)) return 'client_redirect'; // 外部H5跳转由前端处理
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

  // 预订跳转：如果有 H5 URL，直接返回 redirect 类型，前端打开 H5 页面
  if (actionType === 'client_redirect') {
    const params = request.params || {};
    const h5Url = params.h5_url || '';
    const h5OrderUrl = params.h5_order_url || '';
    const h5ProductUrl = params.h5_product_url || '';
    const redirectUrl = h5Url || h5OrderUrl || h5ProductUrl;
    if (redirectUrl) {
      return {
        ok: true,
        status: 200,
        action_key: actionKey,
        action_type: 'client_redirect',
        result_type: 'redirect',
        redirect_url: redirectUrl,
        redirect_urls: { h5_order_url: h5OrderUrl, h5_product_url: h5ProductUrl },
        params,
      };
    }
    // 没有 H5 URL → 降级为正常 server_skill，让编排器生成"请联系客服"提示
  }

  if (actionType === 'server_skill' || (actionType === 'client_redirect' && actionKey)) {
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
        followup_source: 'action_button',
      },
    });
    return { ok: true, status: 200, action_key: actionKey, action_type: 'server_skill', result_type: 'skill_run', envelope };
  }

  // client_only（仅 SOS 电话拨号）
  return { ok: true, status: 200, action_key: actionKey, action_type: actionType, result_type: 'client_ack', params: request.params || {} };
}

function skillFromAction(actionKey) {
  return String(actionKey).split('.')[0] || 'common';
}

export function templateIdFromAction(actionKey, params = {}) {
  if (actionKey === 'sos.call_120' || actionKey === 'sos.notify_family') return 'service_emergency';
  if (actionKey === 'meal_plan.generate_weekly_plan') return 'weekly_plan';
  // 膳食调整按维度拆分，严格 1 意图 1 模板，禁止混搭：
  //   疾病维度（糖尿病/高血压/痛风…忌口替换）-> diet_condition_card
  //   质地维度（软烂/易咀嚼/吞咽安全）      -> diet_texture_card
  // 拆分前二者共用 meal_plan.adjust_for_condition，导致「按健康状况调整」
  // 与「换成软烂版」出同一张卡。
  if (actionKey === 'meal_plan.adjust_for_disease') return 'diet_condition_card';
  if (actionKey === 'meal_plan.adjust_for_texture') return 'diet_texture_card';
  // 旧 key 保留兼容：历史卡片/客户端可能仍在发送，落到疾病维度（原语义主体）
  if (actionKey === 'meal_plan.adjust_for_condition') return 'diet_condition_card';
  // 旅居预算同理拆分：
  //   算钱（在现有线路上测算费用）-> travel_budget_card
  //   重规划（按预算档改线路）    -> route_svg
  if (actionKey === 'travel_route.calculate_budget') return 'travel_budget_card';
  if (actionKey === 'travel_route.replan_by_budget') return params?.template_id || 'route_svg';
  if (actionKey === 'travel_route.check_availability') return 'travel_availability_card';
  if (actionKey === 'travel_route.check_weather_risk') return 'travel_weather_risk_card';
  if (actionKey === 'travel_route.booking_handoff') return 'travel_h5_embed_card';
  if (actionKey === 'travel_route.view_detail') return params?.template_id || 'travel_itinerary_card';
  if (actionKey === 'travel_route.view_product_detail') return params?.template_id || 'sojourn_route';
  if (String(actionKey || '').startsWith('travel_route.')) return params?.template_id || 'sojourn_route';
  if (String(actionKey || '').startsWith('health_risk_warning.')) {
    if (actionKey === 'health_risk_warning.refresh_signals') return 'health_risk_signal_card';
    if (actionKey === 'health_risk_warning.view_rule_detail') return 'health_risk_rule_card';
    if (actionKey === 'health_risk_warning.view_report') return params?.template_id || 'health_report_card';
    if (actionKey === 'health_risk_warning.view_advice') return params?.template_id || 'care_advice_card';
    if (actionKey === 'health_risk_warning.view_assessment') return params?.template_id || 'risk_assessment_card';
    if (actionKey === 'health_risk_warning.view_constitution') return params?.template_id || 'constitution_card';
    if (actionKey === 'health_risk_warning.view_tongue') return params?.template_id || 'tongue_diagnosis_card';
    if (actionKey === 'health_risk_warning.view_face') return params?.template_id || 'face_observation_card';
    if (actionKey === 'health_risk_warning.view_syndrome') return params?.template_id || 'tcm_syndrome_card';
    if (actionKey === 'health_risk_warning.view_risk_level') return params?.template_id || 'risk_level_card';
    if (actionKey === 'health_risk_warning.view_help') return params?.template_id || 'help_card';
    if (actionKey === 'health_risk_warning.select_elder') return params?.template_id || 'health_warning_card';
    if (actionKey === 'health_risk_warning.fill_elder_info') return params?.template_id || 'elder_duplicate_confirm_card';
    if (actionKey === 'health_risk_warning.request_manual_review') return params?.template_id || 'health_manual_review_card';
    return params?.template_id || 'health_warning_card';
  }
  if (String(actionKey || '').startsWith('find_service.')) {
    if (actionKey === 'find_service.catalog') return 'service_catalog';
    if (actionKey === 'find_service.list_orgs') return 'org_profile';
    if (actionKey === 'find_service.list_workers') return 'worker_profile';
    if (actionKey === 'find_service.detail_order') return 'order_status';
    if (actionKey === 'find_service.detail_service') return 'service_detail';
    if (actionKey === 'find_service.booking_confirm') return 'service_booking_confirm';
    if (actionKey === 'find_service.booking_success') return 'booking_success';
    if (actionKey === 'find_service.booking_reschedule') return 'booking_reschedule';
    if (actionKey === 'find_service.contact_confirm') return 'contact_confirm';
    if (actionKey === 'find_service.preview_order') return 'order_preview';
    if (actionKey === 'find_service.order_ticket') return 'service_order_ticket';
    return params?.template_id || '';
  }
  if (String(actionKey || '').startsWith('dispatch_manage.')) {
    if (actionKey === 'dispatch_manage.detail') return 'dispatch_detail';
    if (actionKey === 'dispatch_manage.work_order') return 'work_order';
    if (actionKey === 'dispatch_manage.status') return 'dispatch_status';
    if (actionKey === 'dispatch_manage.accept') return 'dispatch_accept';
    if (actionKey === 'dispatch_manage.reject') return 'dispatch_reject';
    if (actionKey === 'dispatch_manage.transfer') return 'dispatch_transfer';
    if (actionKey === 'dispatch_manage.supplier') return 'dispatch_supplier_action';
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
  if (String(actionKey || '').startsWith('service_quality_eval.')) {
    const map = {
      'service_quality_eval.view_report': 'institution_quality_report',
      'service_quality_eval.view_staff': 'staff_quality_report',
      'service_quality_eval.view_org_rank': 'org_quality_ranking',
      'service_quality_eval.view_staff_rank': 'staff_quality_ranking',
      'service_quality_eval.rectify': 'rectification_suggestion',
      'service_quality_eval.view_complaint': 'complaint_detail',
      'service_quality_eval.view_standard': 'evaluation_standard',
      'service_quality_eval.export': 'institution_quality_report',
    };
    return params?.template_id || map[actionKey] || 'institution_quality_report';
  }
  return params?.template_id || '';
}

function actionKeyToPrompt(actionKey, params = {}) {
  if (actionKey === 'sos.call_120') return '紧急情况，需要拨打120';
  if (actionKey === 'sos.notify_family') return '紧急情况，需要通知家属';
  if (actionKey === 'meal_plan.generate_weekly_plan') return '生成一周三餐计划 weekly meal plan for seven days';
  if (actionKey === 'meal_plan.adjust_for_condition') return `meal plan for ${params.condition || 'diabetes'} elder`;
  if (actionKey === 'travel_route.replan') {
    return params.destination
      ? `重新规划${params.destination}老人康养旅居路线`
      : '重新规划广西老人康养旅居路线';
  }
  if (actionKey === 'travel_route.compare_destinations') {
    return params.destination
      ? `对比${params.destination}和其他热门旅居目的地哪个更适合老人`
      : '对比当前目的地和其他热门旅居目的地哪个更适合老人';
  }
  if (actionKey === 'travel_route.check_availability') {
    return params.destination
      ? `检查${params.destination}旅居路线近期是否可预订`
      : '检查这条老人旅居路线近期是否可预订';
  }
  if (actionKey === 'travel_route.calculate_budget') {
    return params.destination
      ? `测算${params.destination}老人旅居路线预算`
      : '测算老人旅居路线预算';
  }
  if (actionKey === 'travel_route.check_weather_risk') {
    return params.destination || params.city
      ? `检查${params.destination || params.city}旅居路线天气风险`
      : '检查老人旅居路线天气风险';
  }
  if (actionKey === 'travel_route.plan_transport') return '规划老人旅居路线交通接驳';
  if (actionKey === 'travel_route.view_product_detail') {
    const dest = params.destination || params.city || '';
    const title = params.route_title || '';
    if (dest || title) return `请展示${dest || ''}${title ? `「${title}」` : ''}旅居产品详情`.replace(/\s+/g, '');
    return '请展示当前旅居产品详情';
  }
  if (actionKey === 'travel_route.view_detail') {
    const dest = params.destination || params.city || '';
    const title = params.route_title || '';
    if (params.template_id === 'travel_itinerary_card' || /日程|行程安排/.test(String(params.label || ''))) {
      return `请按天展示${dest || ''}${title ? `「${title}」` : ''}的详细行程安排`.replace(/\s+/g, '');
    }
    if (dest || title) return `请展示${dest || ''}${title ? `「${title}」` : ''}旅居路线详情`.replace(/\s+/g, '');
    return '请展示当前旅居路线详情';
  }
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
      'find_service.detail_service': (params.service_name || params.name)
        ? `查看「${params.service_name || params.name}」服务详情`
        : '查看这项服务的详情',
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
  if (String(actionKey || '').startsWith('service_quality_eval.')) {
    const map = {
      'service_quality_eval.view_report': '查看机构服务质量评估报告',
      'service_quality_eval.view_staff': '查看服务人员服务质量评估报告',
      'service_quality_eval.view_org_rank': '查看机构服务质量排名',
      'service_quality_eval.view_staff_rank': '查看护理员服务质量排名',
      'service_quality_eval.rectify': '生成服务质量整改建议',
      'service_quality_eval.view_complaint': '查看投诉详情和处理流程',
      'service_quality_eval.view_standard': '查看服务质量评分标准',
      'service_quality_eval.export': '导出服务质量评估报告',
    };
    return map[actionKey] || actionKey;
  }
  return actionKey;
}
