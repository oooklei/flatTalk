// 模板路由总分发：fillTemplateSlots 作为唯一入口，根据 selectedTemplateId
// 将请求路由到对应业务子模块的 fill 函数。所有模板ID → fill 分支的映射
// 集中在此文件，便于维护和排查。
//
// 路由覆盖表（旅居路线 + 周边资源）：
// 旅居路线 travel_route（16模板）：
//   route_svg / route_wellness / route_coastal / route_culture / route_ecology → fillRouteCardLegacy
//   sojourn_base → fillSojournBase
//   travel_availability_card → fillTravelAvailabilityCard
//   travel_h5_embed_card → fillTravelH5EmbedCard
//   travel_transport_card → fillTravelTransportCard（extra-template-fills）
//   travel_need_summary_card → fillTravelNeedSummaryCard（extra-template-fills）
//   travel_plan_summary_card → fillTravelPlanSummaryCard（extra-template-fills）
//   travel_budget_card → fillTravelBudgetCard（extra-template-fills）
//   travel_itinerary_card → fillTravelItineraryCard
//   travel_weather_risk_card → fillTravelWeatherRiskCard
//   travel_spot_card → fillTravelSpotCard
//   travel_medical_card → fillTravelMedicalCard
//   sojourn_route → 已废弃，重定向到 route_svg
//
// 周边资源 find_service（17模板）：
//   service_emergency → fillServiceEmergencyCard
//   service_recommend / service_detail / service_catalog / org_profile / worker_profile
//     / order_preview / order_status → fillFindServiceCard
//   service_order_form / service_order_ticket / service_expand / service_guess_like
//     / service_trace / service_review → fillFindServiceExtra（extra-template-fills）
//   service_card / service_intent / service_thinking → fillServiceTransitionalCard
//     （原先走 no_local_fill 兜底，已补齐本地填槽）
//
// 经验：每个新增模板ID必须在此表中登记对应 fill 分支，否则走 no_local_fill 纯文本兜底。

import { sanitizeModelResult, extractElderName } from './utils.js';
import {
  fillWeeklyPlan,
  fillDietCard,
  fillMealTimelineCard,
  fillMealOverviewCard,
} from './meal-cards.js';
import { fillHealthWarningCard } from './health-cards.js';
import {
  fillPolicyCard,
  fillPolicyListCard,
  fillPolicyApplyGuideCard,
  fillPolicyDetailCard,
} from './policy-cards.js';
import { fillNearbyResourceCard } from './nearby-cards.js';
import {
  fillServiceTransitionalCard,
  fillServiceEmergencyCard,
  fillFindServiceCard,
  fillServiceQualityEvalCard,
} from './service-cards.js';
import { fillDispatchManageCard } from './dispatch-cards.js';
import {
  fillRouteCardLegacy,
  fillSojournBase,
  fillTravelAvailabilityCard,
  fillTravelItineraryCard,
  fillTravelSpotCard,
  fillTravelMedicalCard,
  fillTravelH5EmbedCard,
  fillTravelWeatherRiskCard,
} from './travel-cards.js';
import {
  fillTravelTransportCard,
  fillTravelNeedSummaryCard,
  fillTravelPlanSummaryCard,
  fillTravelBudgetCard,
  fillElderDuplicateConfirmCard,
  fillHealthDrilldownCard,
  fillMealDashboardCard,
  fillFindServiceExtra,
  fillDispatchExtra,
} from '../model-runtime/extra-template-fills.js';
import { findEldersByName, mockElders, isMockEldersAllowed } from '../../services/interface-data/mock-collaboration.js';

