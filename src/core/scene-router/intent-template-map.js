/**
 * intent→template 集中映射表
 * 替代 selectRoutedTemplateId() 中的硬编码逻辑
 */

export const INTENT_TEMPLATE_MAP = {
  travel_route: {
    'travel_route_plan':         'travel_need_summary_card',
    'travel_route_itinerary':    'travel_itinerary_card',
    'travel_route_base':         'travel_base_card',
    'travel_route_spot':         'travel_spot_card',
    'travel_route_transport':    'travel_transport_card',
    'travel_route_medical':      'travel_medical_card',
    'travel_route_weather_risk': 'travel_weather_risk_card',
    'travel_route_booking':      'travel_plan_summary_card',
    'travel_route_budget':       'travel_plan_summary_card',
    'travel_route_compare':      'route_card',
    'travel_route_query':        'route_card',
    'default':                   'route_card',
  },

  health_risk_warning: {
    'health_risk_warning.assess':          'risk_assessment_card',
    'health_risk_warning.manual_review':   'health_warning_card',
    'health_risk_warning.rule_detail':     'health_risk_rule_card',
    'health_risk_warning.signal_detail':   'health_risk_signal_card',
    'health_risk_warning.report':          'health_report_card',
    'health_risk_warning.warning':         'risk_warning_card',
    'health_risk_warning.dietary':         'dietary_regimen_card',
    'default':                             'health_warning_card',
  },

  find_service: {
    'find_service_org':           'org_profile',
    'find_service_order':         'service_order_form',
    'find_service_order_ticket':  'service_order_ticket',
    'find_service_order_preview': 'order_preview',
    'find_service_order_view':    'order_status',
    'find_service_worker':        'worker_profile',
    'find_service_catalog':       'service_catalog',
    'find_service_detail':        'service_detail',
    'find_service_expand':        'service_expand',
    'find_service_guess_like':    'service_guess_like',
    'find_service_discover':      'service_recommend',
    'default':                    'service_recommend',
  },

  nearby_resource: {
    'nearby_resource.stay':     'nearby_stay_card',
    'nearby_resource.spot':     'nearby_spot_card',
    'nearby_resource.food':     'nearby_food_card',
    'nearby_resource.leisure':  'nearby_recommend',
    'nearby_resource.shop':     'nearby_list',
    'nearby_resource.transit':  'nearby_map_route',
    'nearby_resource.wellness': 'nearby_wellness',
    'nearby_resource.list':     'nearby_list',
    'nearby_resource.radar':    'nearby_radar',
    'nearby_resource.compare':  'nearby_compare',
    'nearby_resource.recommend':'nearby_recommend',
    'nearby_resource.summary':  'nearby_summary',
    'nearby_resource.route':    'nearby_map_route',
    'nearby_resource.category': 'nearby_map_category',
    'nearby_resource.all':      'nearby_map_overview',
    'default':                  'nearby_map_overview',
  },

  meal_plan: {
    'meal_plan_weekly_plan':      'weekly_plan',
    'meal_plan_overview':         'meal_overview_card',
    'meal_plan_dashboard':        'meal_dashboard_card',
    'meal_plan_timeline':         'meal_timeline_card',
    'meal_plan_advice':           'diet_card',
    'meal_plan_breakfast_advice': 'diet_card',
    'meal_plan_lunch_advice':     'diet_card',
    'meal_plan_dinner_advice':    'diet_card',
    'meal_plan_condition_advice': 'diet_card',
    'default':                    'diet_card',
  },

  dispatch_manage: {
    'dispatch_accept':           'dispatch_detail',
    'dispatch_reject':           'dispatch_detail',
    'dispatch_detail':           'dispatch_detail',
    'dispatch_supplier':         'dispatch_supplier_action',
    'dispatch_transfer':         'dispatch_transfer',
    'dispatch_work_order':       'work_order',
    'dispatch_status':           'dispatch_status',
    'dispatch_list':             'dispatch_list',
    'default':                   'dispatch_list',
  },

  common: {
    'elder_policy_apply':       'policy_apply_guide_card',
    'elder_policy_benefit':     'policy_list_card',
    'elder_policy_detail':      'policy_detail_card',
    'elder_policy_list':        'policy_list_card',
    'elder_policy_consult':     'policy_card',
    'elder_assistant_usage':    'answer',
    'default':                  'answer',
  },
};

/**
 * 根据 sceneKey + intent 查找模板ID
 * @param {string} sceneKey - 场景key
 * @param {string} intent - 意图字符串
 * @param {string[]} availableIds - 当前技能可用的模板ID列表
 * @returns {string} 模板ID，空字符串表示无匹配
 */
export function resolveTemplateId(sceneKey, intent, availableIds = []) {
  const map = INTENT_TEMPLATE_MAP[sceneKey];
  if (!map) return '';

  // 1. intent 精确匹配
  if (intent && map[intent] && availableIds.includes(map[intent])) {
    return map[intent];
  }

  // 2. 模糊匹配（intent 包含 map 的某个 key）
  if (intent) {
    for (const [key, tplId] of Object.entries(map)) {
      if (key === 'default') continue;
      if (intent.includes(key) && availableIds.includes(tplId)) {
        return tplId;
      }
    }
  }

  // 3. default
  if (map.default && availableIds.includes(map.default)) {
    return map.default;
  }

  // 4. 最后手段：返回 default（即使不在 availableIds 中）
  return map.default || '';
}

/**
 * 获取场景下所有候选模板（用于 LLM 候选选择）
 * @param {string} sceneKey
 * @param {string[]} availableIds
 * @returns {string[]}
 */
export function getCandidates(sceneKey, availableIds = []) {
  const map = INTENT_TEMPLATE_MAP[sceneKey];
  if (!map) return [];

  const allTemplates = Object.values(map).filter(v => v !== map.default);
  const candidates = allTemplates.filter(id => availableIds.includes(id));

  // 确保 default 也在候选中
  if (map.default && availableIds.includes(map.default) && !candidates.includes(map.default)) {
    candidates.push(map.default);
  }

  return candidates;
}
