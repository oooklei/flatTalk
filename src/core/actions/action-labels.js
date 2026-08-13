export const ACTION_LABELS_ZH = {
  'meal_plan.generate_weekly_plan': '生成一周计划',
  'meal_plan.adjust_for_condition': '按健康状况调整',
  'meal_plan.daily_diet': '今日三餐',
  'meal_plan.check_risk': '检查饮食风险',
  'meal_plan.shopping_list': '生成采购清单',
  'travel_route.compare_destinations': '对比目的地',
  'travel_route.check_availability': '查可订状态',
  'travel_route.calculate_budget': '测算旅居预算',
  'travel_route.check_weather_risk': '查看天气风险',
  'travel_route.check_accessibility': '查看适老设施',
  'travel_route.check_policy_subsidy': '查询政策补贴',
  'travel_route.explain_safety': '查看安全提示',
  'travel_route.replan': '重新规划路线',
  'travel_route.request_manual_review': '人工确认',
  'travel_route.book': '立即预定',
  'travel_route.book_now': '预定旅居',
  'travel_route.view': '查看路线',
  'health_risk_warning.refresh_signals': '重新读取信号',
  'health_risk_warning.view_rule_detail': '查看规则命中',
  'health_risk_warning.request_manual_review': '请求人工复核',
  'health_risk_warning.fill_elder_info': '补充老人信息',
  'health_risk_warning.fill_remote_info': '补充远程体检',
  'health_risk_warning.view_warning': '查看预警',
  'health_risk_warning.view_report': '查看总评',
  'health_risk_warning.view_advice': '查看调理建议',
  'health_risk_warning.view_assessment': '综合风险评估',
  'health_risk_warning.view_constitution': '体质详情',
  'health_risk_warning.view_tongue': '舌诊详情',
  'health_risk_warning.view_face': '面诊详情',
  'health_risk_warning.view_syndrome': '证候详情',
  'health_risk_warning.view_risk_level': '风险等级标准',
  'health_risk_warning.view_help': '使用帮助',
  'health_risk_warning.select_elder': '确认老人档案',
  'find_service.recommend': '智能推荐',
  'find_service.catalog': '全部服务',
  'find_service.list_workers': '找护理人员',
  'find_service.list_orgs': '看养老机构',
  'find_service.detail_service': '查看服务详情',
  'find_service.detail_order': '查看服务订单',
  'find_service.trace': '服务追溯',
  'find_service.review': '服务口碑',
  'dispatch_manage.list': '派单列表',
  'dispatch_manage.work_order': '查看工单',
  'dispatch_manage.status': '查看进度',
  'dispatch_manage.accept': '确认接单',
  'dispatch_manage.reject': '拒单',
  'dispatch_manage.transfer': '改派',
  'dispatch_manage.supplier': '供应商处理',
  'dispatch_manage.detail': '派单详情',
  'nearby_resource.all': '全部资源',
  'nearby_resource.medical': '只看医疗',
  'nearby_resource.food': '周边餐馆',
  'nearby_resource.leisure': '好玩的地方',
  'nearby_resource.navigate': '导航',
  'nearby_resource.favorite': '收藏',
  'nearby_resource.unfavorite': '取消收藏',
  'sos.call_120': '立即拨打120',
  'sos.notify_family': '通知家属',
};

export function isRawActionKeyText(value = '') {
  const text = String(value || '').trim();
  if (!text) return false;
  return /^[a-z][a-z0-9_]*\.[a-z0-9_.-]+$/i.test(text);
}

export function labelForActionKey(actionKey = '', fallback = '') {
  const key = String(actionKey || '').trim();
  const mapped = ACTION_LABELS_ZH[key];
  if (mapped) return mapped;
  if (fallback && !isRawActionKeyText(fallback)) return String(fallback).trim();
  if (!isRawActionKeyText(key)) return '';
  return inferLabelFromActionKey(key);
}

export function normalizeActionDisplayItem(item = {}) {
  if (!item || typeof item !== 'object') return item;
  const rawActionKey = item.action_key ?? item.actionKey ?? item.key ?? '';
  const actionKey = typeof rawActionKey === 'string' ? rawActionKey.trim() : '';
  const visibleLabel = firstVisible(item.label, item.text, item.title, item.name);
  const label = labelForActionKey(actionKey, visibleLabel);
  const promptText = firstVisible(item.user_prompt, item.prompt);
  const userPrompt = promptText && !isRawActionKeyText(promptText) ? promptText : label;
  return {
    ...item,
    ...(actionKey ? { action_key: actionKey } : {}),
    label,
    ...(item.user_prompt !== undefined || item.prompt !== undefined || actionKey ? { user_prompt: userPrompt } : {}),
  };
}

function firstVisible(...values) {
  for (const value of values) {
    const text = normalizeVisibleText(value);
    if (text) return text;
  }
  return '';
}

function normalizeVisibleText(value = '') {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#x[aA]0;/g, ' ')
    .trim();
}

function inferLabelFromActionKey(actionKey = '') {
  const suffix = String(actionKey || '').split('.').filter(Boolean).pop() || '';
  if (!suffix) return '继续处理';
  if (/adjust|condition|chronic/i.test(suffix)) return '按健康状况调整';
  if (/weekly|generate.*plan|plan/i.test(suffix)) return '生成计划';
  if (/daily|diet|meal/i.test(suffix)) return '查看饮食建议';
  if (/risk|warning/i.test(suffix)) return '查看风险提示';
  if (/refresh|reload/i.test(suffix)) return '重新读取';
  if (/detail|view|explain/i.test(suffix)) return '查看详情';
  if (/list|catalog|all/i.test(suffix)) return '查看列表';
  if (/status|progress/i.test(suffix)) return '查看进度';
  if (/recommend/i.test(suffix)) return '智能推荐';
  if (/compare/i.test(suffix)) return '对比查看';
  if (/availability|available/i.test(suffix)) return '查可订状态';
  if (/budget|price|cost/i.test(suffix)) return '测算预算';
  if (/navigate|map/i.test(suffix)) return '导航';
  if (/book|order/i.test(suffix)) return '预定/下单';
  if (/manual|review/i.test(suffix)) return '人工确认';
  return '继续处理';
}