export async function fillTemplateSlots({
  message = '',
  template_id = '',
  default_template_id = '',
  template_library = [],
  business_data = {},
  intent_context = {},
  knowledgeService = null,
  weatherService = null,
} = {}) {
  let selectedTemplateId = selectTemplateId({
    message,
    template_id,
    default_template_id,
    template_library,
    intent_context,
  });

  // 旧模板已废弃：残留请求一律升级到新模板
  if (selectedTemplateId === 'route_card') selectedTemplateId = 'route_svg';
  if (selectedTemplateId === 'sojourn_route') selectedTemplateId = 'route_svg';
  if (selectedTemplateId === 'travel_base_card') selectedTemplateId = 'sojourn_base';
  // 产品模板（康养/滨海/文化/生态）统一走 route_svg 数据填充链路
  if (['route_wellness', 'route_coastal', 'route_culture', 'route_ecology'].includes(selectedTemplateId)) {
    // 保持 selectedTemplateId 不变，fillRouteCardLegacy 内部会通过 selectProductTemplate 推断产品类型
  }

  if (selectedTemplateId === 'weekly_plan') {
    return fillWeeklyPlan({ message, business_data });
  }
  if (selectedTemplateId === 'diet_card') {
    return fillDietCard({ message, business_data });
  }
  if (selectedTemplateId === 'route_svg' || ['route_wellness', 'route_coastal', 'route_culture', 'route_ecology'].includes(selectedTemplateId)) {
    return await fillRouteCardLegacy({ message, business_data, selectedTemplateId });
  }
  if (selectedTemplateId === 'sojourn_base') {
    return fillSojournBase({ message, business_data });
  }
  if (selectedTemplateId === 'travel_availability_card') {
    return fillTravelAvailabilityCard({ message, business_data });
  }
  if (selectedTemplateId === 'travel_h5_embed_card') {
    return fillTravelH5EmbedCard({ message, business_data });
  }
  if (selectedTemplateId === 'travel_transport_card') {
    return sanitizeModelResult(fillTravelTransportCard({ message, business_data }));
  }
  if (selectedTemplateId === 'travel_need_summary_card') {
    return sanitizeModelResult(fillTravelNeedSummaryCard({ message, business_data }));
  }
  if (selectedTemplateId === 'travel_plan_summary_card') {
    return sanitizeModelResult(fillTravelPlanSummaryCard({ message, business_data }));
  }
  if (selectedTemplateId === 'travel_budget_card') {
    return sanitizeModelResult(fillTravelBudgetCard({ message, business_data }));
  }
  if (selectedTemplateId.startsWith('nearby_')) {
    // 把已选定的模板传下去：selectedTemplateId 可能来自 LIS 下发的 template_id，
    // 而 fillNearbyResourceCard 内部的 nbDecide 是一套独立关键词决策，
    // 不传会导致 LIS 的细分卡被覆写（实测「周边有药店吗」
    // 命中 nearby_resource.medical 却出 nearby_map_category）。
    return fillNearbyResourceCard({
      message, business_data, intent_context, template_id: selectedTemplateId,
    });
  }
  if (selectedTemplateId === 'travel_itinerary_card') {
    return fillTravelItineraryCard({ message, business_data });
  }
  if (selectedTemplateId === 'elder_duplicate_confirm_card') {
    const name = business_data?.elder_name || extractElderName(message) || '';
    let candidates = Array.isArray(business_data?.elder_candidates)
      ? business_data.elder_candidates
      : (name ? findEldersByName(name) : []);
    // 补充老人信息且未指定姓名：仅演示环境列出 mock 档案
    if (!candidates.length && isMockEldersAllowed()) candidates = [...mockElders];
    return sanitizeModelResult(fillElderDuplicateConfirmCard({
      name: name || '请选择老人',
      candidates,
    }));
  }
  if ([
    'constitution_card', 'tongue_diagnosis_card', 'face_observation_card', 'tcm_syndrome_card',
    'care_advice_card', 'risk_level_card', 'help_card', 'risk_assessment_card',
  ].includes(selectedTemplateId)) {
    const drilled = fillHealthDrilldownCard({ selectedTemplateId, business_data, message });
    if (drilled) return sanitizeModelResult(drilled);
  }
  if (selectedTemplateId === 'health_warning_card'
   || selectedTemplateId === 'health_risk_signal_card'
   || selectedTemplateId === 'health_risk_rule_card'
   || selectedTemplateId === 'health_report_card'
   || selectedTemplateId === 'risk_warning_card'
   || selectedTemplateId === 'dietary_regimen_card') {
    return fillHealthWarningCard({ message, business_data, selectedTemplateId });
  }
  if (selectedTemplateId === 'policy_card') {
    return fillPolicyCard({ message, knowledgeService });
  }
  if (selectedTemplateId === 'policy_list_card') {
    return fillPolicyListCard({ message, knowledgeService });
  }
  if (selectedTemplateId === 'policy_apply_guide_card') {
    return fillPolicyApplyGuideCard({ message });
  }
  if (selectedTemplateId === 'policy_detail_card') {
    return fillPolicyDetailCard({ message, knowledgeService });
  }

  if (selectedTemplateId === 'travel_weather_risk_card') {
    return fillTravelWeatherRiskCard({ message, business_data, weatherService });
  }

  if (selectedTemplateId === 'service_emergency') {
    return fillServiceEmergencyCard({ message, intent_context });
  }

  if (['service_recommend', 'service_detail', 'service_catalog', 'org_profile', 'worker_profile', 'order_preview', 'order_status', 'service_booking_confirm', 'booking_success', 'booking_reschedule', 'contact_confirm'].includes(selectedTemplateId)) {
    return fillFindServiceCard({ message, business_data, selectedTemplateId });
  }
  if (['service_order_form', 'service_order_ticket', 'service_expand', 'service_guess_like', 'service_trace', 'service_review'].includes(selectedTemplateId)) {
    const extra = fillFindServiceExtra({ message, business_data, selectedTemplateId });
    if (extra) return sanitizeModelResult(extra);
  }
  // service_card / service_intent / service_thinking: 过渡态/辅助卡片，补充本地填槽避免走 no_local_fill 纯文本
  if (['service_card', 'service_intent', 'service_thinking'].includes(selectedTemplateId)) {
    return fillServiceTransitionalCard({ message, business_data, intent_context, selectedTemplateId });
  }
  if (['dispatch_list', 'dispatch_detail', 'work_order', 'dispatch_status'].includes(selectedTemplateId)) {
    return fillDispatchManageCard({ message, business_data, selectedTemplateId });
  }
  if (['dispatch_accept', 'dispatch_reject', 'dispatch_transfer', 'dispatch_supplier_action'].includes(selectedTemplateId)) {
    const extra = fillDispatchExtra({ message, business_data, selectedTemplateId });
    if (extra) return sanitizeModelResult(extra);
  }
  if ([
    'institution_quality_report',
    'staff_quality_report',
    'org_quality_ranking',
    'staff_quality_ranking',
    'rectification_suggestion',
    'complaint_detail',
    'evaluation_standard',
  ].includes(selectedTemplateId)) {
    return fillServiceQualityEvalCard({ message, business_data, selectedTemplateId });
  }

  if (selectedTemplateId === 'meal_timeline_card') {
    return fillMealTimelineCard({ message, business_data });
  }
  if (selectedTemplateId === 'meal_overview_card') {
    return fillMealOverviewCard({ message, business_data });
  }
  if (selectedTemplateId === 'meal_dashboard_card') {
    return sanitizeModelResult(fillMealDashboardCard({ message, business_data }));
  }
  if (selectedTemplateId === 'travel_spot_card') {
    return fillTravelSpotCard({ message, business_data });
  }
  if (selectedTemplateId === 'travel_medical_card') {
    return fillTravelMedicalCard({ message, business_data });
  }

  // 未实现本地填槽：返回可识别标记，供 LLM 层放开；无 LLM 时再兜底抱歉
  return sanitizeModelResult({
    template_id: selectedTemplateId || 'answer',
    answer_text: '',
    answer: '',
    data: {},
    actions: [],
    followup_suggestions: [],
    template_fit_notes: ['no_local_fill'],
    model_status: 'no_local_fill',
  });
}

function selectTemplateId({ message, template_id, default_template_id, template_library, intent_context = {} }) {
  // 旧模板彻底废弃：残留 ID 一律映射到 sojourn_*
  if (template_id && template_id !== 'answer') {
    if (template_id === 'route_card' || template_id === 'sojourn_route') return 'route_svg';
    if (template_id === 'travel_base_card') return 'sojourn_base';
    return template_id;
  }
  // template_id='answer' 时不再强制改写为 health_card，保留 answer 作为通用兜底
  if (template_id === 'answer' && template_library?.some(t => t.id === 'answer')) return 'answer';
  if (template_id === 'answer') return 'health_card';
  const templates = Array.isArray(template_library) ? template_library : [];
  const ids = templates.map((item) => item.id).filter(Boolean);

  const text = `${message} ${templates.map((item) => item.match || '').join(' ')}`;
  // 优先消费场景路由识别出的周计划意图；并兜底识别"周一…周日"等结构化一周表述
  const isWeekly = intent_context?.intent === 'meal_plan_weekly_plan'
    || isWeeklyPlanText(message)
    || isStructuredWeekText(message);
  if (ids.includes('weekly_plan') && isWeekly) return 'weekly_plan';

  // 政策类模板智能选择
  const policyTemplate = selectPolicyTemplate(message, ids, intent_context);
  if (policyTemplate) return policyTemplate;

  if (ids.includes('diet_card') && isMealPlanText(text)) return 'diet_card';
  if (ids.includes('sojourn_route') && isTravelRouteText(text)) return 'sojourn_route';
  if (ids.some((id) => id.startsWith('nearby_')) && isNearbyResourceText(text, intent_context)) return 'nearby_map_overview';
  if (ids.some((id) => id.startsWith('service_')) && isFindServiceText(text)) return pickFindServiceTemplate(text, ids);
  if (ids.some((id) => id.startsWith('dispatch_')) && isDispatchManageText(text)) return pickDispatchManageTemplate(text, ids);
  if (ids.includes('health_warning_card') && isHealthRiskText(text)) return 'health_warning_card';
  if (default_template_id && ids.includes(default_template_id)) return default_template_id;
  return ids[0] || default_template_id || 'answer';
}

/**
 * 根据用户意图选择合适的政策模板
 */
function selectPolicyTemplate(message, availableIds, intent_context) {
  if (!availableIds.some(id => id.startsWith('policy'))) return null;

  const text = String(message || '');
  const intent = intent_context?.intent || '';

  // 申请流程类 -> policy_apply_guide_card
  // 匹配：办理流程、申请流程、去哪办、需要什么材料、整理办理材料
  const isApplyIntent = intent === 'elder_policy_apply'
    || /怎么申请|如何申请|怎么办理|办理流程|申请流程|去哪办|哪里办理|需要什么材料|要哪些材料|申请条件|办理条件|整理办理材料/.test(text);
  if (isApplyIntent && availableIds.includes('policy_apply_guide_card')) {
    return 'policy_apply_guide_card';
  }

  // 政策详情类 -> policy_detail_card
  // 匹配：详细内容、政策解读、全文、原文
  const isDetailIntent = intent === 'elder_policy_detail'
    || /详细内容|具体内容|政策解读|全文|原文|详细解读|是什么意思|怎么理解|主要内容|要点/.test(text);
  if (isDetailIntent && availableIds.includes('policy_detail_card')) {
    return 'policy_detail_card';
  }

  // 补贴类查询 -> policy_list_card
  // 匹配：补贴条件、补贴政策、查询补贴、有什么补贴
  const isBenefitIntent = intent === 'elder_policy_benefit'
    || /补贴|津贴|长护险|养老金|养老保险/.test(text);
  if (isBenefitIntent && availableIds.includes('policy_list_card')) {
    return 'policy_list_card';
  }

  // 默认兜底：如果有 policy_card 才返回，否则返回 null 让上层用 answer
  if (availableIds.includes('policy_card') && isPolicyConsultText(text)) return 'policy_card';

  return null;
}

function isPolicyConsultText(text) {
  return /养老政策|政策|补贴|高龄津贴|长护险|长期护理保险|护理补贴|养老保险|养老金|社区居家养老|居家养老|养老服务|助餐补贴|适老化改造|失能评估|能力评估|民政|人社/.test(String(text || ''));
}

function isMealPlanText(text) {
  return /meal|diet|breakfast|lunch|dinner|膳食|饮食|餐|早餐|午餐|晚餐|糖尿病|高血压|控糖|低盐|营养/.test(String(text || ''));
}

function isWeeklyPlanText(text) {
  const value = String(text || '');
  return /(?:\u4e00\u5468|\u4e03\u5929|\u5468\u8ba1\u5212|weekly|week|7\s*day|seven\s*day)/i.test(value);
}

// 识别"周一…周二…周三"或"周一到周日"这类结构化一周表述（用户粘贴结构化数据时往往没有"一周"二字）
function isStructuredWeekText(text) {
  const value = String(text || '');
  const dayMarks = value.match(/周[一二三四五六日天]/g) || [];
  if (dayMarks.length >= 2) return true;
  if (/(周[一二三四五六日天]|星期[一二三四五六日天])\s*[到至\-]\s*(周[一二三四五六日天]|星期[一二三四五六日天])/.test(value)) return true;
  return false;
}

function isPolicyText(text) {
  return /养老政策|政策|补贴|津贴|长护险|长期护理保险|护理补贴|养老保险|养老金|居家养老|社区养老|养老服务|养老院|助餐|适老化|失能评估|能力评估|民政|人社|养老助手|桂小养|怎么用|能做什么|可以做什么|使用方法/.test(String(text || ''));
}

function isHealthRiskText(text) {
  return /健康风险|风险预警|健康预警|预警|风险研判|报警|异常信号|血压高|血压偏高|高血压|血糖高|血糖异常|低血糖|心率异常|跌倒|跌倒风险|居家安全|夜间离床|呼吸异常|血氧异常|风险等级|设备信号|信号/.test(String(text || ''));
}

function isTravelRouteText(text) {
  return /travel|route|trip|tour|旅居|旅游|康养|路线|线路|行程|目的地|基地|广西|巴马|北海|桂林|预订|预算|交通/.test(String(text || ''));
}

function isNearbyResourceText(text, intent_context = {}) {
  if (intent_context?.scene_key === 'nearby_resource') return true;
  if (intent_context?.intent?.startsWith('nearby_resource.')) return true;
  return /嘉路|康养中心|周边|附近|15公里|地图|民宿|景区|海鲜|垂钓|康养|医疗|餐馆|餐厅|游玩|景点|配套|资源|生活圈|分布|大屏|在哪|map|nearby|around/.test(String(text || ''));
}

function isFindServiceText(text) {
  return /find_service|service|养老|护工|养老院|机构|上门|陪诊|助浴|助餐|康复|认知症|找服务|服务订单|预约服务|建单|下单/.test(String(text || ''));
}

function isDispatchManageText(text) {
  return /dispatch|派单|工单|接单|拒单|调度|派工|抢单|改派|服务进度|订单进度|催单/.test(String(text || ''));
}

function pickFindServiceTemplate(message, ids) {
  const t = String(message || '');
  if (ids.includes('worker_profile') && /护工|人员|护理员|是谁|推荐人/.test(t)) return 'worker_profile';
  if (ids.includes('org_profile') && /机构|养老院|护理站|中心|在哪里|哪家|入住/.test(t)) return 'org_profile';
  if (ids.includes('order_preview') && /预约|下单|建单|提交订单|安排上门|我要订/.test(t)) return 'order_preview';
  if (ids.includes('order_status') && /我的订单|订单状态|订单进度/.test(t)) return 'order_status';
  if (ids.includes('service_catalog') && /目录|有哪些服务|全部服务|分类|都提供/.test(t)) return 'service_catalog';
  if (ids.includes('service_recommend')) return 'service_recommend';
  return ids.find((id) => id.startsWith('service_')) || 'service_recommend';
}

function pickDispatchManageTemplate(message, ids) {
  const t = String(message || '');
  if (ids.includes('dispatch_detail') && /接单|拒单|改派|这条派单|派单详情|处理派单/.test(t)) return 'dispatch_detail';
  if (ids.includes('work_order') && /工单|工单详情|服务工单/.test(t)) return 'work_order';
  if (ids.includes('dispatch_status') && /进度|状态|催单|改约|更新/.test(t)) return 'dispatch_status';
  if (ids.includes('dispatch_list')) return 'dispatch_list';
  return ids.find((id) => id.startsWith('dispatch_')) || 'dispatch_list';
}
