import fs from 'node:fs';
import path from 'node:path';
import { createYz365Service } from '../services/yz365/index.js';
import { createShezhenService } from '../services/shezhen/shezhen-service.js';
import { buildRouteMapData as buildRouteMapDataFromKit, buildBaseMapData as buildBaseMapDataFromKit, findPrebuiltPackageByDestination, findPrebuiltPackage } from './map/map-kit.js';
import { matchPublishedPackages } from './scene-router/publish-index.js';
import { generateRouteHtml } from './route-svg-generator.js';
import { selectProductTemplate, isSampleCompatibleWithDestination } from './route-svg-generator.js';
import {
  fillTravelTransportCard,
  fillTravelNeedSummaryCard,
  fillTravelPlanSummaryCard,
  fillFindServiceExtra,
  fillDispatchExtra,
  fillMealDashboardCard,
  fillHealthDrilldownCard,
  fillElderDuplicateConfirmCard,
  LOCAL_FILL_TEMPLATE_IDS,
} from './model-runtime/extra-template-fills.js';
import { findEldersByName, mockElders } from '../services/interface-data/mock-collaboration.js';
import { enrichWaypointsFromDashboardKb } from '../skills/travel_route/dashboard-spot-kb.js';
import crypto from 'node:crypto';

export { LOCAL_FILL_TEMPLATE_IDS };

const HTML_TAG_PATTERN = /<[^>]*>/g;
const EVENT_HANDLER_PATTERN = /\bon[a-z]+\s*=/gi;
const SCRIPT_PROTOCOL_PATTERN = /javascript\s*:/gi;

// 云诊365服务实例（延迟初始化）
let yz365Service = null;
function getYz365Service() {
  if (!yz365Service) {
    yz365Service = createYz365Service();
  }
  return yz365Service;
}

// 云诊舌诊服务实例（延迟初始化）
let shezhenService = null;
function getShezhenService() {
  if (!shezhenService) {
    shezhenService = createShezhenService();
  }
  return shezhenService;
}

// ════════════════════════════════════════════════════════════════
// 模板路由覆盖表（旅居路线 + 周边资源）
// ────────────────────────────────────────────────────────────────
// 旅居路线 travel_route（16模板）：
//   route_svg / route_wellness / route_coastal / route_culture / route_ecology → fillRouteCardLegacy
//   sojourn_base → fillSojournBase
//   travel_availability_card → fillTravelAvailabilityCard
//   travel_h5_embed_card → fillTravelH5EmbedCard
//   travel_transport_card → fillTravelTransportCard（extra-template-fills）
//   travel_need_summary_card → fillTravelNeedSummaryCard（extra-template-fills）
//   travel_plan_summary_card → fillTravelPlanSummaryCard（extra-template-fills）
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
// ════════════════════════════════════════════════════════════════
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
    return fillRouteCardLegacy({ message, business_data, selectedTemplateId });
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
  if (selectedTemplateId.startsWith('nearby_')) {
    return fillNearbyResourceCard({ message, business_data, intent_context });
  }
  if (selectedTemplateId === 'travel_itinerary_card') {
    return fillTravelItineraryCard({ message, business_data });
  }
  if (selectedTemplateId === 'elder_duplicate_confirm_card') {
    const name = business_data?.elder_name || extractElderName(message) || '';
    let candidates = Array.isArray(business_data?.elder_candidates)
      ? business_data.elder_candidates
      : (name ? findEldersByName(name) : []);
    // 补充老人信息且未指定姓名：列出全部档案供选择（真实选择流）
    if (!candidates.length) candidates = [...mockElders];
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

  if (['service_recommend', 'service_detail', 'service_catalog', 'org_profile', 'worker_profile', 'order_preview', 'order_status'].includes(selectedTemplateId)) {
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

function buildHealthWarningData({ message, business_data, selectedTemplateId, elderName: providedElderName, elderAge: providedElderAge }) {
  // ★ 身份来自 business_data（登录用户），不再回退到 '未知老人'
  const elderName = providedElderName
    || (business_data && business_data.elder_name)
    || (business_data && business_data.elderName)
    || '';
  const elderAge = providedElderAge
    || (business_data && business_data.elder_age)
    || (business_data && business_data.elderAge)
    || '';

  // ★ 无远程数据时的空态展示（不生成 mock 信号值）
  const assessTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const isSignalCard = selectedTemplateId === 'health_risk_signal_card';
  const isRuleCard = selectedTemplateId === 'health_risk_rule_card';

  return {
    badge: isSignalCard ? '设备信号' : isRuleCard ? '风险规则' : '健康风险预警',
    elderName, elderAge, assessTime,
    level: '暂无数据',
    levelColor: '#9CA3AF',
    levelIcon: '⚠',
    summary: `当前未获取到${elderName || '该老人'}的远程设备信号与体检报告数据（云诊365/舌诊暂无记录）。建议确认设备已绑定且体检数据已上传后再进行评估。`,
    signals_count: 0,
    signals: [],
    rules_count: 0,
    rules: [],
    actions_count: 0,
    recommendedActions: [],
    nextSteps: '请确认：1) 云诊365设备已绑定该老人；2) 舌诊报告已上传；3) 网络连接正常。绑定后点击"重新读取设备信号"。',
    remoteGap: '云诊365/舌诊远程数据暂不可用。如已绑定设备，请稍后重试或联系管理员检查数据接口。',
    sourceLabel: '暂无数据源（等待设备绑定）',
    noRemoteData: true,
  };
}

async function fillHealthWarningCard({ message, business_data, selectedTemplateId = 'health_warning_card', yz365Service } = {}) {
  // ★ 身份数据优先级：business_data（来自登录用户） → 消息提取 → 空
  //   不再使用 '未知老人' 等默认值，避免展示无主数据
  const extractedName = extractElderName(message) || '';
  const elderName = business_data?.elder_name || business_data?.elderName || extractedName || '';
  const elderAge = business_data?.elder_age || business_data?.elderAge || '';
  const elderId = business_data?.elder_id || '';

  // 同名确认：消息中点名且匹配到多份档案时，先出确认卡
  if (!elderId && extractedName) {
    const candidates = Array.isArray(business_data?.elder_candidates) && business_data.elder_candidates.length
      ? business_data.elder_candidates
      : findEldersByName(extractedName);
    if (candidates.length > 1) {
      return sanitizeModelResult(fillElderDuplicateConfirmCard({ name: extractedName, candidates }));
    }
    if (candidates.length === 1 && !business_data?.elder_id) {
      business_data = {
        ...business_data,
        elder_id: candidates[0].elder_id,
        elder_name: candidates[0].elder_name,
        elder_age: candidates[0].age,
      };
    }
  }
  let yzData = null;
  let hasYzData = false;
  let shezhenData = null;
  let hasShezhenData = false;

  try {
    const service = yz365Service || getYz365Service();
    const yzResult = await service.getElderHealthCheck(elderName || elderId || undefined);

    if (yzResult.ok && yzResult.total > 0) {
      hasYzData = true;
      yzData = service.buildHealthRiskData(yzResult, elderName);
    }
  } catch (error) {
    console.error('[YZ365] 云诊服务调用失败:', error.message);
  }

  // 云诊舌诊（与云诊365并列的远程数据来源）
  try {
    const szService = shezhenService || getShezhenService();
    const szResult = await szService.getElderReports({});
    if (szResult.ok && szResult.total > 0) {
      hasShezhenData = true;
      shezhenData = szService.buildHealthRiskData(szResult, elderName);
    }
  } catch (error) {
    console.error('[SHEZHEN] 云诊舌诊服务调用失败:', error.message);
  }

  // 命中任一远程数据源，合并构建卡片
  if ((hasYzData && yzData?.hasData) || (hasShezhenData && shezhenData?.hasData)) {
    const data = buildHealthWarningDataFromRemote({ yzData, shezhenData, selectedTemplateId, elderName });
    // ★ 用 business_data 中的身份覆盖（确保使用登录用户身份，而非 API 返回的他人数据）
    if (elderName) data.elderName = elderName;
    if (elderAge) data.elderAge = elderAge;
    const sources = [
      hasYzData && yzData?.hasData ? '云诊365体检报告' : null,
      hasShezhenData && shezhenData?.hasData ? '云诊舌诊报告' : null,
    ].filter(Boolean).join(' + ');
    const answerText = `已为${data.elderName}完成健康风险研判（基于${sources}），风险等级：${data.level}。检测时间：${data.checkTime || '近期'}。`;
    return sanitizeModelResult({
      template_id: selectedTemplateId,
      answer_text: answerText,
      answer: answerText,
      data,
      actions: [
        { action_key: 'health_risk_warning.refresh_signals', label: '重新读取设备信号', payload: {} },
        { action_key: 'health_risk_warning.view_rule_detail', label: '查看规则命中详情', payload: {} },
        { action_key: 'health_risk_warning.view_assessment', label: '综合风险评估', params: { template_id: 'risk_assessment_card' } },
        { action_key: 'health_risk_warning.view_advice', label: '查看调理方案', params: { template_id: 'care_advice_card' } },
        { action_key: 'health_risk_warning.request_manual_review', label: '请求人工复核/转接', payload: {} },
        { action_key: 'health_risk_warning.fill_elder_info', label: '补充老人信息', payload: {} },
      ],
      followup_suggestions: [
        { label: '查看体检报告详情', user_prompt: '查看体检报告详情', action_key: 'health_risk_warning.view_report' },
        { label: '查看体质详情', user_prompt: '查看中医体质辨识', action_key: 'health_risk_warning.view_constitution' },
        { label: '查看舌诊详情', user_prompt: '查看舌诊详情', action_key: 'health_risk_warning.view_tongue' },
        { label: '查看调理方案', user_prompt: '查看个性化调理方案', action_key: 'health_risk_warning.view_advice' },
        { label: '转人工复核', user_prompt: '转人工复核', action_key: 'health_risk_warning.request_manual_review' },
      ],
      template_fit_notes: ['yz365_health_risk_warning', 'shezhen_health_risk_warning'],
    });
  }

  // ★ 无远程数据时：若有老人身份，展示"暂无设备信号"空态卡；若无身份，提示需登录
  if (!elderName) {
    const answerText = '请先选择或绑定老人档案，才能查看健康风险预警数据。';
    return sanitizeModelResult({
      template_id: selectedTemplateId,
      answer_text: answerText,
      answer: answerText,
      data: { noElderProfile: true, message: '请先选择老人档案' },
      actions: [
        { action_key: 'health_risk_warning.fill_elder_info', label: '选择/绑定老人档案', payload: {} },
      ],
      followup_suggestions: [
        { label: '如何绑定老人档案？', user_prompt: '如何绑定老人档案？' },
      ],
      template_fit_notes: ['no_elder_profile'],
    });
  }

  const data = buildHealthWarningData({ message, business_data, selectedTemplateId, elderName, elderAge });
  const answerText = `当前未获取到${elderName}的远程设备信号与体检报告数据（云诊365/舌诊暂无记录），暂时无法进行健康风险评估，建议确认设备已绑定且体检数据已上传后再进行评估。`;
  return sanitizeModelResult({
    template_id: selectedTemplateId,
    answer_text: answerText,
    answer: answerText,
    data: { ...data, yz365Gap: true },
    actions: [
      { action_key: 'health_risk_warning.refresh_signals', label: '重新读取设备信号', payload: {} },
      { action_key: 'health_risk_warning.view_rule_detail', label: '查看规则命中详情', payload: {} },
      { action_key: 'health_risk_warning.request_manual_review', label: '请求人工复核/转接', payload: {} },
      { action_key: 'health_risk_warning.fill_elder_info', label: '补充老人信息', payload: {} },
    ],
    followup_suggestions: [
      { label: '如何上传云诊体检报告？', user_prompt: '如何上传云诊体检报告？' },
      { label: '体检报告需要包含哪些指标？', user_prompt: '体检报告需要包含哪些指标？' },
      { label: '健康风险评估包含哪些内容？', user_prompt: '健康风险评估包含哪些内容？' },
      { label: '如何查看老人健康档案？', user_prompt: '如何查看老人健康档案？' },
    ],
    template_fit_notes: ['fallback_health_risk_warning'],
  });
}

function extractElderName(message) {
  const text = String(message || '');
  // 1) 常见称谓：周舟老人、张奶奶、李爷爷等
  const match = text.match(/([^\s,，。！？、]+?)(老人|奶奶|爷爷|伯伯|婆婆|公公|长辈)/);
  if (match) return match[1];
  // 2) 直接点名已知档案姓名（用于同名确认真实流）
  const known = [...mockElders]
    .map((e) => e.elder_name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const name of known) {
    if (text.includes(name)) return name;
  }
  return null;
}

function buildHealthWarningDataFromYz365(yzData, selectedTemplateId) {
  const levelColorMap = {
    '一般': '#68b032',
    '关注': '#e8a020',
    '紧急': '#e54d42',
  };
  const levelIconMap = {
    '一般': '✓',
    '关注': '⚠',
    '紧急': '⚡',
  };

  const isSignalCard = selectedTemplateId === 'health_risk_signal_card';
  const isRuleCard = selectedTemplateId === 'health_risk_rule_card';

  const signals = [];
  if (yzData.healthIndex) {
    signals.push({
      type: '健康指数',
      value: String(yzData.healthIndex),
      status: yzData.level === '一般' ? 'normal' : 'abnormal',
      status_label: yzData.level === '一般' ? '正常' : '异常',
      source: '云诊365',
    });
  }
  for (const constitution of (yzData.constitutionNames || [])) {
    signals.push({
      type: '体质',
      value: constitution,
      status: 'normal',
      status_label: '正常',
      source: '云诊365',
    });
  }
  if (yzData.symptomName) {
    signals.push({
      type: '症状',
      value: yzData.symptomName,
      status: 'abnormal',
      status_label: '异常',
      source: '云诊365',
    });
  }

  const rules = (yzData.matchedRules || []).map(rule => ({
    ruleName: rule.diseaseName || rule.riskName || '未知风险',
    riskLevel: rule.warningLevel || '一般',
    ruleLevelStatus: rule.warningLevel === '紧急' ? 'abnormal' : 'normal',
    condition: rule.tip || '',
  }));

  return {
    badge: isSignalCard ? '设备信号' : isRuleCard ? '风险规则' : '健康风险预警',
    elderName: yzData.elderName || '未知',
    elderAge: yzData.elderAge || '未知',
    elderSex: yzData.elderSex || '未知',
    checkTime: yzData.checkTime || '未知',
    healthIndex: yzData.healthIndex,
    assessTime: new Date().toISOString().slice(0, 16).replace('T', ' '),
    level: yzData.level || '一般',
    levelColor: levelColorMap[yzData.level] || '#68b032',
    levelIcon: levelIconMap[yzData.level] || '✓',
    summary: yzData.summary || `综合预警等级：${yzData.level || '一般'}；健康指数：${yzData.healthIndex || '暂无'}`,
    signals_count: signals.length,
    signals,
    rules_count: rules.length,
    rules,
    actions_count: 3,
    recommendedActions: [
      { action: '根据体检结果调整生活习惯', owner: '家属/护理员', priority: '高', priorityStatus: 'high' },
      { action: '定期复查异常指标', owner: '家属/护理员', priority: '高', priorityStatus: 'high' },
      { action: '保持健康饮食和适量运动', owner: '老人/护理员', priority: '中', priorityStatus: 'mid' },
    ],
    nextSteps: '建议根据体检结果调整日常照护方案；如有异常指标请及时就医。',
    sourceLabel: '云诊365体检报告',
    pdfUrl: yzData.pdfUrl,
  };
}

function buildShezhenCardParts(shezhenData, selectedTemplateId) {
  const signals = [];
  if (shezhenData.healthIndex) {
    signals.push({
      type: '健康指数',
      value: String(shezhenData.healthIndex),
      status: shezhenData.level === '一般' ? 'normal' : 'abnormal',
      status_label: shezhenData.level === '一般' ? '正常' : '异常',
      source: '云诊舌诊',
    });
  }
  for (const constitution of (shezhenData.constitutionNames || [])) {
    signals.push({ type: '体质', value: constitution, status: 'normal', status_label: '正常', source: '云诊舌诊' });
  }
  if (shezhenData.summary) {
    signals.push({ type: '舌诊结论', value: shezhenData.summary, status: 'abnormal', status_label: '异常', source: '云诊舌诊' });
  }

  const rules = (shezhenData.matchedRules || []).map((rule) => ({
    ruleName: rule.riskName || rule.diseaseName || '未知风险',
    riskLevel: rule.warningLevel || '一般',
    ruleLevelStatus: rule.warningLevel === '紧急' ? 'abnormal' : 'normal',
    condition: rule.tip || '',
  }));

  return {
    level: shezhenData.level || '一般',
    elderName: shezhenData.elderName,
    elderAge: shezhenData.elderAge,
    elderSex: shezhenData.elderSex,
    checkTime: shezhenData.checkTime,
    healthIndex: shezhenData.healthIndex,
    pdfUrl: shezhenData.pdfUrl,
    signals,
    rules,
  };
}

function buildHealthWarningDataFromRemote({ yzData, shezhenData, selectedTemplateId, elderName }) {
  const levelRank = { '一般': 1, '关注': 2, '紧急': 3 };
  const signals = [];
  const rules = [];
  let level = '一般';
  let meta = null;
  const bump = (l) => { if ((levelRank[l] || 0) > (levelRank[level] || 0)) level = l; };

  if (yzData && yzData.hasData) {
    const yz = buildHealthWarningDataFromYz365(yzData, selectedTemplateId);
    signals.push(...yz.signals);
    rules.push(...yz.rules);
    bump(yz.level);
    meta = yzData;
  }
  if (shezhenData && shezhenData.hasData) {
    const sz = buildShezhenCardParts(shezhenData, selectedTemplateId);
    signals.push(...sz.signals);
    rules.push(...sz.rules);
    bump(sz.level);
    meta = shezhenData;
  }

  const isSignalCard = selectedTemplateId === 'health_risk_signal_card';
  const isRuleCard = selectedTemplateId === 'health_risk_rule_card';
  const levelColorMap = { '一般': '#68b032', '关注': '#e8a020', '紧急': '#e54d42' };
  const levelIconMap = { '一般': '✓', '关注': '⚠', '紧急': '⚡' };
  const sourceLabel = [
    yzData && yzData.hasData ? '云诊365' : null,
    shezhenData && shezhenData.hasData ? '云诊舌诊' : null,
  ].filter(Boolean).join(' + ');

  return {
    badge: isSignalCard ? '设备信号' : isRuleCard ? '风险规则' : '健康风险预警',
    elderName: meta?.elderName || elderName || '未知',
    elderAge: meta?.elderAge || '未知',
    elderSex: meta?.elderSex || '未知',
    checkTime: meta?.checkTime || '未知',
    healthIndex: meta?.healthIndex,
    assessTime: new Date().toISOString().slice(0, 16).replace('T', ' '),
    level,
    levelColor: levelColorMap[level] || '#68b032',
    levelIcon: levelIconMap[level] || '✓',
    summary: `综合预警等级：${level}；数据来源：${sourceLabel}`,
    signals_count: signals.length,
    signals,
    rules_count: rules.length,
    rules,
    actions_count: 3,
    recommendedActions: [
      { action: '根据体检结果调整生活习惯', owner: '家属/护理员', priority: '高', priorityStatus: 'high' },
      { action: '定期复查异常指标', owner: '家属/护理员', priority: '高', priorityStatus: 'high' },
      { action: '保持健康饮食和适量运动', owner: '老人/护理员', priority: '中', priorityStatus: 'mid' },
    ],
    nextSteps: '建议根据体检结果调整日常照护方案；如有异常指标请及时就医。',
    sourceLabel,
    pdfUrl: yzData?.pdfUrl,
  };
}

async function fillPolicyCard({ message, knowledgeService }) {
  const text = String(message || '');
  const isAssistantUsage = /养老助手|桂小养|怎么用|能做什么|可以做什么|使用方法|助手/.test(text);

  // 尝试从知识库查询政策信息
  let policyContent = null;

  if (!isAssistantUsage) {
  try {
    // 提取查询关键词
    const keywords = extractPolicyKeywords(text);
    
    if (knowledgeService?.retriever && keywords.length > 0) {
      const knowledgeResult = await knowledgeService.retriever.retrieve({
        skill_key: 'common',
        query: keywords.join(' '),
        limit: 5,
      });

      if (knowledgeResult?.matches?.length > 0) {
        policyContent = summarizePolicyKnowledge(knowledgeResult.matches, text);
      }
    }
  } catch (error) {
    console.error('[PolicyCard] 知识库查询失败:', error.message);
  }

  // 如果有知识库结果，使用知识库内容
  }

  if (policyContent) {
    return sanitizeModelResult({
      template_id: 'policy_card',
      answer_text: policyContent.summary,
      answer: policyContent.summary,
      data: {
        emoji: '📋',
        title: '养老政策咨询',
        skill_name: '政策知识库',
        answer_text: policyContent.summary,
        answer: policyContent.summary,
        policy_items: policyContent.items,
        foot: '以上信息来自政策知识库，具体标准以当地民政、人社部门最新规定为准。',
        source: '知识库查询',
      },
      actions: [],
      followup_suggestions: [
        { label: '查询补贴条件', user_prompt: '老人有什么补贴，申请条件是什么' },
        { label: '整理办理材料', user_prompt: '办理养老补贴需要准备哪些材料' },
        { label: '查询办理流程', user_prompt: '养老补贴应该去哪里办理，流程是什么' },
      ],
      template_fit_notes: ['knowledge_base_policy'],
    });
  }

  // 没有知识库结果时，使用默认回复
  const answerText = isAssistantUsage
    ? '桂小养养老助手可以帮您查政策、找服务、做膳食建议、规划康养旅居，并根据老人情况继续追问补全信息。'
    : '养老政策通常涉及高龄津贴、长护险、社区居家养老服务、助餐补贴、适老化改造等。请补充所在城市/区县、老人年龄、户籍和失能情况，我可以继续整理申请条件、材料和流程。';

  const policyItems = isAssistantUsage
    ? [
        { icon: '1', label: '查政策', detail: '查询高龄津贴、长护险、护理补贴、助餐补贴、适老化改造等政策口径。' },
        { icon: '2', label: '找服务', detail: '按老人所在区域和需求，整理居家上门、助餐送餐、养老机构、康养旅居等服务方向。' },
        { icon: '3', label: '做建议', detail: '可继续生成控糖低盐膳食、一周计划、办理材料清单和下一步操作建议。' },
      ]
    : [
        { icon: '1', label: '补贴类', detail: '高龄津贴、护理补贴、困难老人补助等，与年龄、户籍、经济状况、能力评估相关。' },
        { icon: '2', label: '服务类', detail: '社区居家养老、助餐送餐、上门护理、适老化改造、养老机构推荐等。' },
        { icon: '3', label: '办理类', detail: '可继续询问申请条件、办理材料、办理地点和流程，我会按当地政策口径整理。' },
      ];

  return sanitizeModelResult({
    template_id: 'policy_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      emoji: isAssistantUsage ? '💬' : '📋',
      title: isAssistantUsage ? '桂小养养老助手' : '养老政策咨询',
      skill_name: isAssistantUsage ? '使用指引' : '政策与服务指引',
      answer_text: answerText,
      answer: answerText,
      policy_items: policyItems,
      foot: '以上为一般性政策整理，具体标准以当地民政、人社部门最新规定为准。',
    },
    actions: [],
    followup_suggestions: [
      { label: '查询补贴条件', user_prompt: '老人有什么补贴，申请条件是什么' },
      { label: '整理办理材料', user_prompt: '办理养老补贴需要准备哪些材料' },
    ],
    template_fit_notes: [],
  });
}

function extractPolicyKeywords(text) {
  const keywords = [];
  const keywordPatterns = [
    { pattern: /高龄津贴|高龄补贴|老人津贴/, keyword: '高龄津贴' },
    { pattern: /长护险|长期护理保险|护理险/, keyword: '长护险' },
    { pattern: /护理补贴|护理费/, keyword: '护理补贴' },
    { pattern: /助餐补贴|助餐|送餐/, keyword: '助餐补贴' },
    { pattern: /适老化改造|居家改造/, keyword: '适老化改造' },
    { pattern: /居家养老|社区养老/, keyword: '居家养老服务' },
    { pattern: /养老机构|养老院|敬老院/, keyword: '养老机构' },
    { pattern: /广西|南宁|桂林|北海|巴马/, keyword: '广西' },
    { pattern: /补贴|政策|申请条件|办理/, keyword: '补贴政策' },
  ];

  for (const { pattern, keyword } of keywordPatterns) {
    if (pattern.test(text) && !keywords.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  // 如果没有匹配到关键词，使用通用关键词
  if (keywords.length === 0) {
    keywords.push('养老政策', '补贴');
  }

  return keywords;
}

function summarizePolicyKnowledge(results, query) {
  if (!results || results.length === 0) return null;

  const items = [];
  const summaries = [];

  for (const result of results.slice(0, 5)) {
    const content = result.content || result.text || result.chunk || '';
    const title = result.title || result.name || '';
    
    if (content) {
      // 提取关键信息作为政策条目
      const lines = content.split('\n').filter(line => line.trim());
      for (const line of lines.slice(0, 3)) {
        if (line.length > 10 && !items.some(i => i.detail === line.trim())) {
          items.push({
            icon: String(items.length + 1),
            label: extractLabel(line) || '政策信息',
            detail: line.trim().slice(0, 100),
          });
        }
      }
    }
  }

  // 生成摘要
  const summary = items.length > 0 
    ? `根据知识库查询，为您整理了${items.length}条相关政策信息。请补充老人具体情况（年龄、户籍、失能状况），我可以提供更精准的申请条件和办理指引。`
    : '养老政策通常涉及高龄津贴、长护险、社区居家养老服务、助餐补贴、适老化改造等。';

  return {
    summary,
    items: items.length > 0 ? items : [
      { icon: '1', label: '补贴类', detail: '高龄津贴、护理补贴、困难老人补助等，与年龄、户籍、经济状况、能力评估相关。' },
      { icon: '2', label: '服务类', detail: '社区居家养老、助餐送餐、上门护理、适老化改造、养老机构推荐等。' },
      { icon: '3', label: '办理类', detail: '可继续询问申请条件、办理材料、办理地点和流程，我会按当地政策口径整理。' },
    ],
  };
}

function extractLabel(text) {
  // 尝试从文本中提取标签
  const labelPatterns = [
    /高龄津贴/,
    /长护险/,
    /护理补贴/,
    /助餐/,
    /适老化/,
    /居家养老/,
    /养老机构/,
  ];

  for (const pattern of labelPatterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return null;
}

function fillWeeklyPlan({ message, business_data }) {
  const condition = inferCondition(message);
  const parsedDays = parseWeekFromText(message);
  const answerText = '\u5df2\u751f\u6210\u4e00\u5468\u4e09\u9910\u8ba1\u5212\u3002';

  // 优先使用用户提供的真实一周数据；未提供时回退示例
  const items = parsedDays.length
    ? normalizeParsedWeek(parsedDays, condition)
    : buildWeeklyPlanItems(condition);

  const compactFollowups = [
    {
      label: '按健康状况调整',
      action_key: 'meal_plan.adjust_for_condition',
      input: {
        type: 'select',
        placeholder: '选择健康状况',
        param_key: 'condition',
        options: [
          { value: 'diabetes', label: '糖尿病/控糖' },
          { value: 'hypertension', label: '高血压' },
          { value: 'low_salt', label: '低盐饮食' },
          { value: 'gout', label: '痛风/高尿酸' },
          { value: 'dyslipidemia', label: '高血脂' },
        ],
      },
    },
  ];

  return sanitizeModelResult({
    template_id: 'weekly_plan',
    answer_text: answerText,
    answer: answerText,
    data: {
      weekly_plan: {
        badge: '\u4e00\u5468\u8ba1\u5212',
        title: condition === 'diabetes' ? '\u4e03\u5929\u63a7\u7cd6\u6e05\u6de1\u81b3\u98df\u8ba1\u5212' : '\u4e03\u5929\u6e05\u6de1\u8425\u517b\u81b3\u98df\u8ba1\u5212',
        summary: condition === 'diabetes'
          ? '\u4e3b\u98df\u5b9a\u91cf\uff0c\u642d\u914d\u4f18\u8d28\u86cb\u767d\u548c\u9ad8\u7ea4\u7ef4\u852c\u83dc\uff0c\u51cf\u5c11\u7cbe\u5236\u7cd6\u548c\u751c\u996e\u3002'
          : '\u6bcf\u5929\u4e09\u9910\u6e05\u6de1\u5c11\u6cb9\uff0c\u642d\u914d\u4e3b\u98df\u3001\u86cb\u767d\u8d28\u548c\u852c\u83dc\uff0c\u517c\u987e\u8f6f\u70c2\u6613\u6d88\u5316\u3002',
        suitable: condition === 'diabetes' ? '\u7cd6\u5c3f\u75c5\u6216\u63a7\u7cd6\u9700\u6c42\u957f\u8005' : '\u957f\u8005\u6e05\u6de1\u8425\u517b\u81b3\u98df',
        dailyCal: '\u7ea61200kcal',
        salt: '\u6e05\u6de1\u5c11\u76d0',
        goal: condition === 'diabetes' ? '\u63a7\u7cd6\u7a33\u7cd6' : '\u8425\u517b\u5747\u8861',
        items,
      },
      followup_suggestions: '\u53ef\u7ee7\u7eed\u8c03\u6574\u8f6f\u70c2\u7a0b\u5ea6\u3001\u6162\u75c5\u7981\u5fcc\u6216\u91c7\u8d2d\u6e05\u5355\u3002',
      actions: '\u786e\u8ba4\u8ba1\u5212 / \u751f\u6210\u91c7\u8d2d\u6e05\u5355',
    },
    actions: [
      {
        action_key: 'meal_plan.adjust_for_condition',
        label: '\u6309\u6162\u75c5\u8c03\u6574',
        params: { source: 'weekly_plan' },
      },
    ],
    followup_suggestions: [
      {
        label: '\u66f4\u8f6f\u70c2\u4e00\u70b9',
        user_prompt: '\u8bf7\u628a\u8fd9\u4efd\u4e00\u5468\u81b3\u98df\u8ba1\u5212\u8c03\u6574\u5f97\u66f4\u8f6f\u70c2\u6613\u5480\u56bc',
        action_key: 'meal_plan.adjust_for_condition',
      },
    ],
    compact_followups: compactFollowups,
    template_fit_notes: [],
  });
}

// 从消息中解析"周一…周日"结构化一周数据；无则返回 []
function parseWeekFromText(message) {
  const text = String(message || '');
  if (!text) return [];
  const daySplit = text.split(/(?=周[一二三四五六日天]|星期[一二三四五六日天])/);
  const days = [];
  for (const block of daySplit) {
    const dayName = dayNameFromText(block);
    if (!dayName) continue;
    const mealSplit = block.split(/(?=🌅|☀️|🌙|早餐|早饭|午餐|午饭|晚餐|晚饭)/);
    const meals = [];
    for (const seg of mealSplit) {
      const mealName = mealTypeFromText(seg);
      if (!mealName) continue;
      const body = seg.replace(/🌅|☀️|🌙|早餐|早饭|午餐|午饭|晚餐|晚饭/g, '').trim();
      const calMatch = body.match(/约?\s*(\d+)\s*千?卡/);
      const mealCal = calMatch ? `\u7ea6${calMatch[1]}kcal` : '';
      const foods = body.split('\n')
        .map((s) => s.replace(/约?\s*\d+\s*千?卡/g, '').trim())
        .filter(Boolean)[0] || '';
      if (foods) meals.push({ mealName, foods, mealCal });
    }
    if (meals.length) days.push({ dayName, meals });
  }
  return days;
}

function dayNameFromText(t) {
  const m = String(t || '').match(/周[一二三四五六日天]|星期[一二三四五六日天]/);
  if (!m) return null;
  const c = m[0].slice(-1);
  return '周' + (c === '天' ? '日' : c);
}

function mealTypeFromText(t) {
  if (/🌅|早/i.test(t)) return '早餐';
  if (/☀️|午/i.test(t)) return '午餐';
  if (/🌙|晚/i.test(t)) return '晚餐';
  return null;
}

// 把解析出的零散日数据对齐成 7 天标准结构（缺失日用示例兜底）
function normalizeParsedWeek(days, condition) {
  const order = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const byName = {};
  for (const d of days) byName[d.dayName] = d;
  const defaults = buildWeeklyPlanItems(condition);
  return order.map((dayName) => {
    const d = byName[dayName];
    if (!d) return defaults.find((x) => x.dayName === dayName);
    const meals = ['早餐', '午餐', '晚餐'].map((mealName) => {
      const m = d.meals.find((x) => x.mealName === mealName);
      return m || { mealName, foods: '\uff08\u672a\u63d0\u4f9b\uff09', mealCal: '' };
    });
    return { dayName, summary: '\u6309\u60a8\u63d0\u4f9b\u7684\u83dc\u54c1\u5b89\u6392\u3002', meals };
  }).filter(Boolean);
}

function buildWeeklyPlanItems(condition, items = []) {
  const preferred = items.length ? items.slice(0, 3).join('\u3001') : condition === 'diabetes' ? '\u71d5\u9ea6\u7ca5\u3001\u6c34\u716e\u86cb\u3001\u6e05\u84b8\u9c7c' : '\u5c0f\u7c73\u7ca5\u3001\u84b8\u86cb\u3001\u65f6\u4ee4\u852c\u83dc';
  const days = [
    ['\u5468\u4e00', '\u71d5\u9ea6\u5c0f\u7c73\u7ca5\u3001\u9e21\u86cb', '\u6742\u7cae\u996d\u3001\u6e05\u84b8\u9c7c\u3001\u9752\u83dc', '\u756a\u8304\u8c46\u8150\u6c64\u3001\u65f6\u852c'],
    ['\u5468\u4e8c', '\u65e0\u7cd6\u8c46\u6d46\u3001\u5168\u9ea6\u9992\u5934', '\u9e21\u80f8\u8089\u7096\u51ac\u74dc\u3001\u7cd9\u7c73\u996d', '\u5357\u74dc\u5c0f\u7c73\u7ca5\u3001\u8c46\u8150\u9752\u83dc'],
    ['\u5468\u4e09', '\u5c0f\u7c73\u7ca5\u3001\u84b8\u86cb', '\u7cd9\u7c73\u996d\u3001\u8c46\u8150\u9752\u83dc', '\u6e05\u84b8\u9c7c\u3001\u6cb9\u9ea6\u83dc'],
    ['\u5468\u56db', '\u71d5\u9ea6\u7ca5\u3001\u51c9\u62cc\u9ec4\u74dc', '\u6742\u7cae\u996d\u3001\u7626\u8089\u7096\u841d\u535c', '\u7d2b\u83dc\u86cb\u82b1\u6c64\u3001\u65f6\u852c'],
    ['\u5468\u4e94', '\u65e0\u7cd6\u8c46\u6d46\u3001\u7389\u7c73', '\u6e05\u84b8\u9c7c\u3001\u897f\u5170\u82b1', '\u8c46\u8150\u6c64\u3001\u9752\u83dc'],
    ['\u5468\u516d', '\u5357\u74dc\u7ca5\u3001\u9e21\u86cb', '\u6742\u7cae\u996d\u3001\u51ac\u74dc\u867e\u4ec1', '\u5c0f\u7c73\u7ca5\u3001\u65f6\u852c'],
    ['\u5468\u65e5', '\u71d5\u9ea6\u7ca5\u3001\u84b8\u86cb', '\u7cd9\u7c73\u996d\u3001\u6e05\u7096\u9e21\u8089', '\u756a\u8304\u8c46\u8150\u6c64\u3001\u9752\u83dc'],
  ];

  return days.map(([dayName, breakfast, lunch, dinner], index) => ({
    dayName,
    dayTotal: '\u7ea6' + (300 + 520 + 430) + 'kcal',
    summary: index === 0 ? '\u53ef\u4f18\u5148\u4f7f\u7528\uff1a' + preferred : '\u4e3b\u98df\u5b9a\u91cf\uff0c\u5c11\u6cb9\u5c11\u76d0\uff0c\u642d\u914d\u4f18\u8d28\u86cb\u767d\u3002',
    meals: [
      { mealName: '\u65e9\u9910', foods: breakfast, mealCal: '\u7ea6300kcal' },
      { mealName: '\u5348\u9910', foods: lunch, mealCal: '\u7ea6520kcal' },
      { mealName: '\u665a\u9910', foods: dinner, mealCal: '\u7ea6430kcal' },
    ],
  }));
}
function fillDietCard({ message, business_data }) {
  const mealType = inferMealType(message);
  const condition = inferCondition(message);
  const items = Array.isArray(business_data?.items)
    ? business_data.items.map((item) => sanitizeText(item)).filter(Boolean)
    : defaultFoods(condition);
  const meals = buildMeals(mealType, items);
  const answerText = buildAnswer(condition, mealType);

  const compactFollowups = [
    {
      label: '生成一周计划',
      action_key: 'meal_plan.generate_weekly_plan',
      input: {
        type: 'select',
        placeholder: '选择健康状况',
        param_key: 'condition',
        options: [
          { value: 'diabetes', label: '糖尿病/控糖' },
          { value: 'hypertension', label: '高血压' },
          { value: 'low_salt', label: '低盐饮食' },
          { value: 'gout', label: '痛风/高尿酸' },
          { value: 'general', label: '通用营养' },
        ],
      },
    },
  ];

  return sanitizeModelResult({
    template_id: 'diet_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      dateBadge: mealType === '一日三餐' ? '今日推荐 - 一日三餐' : `今日推荐 - ${mealType}`,
      suitable: buildSuitable(condition),
      totalCal: mealType === '一日三餐' ? '约620kcal' : '约220kcal',
      salt: condition === 'low_salt' ? '每日不超过5g' : '清淡少盐',
      meals,
      ratioText: buildRatioText(condition),
      tags: buildTags(condition),
      related: [
        {
          relIcon: '📅',
          relIconStyle: '',
          relTitle: '查看完整一周膳食方案',
          relDesc: '按每日三餐继续生成更完整的计划',
        },
        {
          relIcon: '❤️',
          relIconStyle: 'background:linear-gradient(135deg,#FFD4E5,#FFB4C8)',
          relTitle: condition === 'low_salt' ? '高血压老人饮食有什么禁忌？' : '糖尿病老人怎么控制早餐升糖？',
          relDesc: '查看忌口、替换食材和进餐顺序',
        },
      ],
      summary: buildSummary(condition, mealType),
      nutrition_tips: buildNutritionTips(condition),
      risk_warnings: buildRiskWarnings(condition),
    },
    actions: [
      {
        action_key: 'meal_plan.generate_weekly_plan',
        label: '生成一周计划',
        params: { template_id: 'weekly_plan' },
      },
      {
        action_key: 'meal_plan.adjust_for_condition',
        label: '按慢病调整',
        params: { source: 'mock_model' },
      },
    ],
    followup_suggestions: [
      {
        label: '换成一周计划',
        user_prompt: '请按这个原则生成一周控糖膳食计划',
        action_key: 'meal_plan.generate_weekly_plan',
      },
      {
        label: '更软烂一点',
        user_prompt: '请把这份膳食建议调整得更软烂易咀嚼',
        action_key: 'meal_plan.adjust_for_condition',
      },
    ],
    compact_followups: compactFollowups,
    template_fit_notes: [],
  });
}

function inferMealType(message) {
  if (/早餐|早饭|breakfast/i.test(message)) return '早餐';
  if (/午餐|午饭|lunch/i.test(message)) return '午餐';
  if (/晚餐|晚饭|dinner/i.test(message)) return '晚餐';
  if (/一周|七天|周计划|weekly/i.test(message)) return '一日三餐';
  return '一日三餐';
}

function inferCondition(message) {
  if (/糖尿病|血糖|控糖|低糖|diabetes/i.test(message)) return 'diabetes';
  if (/高血压|血压|低盐|hypertension|salt/i.test(message)) return 'low_salt';
  if (/吞咽|咀嚼|软烂|soft/i.test(message)) return 'soft_food';
  return 'general';
}

function defaultFoods(condition) {
  if (condition === 'diabetes') return ['燕麦粥', '水煮蛋', '清炒青菜'];
  if (condition === 'low_salt') return ['清蒸鱼', '冬瓜汤', '杂粮饭'];
  if (condition === 'soft_food') return ['南瓜粥', '蒸蛋羹', '软烂青菜'];
  return ['小米粥', '水煮蛋', '时令蔬菜'];
}

function buildMeals(mealType, items) {
  const names = mealType === '一日三餐' ? ['早餐', '午餐', '晚餐'] : [mealType];
  return names.map((name, index) => ({
    mealName: name,
    mealEmoji: mealEmoji(name),
    mealTotal: index === 0 ? '约180kcal' : index === 1 ? '约260kcal' : '约180kcal',
    foods: items.map((item, itemIndex) => ({
      foodIcon: foodIcon(item),
      foodName: item,
      cal: itemIndex === 0 ? '约90kcal' : itemIndex === 1 ? '约70kcal' : '约60kcal',
      calNote: '建议适量',
    })),
  }));
}

function mealEmoji(mealName) {
  if (mealName === '早餐') return '🌤️🥣';
  if (mealName === '午餐') return '☀️🍱';
  if (mealName === '晚餐') return '🌙🍲';
  return '🍽️';
}

function foodIcon(item) {
  if (/蛋/.test(item)) return '🥚';
  if (/鱼/.test(item)) return '🐟';
  if (/粥/.test(item)) return '🥣';
  if (/菜|瓜|南瓜|冬瓜/.test(item)) return '🥬';
  return '🍽️';
}

function buildSuitable(condition) {
  if (condition === 'diabetes') return '糖尿病或控糖需求老人';
  if (condition === 'low_salt') return '高血压或低盐需求老人';
  if (condition === 'soft_food') return '咀嚼吞咽能力较弱老人';
  return '长者清淡营养膳食';
}

function buildRatioText(condition) {
  if (condition === 'diabetes') return '主食定量，优先低 GI 粗杂粮；搭配优质蛋白和膳食纤维，减少精制糖。';
  if (condition === 'low_salt') return '控制盐和高钠调味品，优先蒸煮炖，保证蛋白质和蔬菜摄入。';
  return '碳水、蛋白质和脂肪均衡搭配，口味清淡，少油少盐。';
}

function buildTags(condition) {
  const tags = [];
  if (condition === 'diabetes') tags.push({ tagIcon: '💙', tagLabel: '糖尿病' });
  if (condition === 'low_salt') tags.push({ tagIcon: '❤️', tagLabel: '高血压' });
  if (condition === 'soft_food') tags.push({ tagIcon: '🥣', tagLabel: '软烂易嚼' });
  tags.push({ tagIcon: '🥗', tagLabel: '清淡膳食' });
  return tags;
}

function buildAnswer(condition, mealType) {
  const conditionText = condition === 'diabetes'
    ? '控糖'
    : condition === 'low_salt'
      ? '低盐'
      : condition === 'soft_food'
        ? '软烂易咀嚼'
        : '清淡均衡';
  return `建议${mealType}以${conditionText}、优质蛋白和易消化食物为主，并结合老人当前健康情况控制总量。`;
}

function buildSummary(condition, mealType) {
  return `${buildSuitable(condition)}的${mealType}建议，重点控制油盐糖并保证蛋白质和膳食纤维。`;
}

function buildNutritionTips(condition) {
  const tips = ['主食控制总量', '优先选择粗杂粮', '搭配优质蛋白'];
  if (condition === 'low_salt') tips.push('减少腌制品和重口味调味料');
  if (condition === 'soft_food') tips.push('优先蒸煮炖，避免坚硬和带刺食物');
  return tips;
}

function buildRiskWarnings(condition) {
  if (condition === 'diabetes') return ['如正在使用降糖药，应避免空腹过久'];
  if (condition === 'low_salt') return ['如血压近期波动明显，应同步咨询医生'];
  return ['如出现胸痛、呼吸困难等急症，应优先就医'];
}

function isTravelRouteText(text) {
  return /travel|route|trip|tour|旅居|旅游|康养|路线|线路|行程|目的地|基地|广西|巴马|北海|桂林|预订|预算|交通/.test(String(text || ''));
}

function isNearbyResourceText(text, intent_context = {}) {
  if (intent_context?.scene_key === 'nearby_resource') return true;
  if (intent_context?.intent?.startsWith('nearby_resource.')) return true;
  return /嘉路|康养中心|周边|附近|15公里|地图|民宿|景区|海鲜|垂钓|康养|医疗|餐馆|餐厅|游玩|景点|配套|资源|生活圈|分布|大屏|在哪|map|nearby|around/.test(String(text || ''));
}

// 腾讯地图 JS API Key。留空或占位符时卡片自动降级为 SVG 方位图。
const NEARBY_TENCENT_JS_KEY = 'KI4BZ-5GGLT-POOXY-LQK77-6XA62-YVFPH';

// 广西旅居目的地坐标映射表（lat, lng）
// 用于 travel_route 模板的地图渲染，将目的地名转换为坐标
const TRAVEL_DESTINATION_COORDS = {
  '巴马': { lat: 24.0487, lng: 107.2586, name: '巴马瑶族自治县' },
  '巴马瑶族自治县': { lat: 24.0487, lng: 107.2586, name: '巴马瑶族自治县' },
  '北海': { lat: 21.4817, lng: 109.1196, name: '北海市' },
  '北海市': { lat: 21.4817, lng: 109.1196, name: '北海市' },
  '涠洲岛': { lat: 21.0388, lng: 109.1419, name: '涠洲岛' },
  '防城港': { lat: 21.6146, lng: 108.3545, name: '防城港市' },
  '防城港市': { lat: 21.6146, lng: 108.3545, name: '防城港市' },
  '港口区': { lat: 21.6146, lng: 108.3545, name: '防城港港口区' },
  '东兴': { lat: 21.5479, lng: 107.9722, name: '东兴市' },
  '桂林': { lat: 25.2734, lng: 110.2902, name: '桂林市' },
  '桂林市': { lat: 25.2734, lng: 110.2902, name: '桂林市' },
  '阳朔': { lat: 24.7784, lng: 110.4890, name: '阳朔县' },
  '南宁': { lat: 22.8170, lng: 108.3669, name: '南宁市' },
  '南宁市': { lat: 22.8170, lng: 108.3669, name: '南宁市' },
  '柳州': { lat: 24.3264, lng: 109.4280, name: '柳州市' },
  '百色': { lat: 23.9022, lng: 106.6182, name: '百色市' },
  '百色市': { lat: 23.9022, lng: 106.6182, name: '百色市' },
  '钦州': { lat: 21.9522, lng: 108.6286, name: '钦州市' },
  '梧州': { lat: 23.4765, lng: 111.2791, name: '梧州市' },
  '贺州': { lat: 24.4033, lng: 111.5527, name: '贺州市' },
  '玉林': { lat: 22.6360, lng: 110.1540, name: '玉林市' },
  '贵港': { lat: 23.1114, lng: 109.5982, name: '贵港市' },
  '河池': { lat: 24.6965, lng: 108.0853, name: '河池市' },
  '来宾': { lat: 23.7333, lng: 109.2217, name: '来宾市' },
  '崇左': { lat: 22.4041, lng: 107.3540, name: '崇左市' },
  '嘉路': { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' },
  '嘉路康养中心': { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' },
  '七洞乡': { lat: 23.6817, lng: 109.0512, name: '来宾市兴宾区七洞乡' },
};

// 默认旅居坐标（防城港嘉路康养中心，作为兜底）
const TRAVEL_DEFAULT_COORD = { lat: 21.5279, lng: 108.1668, name: '嘉路康养中心' };

/**
 * 从目的地名提取坐标。支持模糊匹配（如"广西巴马"→"巴马"）。
 * @param {string} destination - 目的地名
 * @returns {{lat:number,lng:number,name:string}} 坐标对象
 */
function getTravelDestinationCoord(destination) {
  if (!destination) return TRAVEL_DEFAULT_COORD;
  const dest = String(destination).trim();
  // 精确匹配
  if (TRAVEL_DESTINATION_COORDS[dest]) return TRAVEL_DESTINATION_COORDS[dest];
  // 模糊匹配：目的地包含映射表的 key
  for (const key of Object.keys(TRAVEL_DESTINATION_COORDS)) {
    if (dest.includes(key)) return TRAVEL_DESTINATION_COORDS[key];
  }
  return { ...TRAVEL_DEFAULT_COORD, name: dest };
}

/**
 * 为 travel_route 模板构建地图数据字段
 * @param {string} destination - 目的地名
 * @param {Array} markers - 额外标记点 [{name,lat,lng,address,cat}]
 * @returns {object} map_key, centerLat, centerLng, centerName, center_json, static_map_url, markers_json, map_markers
 */
function buildTravelMapData(destination, markers = []) {
  const center = getTravelDestinationCoord(destination);
  const validMarkers = (markers || []).filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)));
  return {
    map_key: process.env.TENCENT_MAP_JS_KEY || NEARBY_TENCENT_JS_KEY,
    centerLat: center.lat,
    centerLng: center.lng,
    centerName: center.name,
    center_json: JSON.stringify(center),
    static_map_url: buildStaticMapUrl(center, validMarkers.slice(0, 30)),
    markers_json: JSON.stringify(validMarkers),
    map_markers: validMarkers,
  };
}

/**
 * 生成旅居路线走线途经点坐标（用于 TMap.Polyline 画线）。
 * 基于 destination 中心坐标，按天数生成途经点：
 * - D1: 抵达点（中心坐标附近的交通枢纽）
 * - D2..D(n-1): 周边康养景点/基地（中心坐标周围分散）
 * - D(n): 返程点（与抵达点同坐标或附近）
 * @param {string} destination - 目的地
 * @param {number} totalDays - 总天数
 * @returns {Array<{name, lat, lng, day, type, plan}>} 途经点数组
 */
const ROUTE_WAYPOINT_TEMPLATES = {
  // 每个目的地的典型走线途经点（按天序），坐标为真实经纬度
  '广西巴马': [
    { name: '巴马长寿村', lat: 24.0487, lng: 107.2586, type: 'arrival' },
    { name: '百魔洞景区', lat: 24.0652, lng: 107.2391, type: 'spot' },
    { name: '水晶宫景区', lat: 24.0321, lng: 107.2845, type: 'spot' },
    { name: '盘阳河康养带', lat: 24.0412, lng: 107.2701, type: 'wellness' },
    { name: '巴马汽车总站', lat: 24.0523, lng: 107.2512, type: 'departure' },
  ],
  '广西北海': [
    { name: '北海火车站', lat: 21.4721, lng: 109.1196, type: 'arrival' },
    { name: '银滩旅游区', lat: 21.4417, lng: 109.1286, type: 'spot' },
    { name: '老街历史文化区', lat: 21.4856, lng: 109.1132, type: 'spot' },
    { name: '涠洲岛码头', lat: 21.4632, lng: 109.1089, type: 'spot' },
    { name: '北海福成机场', lat: 21.5417, lng: 109.2632, type: 'departure' },
  ],
  '广西七洞乡': [
    { name: '七洞乡政府', lat: 23.6817, lng: 109.0512, type: 'arrival' },
    { name: '七洞乡康养基地', lat: 23.6852, lng: 109.0491, type: 'wellness' },
    { name: '七洞乡生态园', lat: 23.6781, lng: 109.0568, type: 'spot' },
    { name: '来宾火车站', lat: 23.7256, lng: 109.0612, type: 'departure' },
  ],
};

function buildRouteWaypoints(destination, totalDays = 3) {
  const center = getTravelDestinationCoord(destination);
  const destKey = Object.keys(ROUTE_WAYPOINT_TEMPLATES).find((k) => destination.includes(k.replace('广西', '')));
  const templates = destKey ? ROUTE_WAYPOINT_TEMPLATES[destKey] : null;
  const days = Math.max(2, Math.min(7, parseInt(totalDays) || 3));

  if (templates && templates.length >= days) {
    // 用真实途经点模板，按天数截取
    const waypoints = templates.slice(0, days).map((wp, i) => ({
      ...wp,
      day: `D${i + 1}`,
      plan: i === 0 ? `抵达${wp.name}，办理入住` : i === days - 1 ? `从${wp.name}返程` : `${wp.name}康养体验`,
    }));
    return waypoints;
  }

  // 无模板时，基于中心坐标生成环形走线（每天一个点，绕中心分布）
  const waypoints = [];
  const radius = 0.04; // 约 4 公里
  for (let i = 0; i < days; i++) {
    const angle = (i / days) * Math.PI * 2 - Math.PI / 2; // 从正北开始顺时针
    const offset = i === 0 || i === days - 1 ? 0 : radius; // 起止点在中心，中间点分散
    const lat = center.lat + Math.cos(angle) * offset;
    const lng = center.lng + Math.sin(angle) * offset;
    const isArrival = i === 0;
    const isDeparture = i === days - 1;
    waypoints.push({
      name: isArrival ? `${center.name}抵达点` : isDeparture ? `${center.name}返程点` : `${center.name}Day${i + 1}体验点`,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      day: `D${i + 1}`,
      type: isArrival ? 'arrival' : isDeparture ? 'departure' : 'spot',
      plan: isArrival ? `抵达${center.name}，办理入住` : isDeparture ? `从${center.name}返程` : `${center.name}康养体验`,
    });
  }
  return waypoints;
}

/**
 * 构建走线版地图数据（含 waypoints + polyline 路径）。
 * 用于 sojourn_route 模板的 TMap.Polyline 走线渲染。
 * @param {string} destination - 目的地
 * @param {number} totalDays - 总天数
 * @returns {Object} 含 waypoints_json, polyline_path, fit_bounds 等字段
 */
function buildRouteMapData(destination, totalDays = 3) {
  const center = getTravelDestinationCoord(destination);
  const waypoints = buildRouteWaypoints(destination, totalDays);
  const validWaypoints = waypoints.filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lng));
  // polyline 路径：按天序连接的坐标数组
  const polylinePath = validWaypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng }));
  // 自动适配缩放边界：[minLat, minLng, maxLat, maxLng]
  const lats = validWaypoints.map((wp) => wp.lat);
  const lngs = validWaypoints.map((wp) => wp.lng);
  const fitBounds = lats.length >= 2 ? {
    minLat: Math.min(...lats), minLng: Math.min(...lngs),
    maxLat: Math.max(...lats), maxLng: Math.max(...lngs),
  } : null;

  return {
    map_key: process.env.TENCENT_MAP_JS_KEY || NEARBY_TENCENT_JS_KEY,
    centerLat: center.lat,
    centerLng: center.lng,
    centerName: center.name,
    center_json: JSON.stringify(center),
    static_map_url: buildStaticMapUrl(center, validWaypoints.slice(0, 30)),
    markers_json: JSON.stringify(validWaypoints),
    map_markers: validWaypoints,
    // 走线专用字段
    waypoints_json: JSON.stringify(validWaypoints),
    waypoints: validWaypoints,
    polyline_path: polylinePath,
    polyline_path_json: JSON.stringify(polylinePath),
    fit_bounds: fitBounds,
    fit_bounds_json: fitBounds ? JSON.stringify(fitBounds) : 'null',
    // 腾讯路径规划 WebService API（用于获取真实道路走线，可选）
    route_planning_url: buildRoutePlanningUrl(validWaypoints),
  };
}

/**
 * 构建腾讯路径规划 WebService API URL（驾车路线）。
 * 用于获取真实道路走线，而非直线连接。
 * 注意：此 URL 在服务端调用，不在前端直接 fetch（涉及 SK 签名）。
 * @param {Array} waypoints - 途经点数组
 * @returns {string} 内部 API 路径（前端通过代理调用）
 */
function buildRoutePlanningUrl(waypoints = []) {
  if (waypoints.length < 2) return '';
  const from = `${waypoints[0].lat},${waypoints[0].lng}`;
  const to = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
  const via = waypoints.slice(1, -1).map((wp) => `${wp.lat},${wp.lng}`).join(';');
  return `/api/map/route-planning?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${via ? `&via=${encodeURIComponent(via)}` : ''}&policy=1`;
}

/**
 * 构建腾讯静态图 URL（降级中间层）
 * 用于 JS API 加载失败时，提供比 SVG 更真实的地图截图。
 * 使用 WebService Key + SK 签名（静态图属于 WS API 家族）
 */
function buildStaticMapUrl(center, markers = [], options = {}) {
  const wsKey = process.env.TENCENT_MAP_KEY || '';
  const sk = process.env.TENCENT_MAP_SK || '';
  if (!wsKey) return '';

  const params = {
    center: `${center.lat},${center.lng}`,
    zoom: options.zoom || 11,
    size: options.size || '600*420',
    maptype: options.maptype || 'roadmap',
  };
  const markerParam = buildStaticMapMarkers(markers);
  if (markerParam) params.markers = markerParam;

  // SK 签名：参数必须含 key，按字母排序后拼接
  const signParams = { ...params, key: wsKey };
  const sortedQuery = Object.keys(signParams).sort()
    .map((k) => `${k}=${signParams[k]}`).join('&');
  const encodedQuery = Object.keys(params).sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  let url = `https://apis.map.qq.com/ws/staticmap/v2?${encodedQuery}&key=${encodeURIComponent(wsKey)}`;
  if (sk) {
    const sig = crypto.createHash('md5').update(`/ws/staticmap/v2?${sortedQuery}${sk}`, 'utf8').digest('hex');
    url += '&sig=' + sig;
  }
  return url;
}

function buildStaticMapMarkers(markers = []) {
  const points = markers.slice(0, 30)
    .filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))
    .map((m) => `${Number(m.lat)},${Number(m.lng)}`);
  if (!points.length) return '';
  return ['color:blue', 'size:mid', ...points].join('|');
}

function fillNearbyResourceCard({ message = '', business_data = {}, intent_context = {} } = {}) {
  // 取数：优先使用 orchestrator 注入的共享数据层结果（已为全量周边配套）
  const facilities = Array.isArray(business_data?.jialu_facilities) ? business_data.jialu_facilities : [];
  const center = business_data?.jialu_center || { lng: 108.166816, lat: 21.527905, name: '嘉路康养中心' };
  const intent = intent_context?.intent || 'nearby_resource.all';
  const actionKey = intent_context?.action_key || '';
  const radiusKm = parseInt(String(message).match(/(\d+)\s*(公里|千米|km)/i)?.[1] || '15', 10);

  // 归一化全部 POI（真实字段：category/amap_type/biz_status/tel/open_time/service_tags/距离_公里）
  const all = (facilities || []).map(nbToMarker).filter((m) => m.lng && m.lat);
  const within = all.filter((m) => m.distance <= radiusKm); // 康养生活圈半径过滤
  const stats = nbBuildStats(within);

  // 决定分类与模板（基于意图 + 语义）
  const { cat, template_id } = nbDecide({ message, intent, actionKey });
  const catMarkers = cat ? within.filter((m) => m.cat === cat) : within;

  const center_json = JSON.stringify(center);
  const base = {
    centerName: center.name || '嘉路康养中心',
    centerLat: center.lat,
    centerLng: center.lng,
    radiusKm,
    map_key: process.env.TENCENT_MAP_JS_KEY || NEARBY_TENCENT_JS_KEY,
    center_json,
    stats,
    statsLabels: nbStatsLabels(stats),
    category: cat,
    categoryLabel: nbCatLabel(cat),
    isDefaultLocation: business_data?._is_default_location || false,
  };

  let markers = template_id === 'nearby_map_overview' ? within : catMarkers;
  const total = markers.length;
  // 生成静态图降级 URL（用 WebService Key+SK 签名，与前端 JS Key 独立）
  base.static_map_url = buildStaticMapUrl(center, markers.slice(0, 30));
  const answerText = nbAnswerText({ template_id, cat, total, radiusKm, stats });
  const data = { ...base, markers, markers_json: JSON.stringify(markers), total };

  // 对比 / 推荐：提取 Top3（标签多、距离近优先）
  if (template_id === 'nearby_compare' || template_id === 'nearby_recommend') {
    const pool = catMarkers.length ? catMarkers : within;
    data.picks = nbPickTop(pool, 3).map((m, i) => ({ ...nbWithReason(m), rank: i + 1 }));
    data.picks_json = JSON.stringify(data.picks);
  }
  // 路线：编排一日康养游
  if (template_id === 'nearby_map_route') {
    data.routeStops = nbBuildRoute(within);
    data.routeStops_json = JSON.stringify(data.routeStops);
    markers = within;
    data.markers = markers;
    data.markers_json = JSON.stringify(markers);
    data.total = markers.length;
  }
  // 雷达：步行可达（≤1.5km）
  if (template_id === 'nearby_radar') {
    data.walkItems = within.filter((m) => m.distance <= 1.5);
    data.walkCount = data.walkItems.length;
    data.walkItems_json = JSON.stringify(data.walkItems);
  }
  // 康养配套：养 + 住（康养小院/医疗）
  if (template_id === 'nearby_wellness') {
    const wi = within.filter((m) => m.cat === 'wellness' || m.cat === 'stay');
    data.wellnessItems = wi;
    data.wellnessItems_json = JSON.stringify(wi);
    markers = wi;
    data.markers = markers;
    data.markers_json = JSON.stringify(markers);
    data.total = wi.length;
  }
  // 语音摘要
  if (template_id === 'nearby_summary') {
    data.summaryText = nbSummaryText({ radiusKm, stats });
  }

  const compactFollowups = [
    {
      label: '周边导航',
      action_key: 'nearby_resource.route',
      input: {
        type: 'select',
        placeholder: '选择目的地类型',
        param_key: 'category',
        options: [
          { value: 'food', label: '🍽️ 餐饮' },
          { value: 'stay', label: '🏠 住宿' },
          { value: 'spot', label: '🏖️ 景点' },
          { value: 'medical', label: '🏥 医疗' },
          { value: 'leisure', label: '🎣 休闲' },
        ],
      },
    },
  ];

  return sanitizeModelResult({
    template_id,
    answer_text: answerText,
    answer: answerText,
    data,
    actions: nbActions(),
    followup_suggestions: nbFollowups(),
    compact_followups: compactFollowups,
    template_fit_notes: ['nearby_resource_' + (cat || 'all')],
  });
}

const NB_COLORS = {
  stay: '#3B82A0', food: '#F2994A', spot: '#2BAE8E', leisure: '#8E6FD8',
  shop: '#E08AC0', transit: '#6B7A8F', wellness: '#E5484D', other: '#9AA7B2',
};

const NB_EMOJI = {
  stay: '🏠', food: '🍜', spot: '🏖️', leisure: '🎣',
  shop: '🛍️', transit: '🚐', wellness: '🏥', other: '📍',
};

// 将原始 POI 映射为模板统一字段（评分字段真实数据为空，固定留空，改用距离/标签作质量信号）
function nbToMarker(f) {
  const cat = nbCat(f);
  const raw = String(f.service_tags || '');
  const tags = raw.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  return {
    poi_id: f.poi_id || '',
    name: f.name || f.名称 || '未命名',
    address: f.address || f.地址 || '',
    lng: parseFloat(f.lng ?? f.经度) || 0,
    lat: parseFloat(f.lat ?? f.纬度) || 0,
    distance: parseFloat(f['距离_公里'] ?? f.distance) || 0,
    distance_text: (parseFloat(f['距离_公里'] ?? f.distance) || 0).toFixed(1),
    category: f.category || '',
    amap_type: f.amap_type || '',
    cat,
    color: NB_COLORS[cat] || NB_COLORS.other,
    emoji: NB_EMOJI[cat] || NB_EMOJI.other,
    biz_status: String(f.biz_status || '').trim(),
    tel: f.tel || f.电话 || '',
    open_time: String(f.open_time || '').trim(),
    tags,
    tags_text: tags.join('·'),
    rating: '',
    // ★ 预编码的导航参数 JSON（避免 Mustache 转义破坏 JSON）
    nav_params: JSON.stringify({ lat: parseFloat(f.lat ?? f.纬度) || 0, lng: parseFloat(f.lng ?? f.经度) || 0, name: f.name || f.名称 || '未命名' }),
    // ★ 富化字段透传
    source: f._source || 'local',
    enriched_description: f.enriched_description || '',
    enriched_images: f.enriched_images || [],
    enriched_rating_hint: f.enriched_rating_hint || '',
  };
}

function nbCat(f) {
  const cat = (String(f.category || '')).toLowerCase();
  const amap = (String(f.amap_type || '')).toLowerCase();
  if (/垂钓|钓鱼/.test(amap)) return 'leisure';
  if (/药房|医药|保健|医疗|卫生|疾控|诊所|医院/.test(amap)) return 'wellness';
  if (/购物|市场|超市|商店|便利店|专卖店|农副|特产/.test(amap)) return 'shop';
  if (/海滨浴场|风景名胜|公园|广场|寺庙|教堂|纪念馆|科技馆|水族馆|观景点|景点|旅游|湿地/.test(amap)) return 'spot';
  if (/体育休闲|休闲场所|度假|营地|游乐/.test(amap)) return 'leisure';
  if (/餐饮|餐厅|酒楼|饭店|食|海鲜/.test(amap)) return 'food';
  if (/住宿|酒店|旅馆|招待所|宾馆|客栈/.test(amap)) return 'stay';
  if (/包车|租赁|停车场|车站|交通|道路/.test(amap)) return 'transit';
  if (/民宿|康养小院|商务住宅/.test(cat)) return 'stay';
  if (/餐厅|餐饮|美食|饭店|私房菜|大排档/.test(cat)) return 'food';
  if (/景区|景点|滨海|海边/.test(cat)) return 'spot';
  if (/垂钓|休闲|钓鱼/.test(cat)) return 'leisure';
  if (/购物|特产|买/.test(cat)) return 'shop';
  if (/包车|交通/.test(cat)) return 'transit';
  if (/医养|养老/.test(cat)) return 'wellness';
  return 'other';
}

function nbDecide({ message, intent, actionKey }) {
  const m = String(message || '');
  const isIntent = (s) => intent === s;
  const wantMap = /地图|分布|打点|标记|位置|在哪|大屏|标出来|看地图|周边分布|资源分布/.test(m);
  const wantRoute = /规划|一天|路线|行程|怎么玩|怎么安排|攻略|itinera|玩法/.test(m);
  const wantRadar = /步行|走路|可达|近一点|附近走|溜达|遛弯|走路能到/.test(m);
  const wantCompare = /对比|比较|哪家好|哪个好|选哪个|挑一个|怎么选/.test(m);
  const wantRecommend = /推荐|适合|给我挑|有个性的|个性化|精选|必去|必吃|挑几个/.test(m);
  // 注意：「康养」二字因出现在中心名「嘉路康养中心」中过于宽泛，故仅匹配明确的康养/医养意图
  const wantWellness = /康养配套|医养|养老设施|康养生态|适老|医疗康养/.test(m);
  const wantSummary = /简单|语音|念|概括|小结|告诉我有什么|大概|罗列一下|一句话|语音播报/.test(m);

  let cat = '';
  // 优先从 action_key 推断分类（bypass 路径）
  if (actionKey === 'nearby_resource.stay') cat = 'stay';
  else if (actionKey === 'nearby_resource.food') cat = 'food';
  else if (actionKey === 'nearby_resource.spot') cat = 'spot';
  else if (actionKey === 'nearby_resource.leisure') cat = 'leisure';
  else if (actionKey === 'nearby_resource.shop') cat = 'shop';
  else if (actionKey === 'nearby_resource.transit') cat = 'transit';
  else if (actionKey === 'nearby_resource.wellness' || actionKey === 'nearby_resource.medical') cat = 'wellness';
  if (!cat) {
    if (isIntent('nearby_resource.stay')) cat = 'stay';
    else if (isIntent('nearby_resource.food')) cat = 'food';
    else if (isIntent('nearby_resource.spot')) cat = 'spot';
    else if (isIntent('nearby_resource.leisure')) cat = 'leisure';
    else if (isIntent('nearby_resource.shop')) cat = 'shop';
    else if (isIntent('nearby_resource.transit')) cat = 'transit';
    else if (isIntent('nearby_resource.wellness')) cat = 'wellness';
  }
  if (!cat) {
    if (/民宿|住哪|住宿|康养小院|入住/.test(m)) cat = 'stay';
    else if (/吃|餐厅|餐饮|美食|海鲜|私房菜|大排档/.test(m)) cat = 'food';
    else if (/景区|景点|海边|滨海|游玩|玩/.test(m)) cat = 'spot';
    else if (/垂钓|休闲|钓鱼|娱乐/.test(m)) cat = 'leisure';
    else if (/购物|特产|买/.test(m)) cat = 'shop';
    else if (/包车|交通|怎么去|出行/.test(m)) cat = 'transit';
    else if (/医养|医疗/.test(m)) cat = 'wellness';
  }

  // 展示形态优先（与分类无关）
  if (wantSummary) return { cat, template_id: 'nearby_summary' };
  if (wantRoute) return { cat, template_id: 'nearby_map_route' };
  if (wantRadar) return { cat, template_id: 'nearby_radar' };
  if (wantCompare) return { cat, template_id: 'nearby_compare' };
  if (wantRecommend) return { cat, template_id: 'nearby_recommend' };
  if (wantMap) return { cat: cat || '', template_id: cat ? 'nearby_map_category' : 'nearby_map_overview' };
  // 分类意图优先于 wellness（避免「康养小院」被误判为医养）
  if (cat === 'wellness' || (wantWellness && !cat)) return { cat: cat || 'wellness', template_id: 'nearby_wellness' };
  if (cat === 'stay') return { cat, template_id: 'nearby_stay_card' };
  if (cat === 'food') return { cat, template_id: 'nearby_food_card' };
  if (cat === 'spot') return { cat, template_id: 'nearby_spot_card' };
  if (cat === 'leisure' || cat === 'shop' || cat === 'transit') return { cat, template_id: 'nearby_list' };
  return { cat: '', template_id: 'nearby_map_overview' };
}

function nbCatLabel(cat) {
  return {
    stay: '民宿', food: '餐饮', spot: '景区', leisure: '休闲',
    shop: '购物', transit: '交通', wellness: '康养', '': '全部',
  }[cat] || '资源';
}

function nbBuildStats(within) {
  const s = { stay: 0, food: 0, spot: 0, leisure: 0, shop: 0, transit: 0, wellness: 0, other: 0 };
  within.forEach((m) => { s[m.cat] = (s[m.cat] || 0) + 1; });
  s.total = within.length;
  return s;
}

function nbStatsLabels(stats) {
  const order = [
    ['stay', '住', '🏠'], ['food', '吃', '🍜'], ['spot', '游', '🏖️'], ['leisure', '娱', '🎣'],
    ['shop', '购', '🛍️'], ['transit', '行', '🚐'], ['wellness', '养', '🏥'],
  ];
  return order.map(([k, label, emoji]) => ({ key: k, label, emoji, count: stats[k] || 0, color: NB_COLORS[k] }));
}

function nbPickTop(pool, n) {
  return pool.slice().sort((a, b) => (b.tags.length - a.tags.length) || (a.distance - b.distance)).slice(0, n);
}

function nbWithReason(m) {
  let reason;
  if (m.cat === 'wellness') reason = '医养配套，适老安心';
  else if (m.tags && m.tags.length) reason = '招牌：' + m.tags_text;
  else reason = '距中心仅 ' + (parseFloat(m.distance) || 0).toFixed(1) + 'km，出行方便';
  return { ...m, reason };
}

function nbBuildRoute(within) {
  const nearest = (c) => within.filter((m) => m.cat === c).sort((a, b) => a.distance - b.distance)[0];
  const food2 = within.filter((m) => m.cat === 'food').sort((a, b) => a.distance - b.distance)[1];
  const stops = [];
  const stay = nearest('stay'); if (stay) stops.push({ ...stay, role: '入住·出发' });
  const food1 = nearest('food'); if (food1) stops.push({ ...food1, role: '早餐' });
  const spot = nearest('spot'); if (spot) stops.push({ ...spot, role: '滨海游玩' });
  const lei = nearest('leisure'); if (lei) stops.push({ ...lei, role: '休闲体验' });
  if (food2) stops.push({ ...food2, role: '午餐 / 晚餐' });
  if (stay) stops.push({ ...stay, role: '返回·入住' });
  return stops;
}

function nbAnswerText({ template_id, cat, total, radiusKm }) {
  const catName = {
    stay: '住宿（民宿/康养小院）', food: '特色餐饮', spot: '滨海景区', leisure: '垂钓休闲',
    shop: '购物特产', transit: '包车交通', wellness: '医疗康养', '': '各类生活配套',
  }[cat] || '各类生活配套';
  if (template_id === 'nearby_summary') return `已生成嘉路康养中心 ${radiusKm} 公里生活圈语音摘要。`;
  if (template_id === 'nearby_map_route') return '已为您编排一条「一日康养游」路线，串联周边精华配套。';
  if (template_id === 'nearby_radar') return `已标注 ${radiusKm} 公里生活圈内可步行直达的配套。`;
  if (template_id === 'nearby_wellness') return `已汇总嘉路周边康养配套（共 ${total} 个）。`;
  return `已为您整理嘉路康养中心周边 ${radiusKm} 公里内的${catName}（共 ${total} 个）。`;
}

function nbActions() {
  const cats = [
    ['all', '全部', '嘉路周边全部配套'], ['stay', '住', '嘉路周边民宿和康养小院'],
    ['food', '吃', '嘉路周边餐厅餐饮'], ['spot', '游', '嘉路周边滨海景区'],
    ['leisure', '娱', '嘉路周边垂钓休闲'], ['shop', '购', '嘉路周边购物特产'],
    ['transit', '行', '嘉路周边包车交通'], ['wellness', '养', '嘉路周边医疗康养'],
  ];
  const chips = cats.map(([k, label, prompt]) => ({
    action_key: 'nearby_resource.' + k, label, params: {}, user_prompt: prompt,
  }));
  const toggles = [
    { action_key: 'nearby_resource.compare', label: '同类对比', user_prompt: '嘉路周边同类资源对比' },
    { action_key: 'nearby_resource.recommend', label: '智能推荐', user_prompt: '嘉路周边适合老人的推荐' },
    { action_key: 'nearby_resource.route', label: '一日路线', user_prompt: '帮我规划嘉路周边一日康养游路线' },
    { action_key: 'nearby_resource.radar', label: '步行可达', user_prompt: '嘉路周边步行能到的配套' },
    { action_key: 'nearby_resource.wellness', label: '康养配套', user_prompt: '嘉路周边康养配套' },
    { action_key: 'nearby_resource.summary', label: '语音摘要', user_prompt: '简单告诉我嘉路周边有什么配套' },
  ];
  return [...chips, ...toggles];
}

function nbFollowups() {
  return [
    { label: '只看滨海景区', user_prompt: '嘉路周边滨海景区分布图', action_key: 'nearby_resource.spot' },
    { label: '附近能吃饭的', user_prompt: '嘉路周边餐厅餐饮推荐', action_key: 'nearby_resource.food' },
    { label: '规划一日游', user_prompt: '帮我规划嘉路周边一日康养游路线', action_key: 'nearby_resource.route' },
  ];
}

function nbSummaryText({ radiusKm, stats }) {
  const parts = [];
  if (stats.stay) parts.push(`住 ${stats.stay} 处（民宿、康养小院）`);
  if (stats.food) parts.push(`吃 ${stats.food} 家（海鲜、私房菜）`);
  if (stats.spot) parts.push(`游 ${stats.spot} 个滨海景区`);
  if (stats.leisure) parts.push(`娱 ${stats.leisure} 处垂钓休闲`);
  if (stats.shop) parts.push(`购 ${stats.shop} 处特产购物`);
  if (stats.transit) parts.push(`行 ${stats.transit} 处包车交通`);
  if (stats.wellness) parts.push(`养 ${stats.wellness} 处医疗康养`);
  const body = parts.length ? parts.join('，') : '暂无配套收录';
  return `嘉路康养中心 ${radiusKm} 公里康养生活圈共收录 ${stats.total} 个配套：${body}。想看哪类，点下方按钮看地图或清单。`;
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

/**
 * service_card / service_intent / service_thinking 过渡态/辅助卡片填槽
 * 这三个模板原先走 no_local_fill 兜底（显示纯文本），现补充本地填槽，
 * 使其在无 LLM 层放开数据时也能用默认/上下文数据正常渲染卡片。
 */
function fillServiceTransitionalCard({ message = '', business_data = {}, intent_context = {}, selectedTemplateId } = {}) {
  if (selectedTemplateId === 'service_thinking') {
    return sanitizeModelResult({
      template_id: 'service_thinking',
      answer_text: '正在为您分析需求，请稍候...',
      answer: '正在为您分析需求，请稍候...',
      data: {
        title: '正在为您分析需求...',
        steps: [
          { label: '意图识别', detail: '理解您的服务需求类型' },
          { label: '实体抽取', detail: '提取时间、地点、服务类型等关键信息' },
          { label: '知识库匹配', detail: '匹配最优服务方案和机构资源' },
        ],
      },
      actions: [],
      followup_suggestions: [],
      template_fit_notes: ['service_thinking_default'],
    });
  }

  if (selectedTemplateId === 'service_intent') {
    const intent = intent_context?.intent || business_data?.intent || '养老服务';
    const confidence = intent_context?.confidence ?? business_data?.confidence ?? 0.92;
    const entities = Array.isArray(intent_context?.entities) && intent_context.entities.length
      ? intent_context.entities
      : (Array.isArray(business_data?.entities) ? business_data.entities : []);
    return sanitizeModelResult({
      template_id: 'service_intent',
      answer_text: `已识别您的需求：${intent}`,
      answer: `已识别您的需求：${intent}`,
      data: {
        badge_type: intent_context?.badge_type || 'service',
        badge_label: intent_context?.badge_label || intent,
        confidence: String(confidence),
        entities,
        level: intent_context?.level || business_data?.level || 'normal',
      },
      actions: [],
      followup_suggestions: [
        { label: '确认理解，继续' },
        { label: '重新描述需求' },
      ],
      template_fit_notes: ['service_intent_from_context'],
    });
  }

  // service_card：从 business_data 提取单个服务信息
  const svc = business_data?.service
    || (Array.isArray(business_data?.services) && business_data.services[0])
    || {};
  const iconMap = [
    { kw: ['清洁', '保洁'], icon: '🧹' },
    { kw: ['餐', '饭', '食', '助餐'], icon: '🍽️' },
    { kw: ['医', '诊', '药', '护', '康复'], icon: '⚕️' },
    { kw: ['浴', '洗', '助浴'], icon: '🚿' },
    { kw: ['行', '车', '送', '陪诊'], icon: '🚗' },
    { kw: ['陪', '伴'], icon: '👥' },
  ];
  const svcText = `${svc.name || ''} ${svc.category || ''}`;
  const icon = svc.icon || (iconMap.find((m) => m.kw.some((k) => svcText.includes(k)))?.icon) || '🏠';
  return sanitizeModelResult({
    template_id: 'service_card',
    answer_text: `为您推荐：${svc.name || business_data?.name || '养老服务'}`,
    answer: `为您推荐：${svc.name || business_data?.name || '养老服务'}`,
    data: {
      icon,
      name: svc.name || business_data?.name || '推荐服务',
      summary: svc.summary || svc.intro || '',
      timeRange: svc.timeRange || svc.time_range || '',
      provider_name: svc.provider_name || svc.org_name || business_data?.provider_name || '',
      provider_score: svc.provider_score || svc.score || '',
      provider_avail: svc.provider_avail || svc.availability || '',
      price: svc.price || business_data?.price || '',
      unit: svc.unit || business_data?.unit || '次',
    },
    actions: [],
    followup_suggestions: [
      { label: '一键预定' },
      { label: '查看详情' },
      { label: '换个服务' },
    ],
    template_fit_notes: ['service_card_from_business_data'],
  });
}

/**
 * SOS 紧急求助卡片
 * 检测到紧急意图时渲染，提供 120 拨号、通知家属、标记安全 三个动作。
 */
function fillServiceEmergencyCard({ message = '', intent_context = {} } = {}) {
  const keywords = Array.isArray(intent_context.keyword_match) && intent_context.keyword_match.length
    ? intent_context.keyword_match.join('、')
    : '紧急求助';
  const emergencyPhone = process.env.SOS_DEFAULT_PHONE || '';
  const emergencyName = process.env.SOS_DEFAULT_NAME || '家属';
  const answerText = `检测到紧急情况（${keywords}），请立即拨打120或通知家属。`;

  return sanitizeModelResult({
    template_id: 'service_emergency',
    answer_text: answerText,
    answer: answerText,
    data: {
      matched_keywords: keywords,
      emergency_phone: emergencyPhone,
      emergency_name: emergencyName,
    },
    actions: [
      { action_key: 'sos.call_120', key: 'sos.call_120', label: '📞 立即拨打120' },
      { action_key: 'sos.notify_family', key: 'sos.notify_family', label: '👪 通知家属' },
    ],
    followup_suggestions: [
      { action_key: 'sos.call_120', key: 'sos.call_120', label: '拨打120', user_prompt: '紧急情况，需要拨打120' },
      { action_key: 'sos.notify_family', key: 'sos.notify_family', label: '通知家属', user_prompt: '紧急情况，需要通知家属' },
    ],
    template_fit_notes: ['sos_emergency_card'],
  });
}

function fillFindServiceCard({ message, business_data, selectedTemplateId }) {
  const bd = business_data || {};
  const catalog = Array.isArray(bd.service_catalog) ? bd.service_catalog : [];
  const orgs = Array.isArray(bd.orgs) ? bd.orgs : [];
  const workers = Array.isArray(bd.workers) ? bd.workers : [];
  const orders = Array.isArray(bd.orders) ? bd.orders : [];
  const tpl = selectedTemplateId || 'service_recommend';
  const msg = String(message || '');
  // ★ 老人身份来自 business_data（登录用户），不硬编码
  const elderName = bd.elder_name || bd.elderName || '';

  if (tpl === 'service_catalog') {
    const byCat = {};
    for (const s of catalog) {
      const cat = s.category || '其他';
      (byCat[cat] = byCat[cat] || []).push(s);
    }
    const categories = Object.entries(byCat).map(([category, items]) => ({
      category,
      items: items.map((s) => ({ name: s.name, price: s.price_from, unit: s.unit, tags: (s.scene_tags || []).join('/') })),
    }));
    const answerText = `为您整理养老服务目录，共 ${catalog.length} 项可预约服务。`;
    return sanitizeModelResult({
      template_id: 'service_catalog',
      answer_text: answerText, answer: answerText,
      data: { sceneTitle: '养老服务目录', total: catalog.length, categories },
      actions: [
        { action_key: 'find_service.recommend', label: '智能推荐', params: {} },
        { action_key: 'find_service.catalog', label: '全部服务', params: {} },
      ],
      followup_suggestions: [],
      template_fit_notes: [],
    });
  }

  if (tpl === 'org_profile') {
    const org = orgs[0] || {};
    const answerText = `为您介绍服务机构：${org.org_name || '桂小养康养中心'}。`;
    return sanitizeModelResult({
      template_id: 'org_profile',
      answer_text: answerText, answer: answerText,
      data: {
        orgName: org.org_name || '桂小养康养中心',
        orgType: org.org_type || 'institution',
        address: org.address || '',
        scope: org.service_scope || '',
        bedCount: org.bed_count || 0,
        price: org.price_from || 0,
        rating: org.rating || 0,
        certified: org.certified ? '已认证' : '未认证',
      },
      actions: [
        { action_key: 'find_service.list_orgs', label: '查看机构', params: {} },
        { action_key: 'find_service.list_workers', label: '查看服务人员', params: { org_id: org.org_id } },
      ],
      followup_suggestions: [],
      template_fit_notes: [],
    });
  }

  if (tpl === 'worker_profile') {
    const w = workers[0] || {};
    const answerText = `为您推荐服务人员：${w.name || '韦芳'}。`;
    return sanitizeModelResult({
      template_id: 'worker_profile',
      answer_text: answerText, answer: answerText,
      data: {
        name: w.name || '韦芳',
        skillTags: (w.skill_tags || []).join('、'),
        certLevel: w.cert_level || '',
        area: w.service_area || '',
        rating: w.rating || 0,
        orderCount: w.order_count || 0,
        available: w.available ? '可接单' : '暂不接单',
      },
      actions: [
        { action_key: 'find_service.list_orgs', label: '看机构', params: {} },
        { action_key: 'find_service.recommend', label: '智能推荐', params: {} },
      ],
      followup_suggestions: [],
      template_fit_notes: [],
    });
  }

  if (tpl === 'order_preview') {
    const svc = catalog[0] || {};
    const org = orgs[0] || {};
    const answerText = `已为您生成「${svc.name || '上门护理'}」服务订单预览，确认后可派单。`;
    return sanitizeModelResult({
      template_id: 'order_preview',
      answer_text: answerText, answer: answerText,
      data: {
        orderId: 'so_new',
        elderName: elderName,
        serviceName: svc.name || '上门护理',
        orgName: org.org_name || '',
        price: svc.price_from || 0,
        unit: svc.unit || '次',
        expectedTime: '请选择上门时间',
        confirmHint: '确认后将自动进入派单调度',
      },
      actions: [
        { action_key: 'find_service.detail_order', label: '查看订单', params: {} },
        { action_key: 'find_service.catalog', label: '全部服务', params: {} },
      ],
      followup_suggestions: [
        { label: '找护工上门', user_prompt: '我想找护工上门护理', action_key: 'find_service.list_workers' },
      ],
      template_fit_notes: [],
    });
  }

  if (tpl === 'order_status') {
    const answerText = `您当前有 ${orders.length} 条服务订单。`;
    return sanitizeModelResult({
      template_id: 'order_status',
      answer_text: answerText, answer: answerText,
      data: {
        total: orders.length,
        orders: orders.map((o) => ({
          orderId: o.order_id, elderName: o.elder_name, serviceName: o.service_name,
          status: o.status, expectedTime: o.expected_time,
        })),
      },
      actions: [
        { action_key: 'find_service.detail_order', label: '订单详情', params: { order_id: orders[0]?.order_id } },
        { action_key: 'dispatch_manage.list', label: '查看派单', params: {} },
      ],
      followup_suggestions: [],
      template_fit_notes: [],
    });
  }

  if (tpl === 'service_detail') {
    const svc = catalog[0] || {};
    const tags = svc.scene_tags || [];
    const features = svc.features || ['专业护理团队', '持证上岗', '上门服务'];
    const answerText = `为您展示「${svc.name || '养老服务'}」详情。`;
    return sanitizeModelResult({
      template_id: 'service_detail',
      answer_text: answerText, answer: answerText,
      data: {
        category: svc.category || '养老服务',
        name: svc.name || '上门护理',
        price_text: svc.price_from ? `${svc.price_from} 元/${svc.unit || '次'}` : '面议',
        intro: svc.description || '由持证护理人员提供专业上门照护服务，涵盖生活照料、健康监测、康复辅助等。',
        has_tags: tags.length > 0,
        tags,
        has_features: features.length > 0,
        features,
        timeRange: svc.time_range || '每日 08:00 - 18:00',
        hotline: svc.hotline || '400-888-0000',
      },
      actions: [
        { action_key: 'find_service.catalog', label: '全部服务', params: {} },
        { action_key: 'find_service.list_orgs', label: '服务机构', params: {} },
      ],
      followup_suggestions: [],
      template_fit_notes: [],
    });
  }

  const org = orgs[0] || {};
  const _serviceIconMap = { '居家照护': '🏠', '居家护理': '🏠', '康复理疗': '🏥', '助餐': '🍽️', '陪护': '🛡️', '清洁': '🧹', '护理': '🩺' };
  const inferServiceIcon = (cat) => {
    if (!cat) return '📋';
    if (_serviceIconMap[cat]) return _serviceIconMap[cat];
    if (cat.includes('餐')) return '🍽️';
    if (cat.includes('康复') || cat.includes('医') || cat.includes('理疗')) return '🏥';
    if (cat.includes('照护') || cat.includes('居家')) return '🏠';
    return '📋';
  };
  const top = catalog.slice(0, 4).map((s) => ({
    id: s.service_id, name: s.name, category: s.category,
    price: s.price_from, unit: s.unit, tags: (s.scene_tags || []).join('/'), desc: s.description,
    icon: inferServiceIcon(s.category),
    summary: s.description || '',
    timeRange: s.time_range || '全天',
    provider_name: org.org_name || s.org_name || '',
    provider_score: String(org.rating || '4.5'),
    provider_avail: '可预约',
  }));
  const w = workers.find((x) => x.available) || workers[0] || {};
  const answerText = `已为您匹配 ${top.length} 项养老服务，并推荐机构「${org.org_name || ''}」与人员「${w.name || ''}」。`;
  return sanitizeModelResult({
    template_id: 'service_recommend',
    answer_text: answerText, answer: answerText,
    data: {
      sceneTitle: '养老服务推荐',
      summary: '根据老人情况为您匹配以下服务',
      services: top,
      total: catalog.length,
      highlightOrg: { name: org.org_name || '', rating: org.rating || 0, scope: org.service_scope || '', price: org.price_from || 0 },
      highlightWorker: { name: w.name || '', skill: (w.skill_tags || []).join('/'), rating: w.rating || 0 },
    },
    actions: [
      { action_key: 'find_service.detail_service', label: '查看详情', params: { service_id: top[0]?.id } },
      { action_key: 'find_service.catalog', label: '全部服务', params: {} },
      { action_key: 'find_service.list_orgs', label: '看机构', params: {} },
    ],
    followup_suggestions: [
      { label: '找护工上门', user_prompt: '我想找护工上门护理', action_key: 'find_service.list_workers' },
      { label: '看养老机构', user_prompt: '有哪些养老机构可以入住', action_key: 'find_service.list_orgs' },
    ],
    template_fit_notes: [],
  });
}

function fillDispatchManageCard({ message, business_data, selectedTemplateId }) {
  const bd = business_data || {};
  const dispatches = Array.isArray(bd.dispatch_orders) ? bd.dispatch_orders : [];
  const orders = Array.isArray(bd.orders) ? bd.orders : [];
  const tpl = selectedTemplateId || 'dispatch_list';
  const msg = String(message || '');

  if (tpl === 'dispatch_detail') {
    const d = dispatches[0] || {};
    const answerText = `派单 ${d.dispatch_id || ''} 当前状态：${d.status || '待接单'}。`;
    return sanitizeModelResult({
      template_id: 'dispatch_detail',
      answer_text: answerText, answer: answerText,
      data: {
        dispatchId: d.dispatch_id || '', orderId: d.order_id || '', workerName: d.worker_name || '',
        skill: d.skill_tag || '', status: d.status || '待接单', createdAt: d.created_at || '',
        acceptedAt: d.accepted_at || '', rejectedReason: d.rejected_reason || '',
      },
      actions: [
        { action_key: 'dispatch_manage.list', label: '返回列表', params: {} },
        { action_key: 'dispatch_manage.status', label: '查看进度', params: { dispatch_id: d.dispatch_id } },
      ],
      followup_suggestions: [],
      template_fit_notes: [],
    });
  }

  if (tpl === 'work_order') {
    const o = orders[0] || {};
    const d = dispatches.find((x) => x.order_id === o.order_id) || {};
    const answerText = `工单 ${o.order_id || ''}：${o.service_name || ''}，状态 ${o.status || ''}。`;
    return sanitizeModelResult({
      template_id: 'work_order',
      answer_text: answerText, answer: answerText,
      data: {
        orderId: o.order_id || '', elderName: o.elder_name || '', serviceName: o.service_name || '',
        orgName: o.org_name || '', status: o.status || '', expectedTime: o.expected_time || '',
        linkedDispatch: d.dispatch_id || '',
      },
      actions: [
        { action_key: 'dispatch_manage.status', label: '查派单进度', params: { order_id: o.order_id } },
        { action_key: 'dispatch_manage.list', label: '返回列表', params: {} },
      ],
      followup_suggestions: [],
      template_fit_notes: [],
    });
  }

  if (tpl === 'dispatch_status') {
    const d = dispatches[0] || {};
    const answerText = `派单 ${d.dispatch_id || ''} 状态已更新为「${d.status || ''}」。`;
    return sanitizeModelResult({
      template_id: 'dispatch_status',
      answer_text: answerText, answer: answerText,
      data: {
        dispatchId: d.dispatch_id || '', status: d.status || '', changedAt: d.accepted_at || d.created_at || '',
        note: d.rejected_reason || '状态正常流转',
      },
      actions: [
        { action_key: 'dispatch_manage.list', label: '返回派单列表', params: {} },
      ],
      followup_suggestions: [],
      template_fit_notes: [],
    });
  }

  const pending = dispatches.filter((d) => d.status === '待接单').length;
  const answerText = `当前共有 ${dispatches.length} 条派单，其中 ${pending} 条待接单。`;
  return sanitizeModelResult({
    template_id: 'dispatch_list',
    answer_text: answerText, answer: answerText,
    data: {
      total: dispatches.length, pending,
      orders: dispatches.map((d) => ({
        dispatchId: d.dispatch_id, orderId: d.order_id, workerName: d.worker_name,
        skill: d.skill_tag, status: d.status, createdAt: d.created_at,
      })),
    },
    actions: [
      { action_key: 'dispatch_manage.detail', label: '派单详情', params: { dispatch_id: dispatches[0]?.dispatch_id } },
      { action_key: 'dispatch_manage.status', label: '查看进度', params: {} },
    ],
    followup_suggestions: [
      { label: '查看工单', user_prompt: '查看对应的服务工单', action_key: 'dispatch_manage.work_order' },
    ],
    template_fit_notes: [],
  });
}

function fillMealTimelineCard({ message }) {
  const meals = [
    { mealName: '早餐', mealEmoji: '🌅', mealTime: '07:00', mealTotal: '约320kcal', dotCls: 'dot-breakfast',
      foods: [{ foodName: '小米粥', cal: 120 }, { foodName: '水煮蛋', cal: 70 }, { foodName: '全麦面包', cal: 130 }] },
    { mealName: '午餐', mealEmoji: '☀️', mealTime: '12:00', mealTotal: '约520kcal', dotCls: 'dot-lunch',
      foods: [{ foodName: '杂粮饭', cal: 200 }, { foodName: '清蒸鱼', cal: 180 }, { foodName: '青菜', cal: 140 }] },
    { mealName: '晚餐', mealEmoji: '🌙', mealTime: '18:00', mealTotal: '约430kcal', dotCls: 'dot-dinner',
      foods: [{ foodName: '番茄豆腐汤', cal: 150 }, { foodName: '时蔬', cal: 120 }, { foodName: '燕麦粥', cal: 160 }] },
  ];
  return sanitizeModelResult({
    template_id: 'meal_timeline_card',
    answer_text: '已为老人安排今日饮食时间线',
    data: { bannerTitle: '今日饮食时间线', meals, ratios: [{ label: '碳水', pct: 55 }, { label: '蛋白', pct: 25 }, { label: '脂肪', pct: 20 }] },
    actions: [], followup_suggestions: [],
  });
}

function fillMealOverviewCard({ message }) {
  return sanitizeModelResult({
    template_id: 'meal_overview_card',
    answer_text: '本周膳食概览',
    data: { title: '本周膳食概览', totalCalories: '约8400kcal', avgDaily: '约1200kcal', days: 7, compliance: '90%', related: [], hasRelated: false },
    actions: [], followup_suggestions: [],
  });
}

function fillSojournBase({ message, business_data }) {
  const jtd = business_data?.jtd || {};
  const rawProducts = (Array.isArray(jtd.products) ? jtd.products : []).slice(0, 3);
  const bases = rawProducts.map((p) => {
    const location = p.destination || p.city || '防城港';
    const featureList = Array.isArray(p.tags) && p.tags.length ? p.tags : (p.features || ['慢病康复', '海滨气候']);
    const facts = [];
    for (let i = 0; i < featureList.length; i += 2) {
      facts.push({ label: featureList[i] || '', value: featureList[i + 1] || '' });
    }
    return {
      name: p.product_name || p.name || p.title || '康养基地',
      location,
      address: location,
      price: p.price_label || (p.price_amount ? `约${p.price_amount}元/人` : '面议'),
      features: featureList,
      facts: facts.length > 0 ? facts : undefined,
      product_id: p.product_id || '',
      stock: p.stock ?? null,
    };
  });
  const finalBases = bases.length ? bases : [{ name: '防城港滨海康养中心', location: '防城港', address: '防城港', price: '3000元/月起', features: ['慢病康复', '海滨气候'], facts: [{ label: '慢病康复', value: '海滨气候' }], product_id: '', stock: null }];
  const primaryDest = finalBases[0]?.location || '防城港';
  // 统一用 map-kit 构建基地中心地图数据（base 模式）
  const mapData = buildBaseMapDataFromKit({ destination: primaryDest, bases: finalBases });
  const sourceStatus = jtd.source_status || (jtd.ok ? 'real_data' : 'fallback');
  const answerText = sourceStatus === 'real_data'
    ? `已为您推荐 ${finalBases.length} 个康养基地。`
    : '为您推荐以下康养基地';
  return sanitizeModelResult({
    template_id: 'sojourn_base',
    answer_text: answerText,
    data: {
      title: '康养基地推荐',
      bases: finalBases,
      jtdStatus: sourceStatus,
      ...mapData,
    },
    actions: [],
    followup_suggestions: [],
    template_fit_notes: [`jtd_${sourceStatus}`],
  });
}

// 兼容别名：fillTravelBaseCard → fillSojournBase（保持向后兼容）
const fillTravelBaseCard = fillSojournBase;

function fillTravelSpotCard({ message, business_data }) {
  const route = Array.isArray(business_data?.routes) ? business_data.routes[0] : null;
  const destination = sanitizeText(
    business_data?.primary_city
    || route?.destination
    || inferDestination(message)
    || '防城港',
  );
  // 默认适老化景点数据（可被 business_data.spots 覆盖）
  const defaultSpots = [
    {
      name: '西湾城市沙滩 & 仙人山公园',
      tags: [{ cls: 'free', label: '免费' }, { cls: 'trip', label: '半日短途' }],
      desc: '城市海景 + 山体步道，适合晨练和傍晚散步',
      play: '仙人山公园平缓步道晨练，观海平台休息',
      meta: '步行/打车10分钟 · 半日（上午或傍晚）',
    },
    {
      name: '白浪滩',
      tags: [{ cls: 'free', label: '免费' }, { cls: 'trip', label: '全天长途' }],
      desc: '防城港知名海滩，沙质细腻，浪小水浅',
      play: '沙滩躺椅休息，观海听浪，平缓栈道漫步',
      meta: '包车/打车约40分钟 · 全天',
    },
    {
      name: '十万大山布透温泉',
      tags: [{ cls: 'fee', label: '收费' }, { cls: 'trip', label: '全天长途' }],
      desc: '天然偏硅酸温泉，理疗养生价值高',
      play: '温泉泡浴理疗，缓解关节酸痛，室内外泡池可选',
      meta: '包车约1小时 · 全天',
    },
  ];
  const spots = Array.isArray(business_data?.spots) && business_data.spots.length
    ? business_data.spots.slice(0, 6)
    : defaultSpots;
  // 景点精确坐标缺失时，使用目的地中心坐标作为近似位置（保证地图可显示）
  const spotMarkers = spots.map((s) => {
    const coord = s.lat && s.lng ? { lat: Number(s.lat), lng: Number(s.lng) } : getTravelDestinationCoord(destination);
    return { name: s.name, lat: coord.lat, lng: coord.lng, address: s.meta || destination, cat: 'spot' };
  });
  const mapData = buildTravelMapData(destination, spotMarkers);
  return sanitizeModelResult({
    template_id: 'travel_spot_card',
    answer_text: `为您精选${spots.length}个${destination}适老化景点`,
    data: {
      title: '适老化景点推荐',
      intro: `为您精选${spots.length}个${destination}适老化景点，已自动过滤高强度攀爬路线：`,
      spots,
      note: '景点开放时间和票价以现场为准；建议避开正午暴晒，保留充足休息时间。',
      ...mapData,
    },
    actions: [], followup_suggestions: [],
  });
}

function fillTravelMedicalCard({ message, business_data }) {
  const route = Array.isArray(business_data?.routes) ? business_data.routes[0] : null;
  const destination = sanitizeText(
    business_data?.primary_city
    || route?.destination
    || inferDestination(message)
    || '防城港',
  );
  const defaultGroups = [
    {
      icon: '🏥',
      name: '就近医疗',
      items: [{ text: '首选基地距市第一人民医院仅 800m，步行可达' }],
    },
    {
      icon: '💊',
      name: '便民购药',
      items: [{ text: '基地楼下 200m 有仁爱大药房，常见药品齐全' }],
    },
    {
      icon: '🚗',
      name: '出行协助',
      items: [{ text: '基地管家可协助叫车、预约诊所' }],
    },
  ];
  const groups = Array.isArray(business_data?.medical_groups) && business_data.medical_groups.length
    ? business_data.medical_groups
    : defaultGroups;
  // 医疗机构精确坐标缺失时，使用目的地中心坐标作为近似位置
  const medicalMarkers = groups.map((g) => {
    const coord = g.lat && g.lng ? { lat: Number(g.lat), lng: Number(g.lng) } : getTravelDestinationCoord(destination);
    return { name: g.name, lat: coord.lat, lng: coord.lng, address: destination, cat: 'medical' };
  });
  const mapData = buildTravelMapData(destination, medicalMarkers);
  return sanitizeModelResult({
    template_id: 'travel_medical_card',
    answer_text: `${destination}医养配套方案`,
    data: {
      title: '医养配套方案',
      intro: `为您推荐的${destination}基地均具备基础康养配套：`,
      groups,
      tip: '💡 常规酒店无驻场医护，建议选择近市区医院的康养基地。建议自备基础检测设备。',
      note: '⚠️ 以上仅为就医、购药、体征检测便民渠道建议，不构成专业医疗诊断。',
      ...mapData,
    },
    actions: [], followup_suggestions: [],
  });
}

function fillRouteCardLegacy({ message, business_data, selectedTemplateId }) {
  const routes = Array.isArray(business_data?.routes) ? business_data.routes : [];
  const forcedRouteId = String(
    business_data?.route_id || business_data?.publish_match?.route_id || ''
  ).trim();

  // 第二刀：优先按 published route_id 取包，避免 routes[0]（常为巴马）盖住真实命中
  let matchedRouteId = forcedRouteId;
  let svgPkg = forcedRouteId ? findPrebuiltPackage(forcedRouteId, 'standard') : null;
  const inferredEarly = inferDestination(message);
  const rejectCrossCityPublish = (hit) => {
    if (!hit || !inferredEarly) return false;
    const destBlob = JSON.stringify(hit.meta?.destination || hit.route_id || '');
    // 嘉路/防城港话术不得锁巴马包；巴马话术不得锁北海/防城港包
    if (/防城港/.test(inferredEarly) && /巴马|百魔洞|bama/i.test(destBlob) && !/巴马|百魔洞/.test(message)) return true;
    if (/巴马/.test(inferredEarly) && /(北海|防城港|东兴)/.test(destBlob) && !/(北海|防城港|东兴)/.test(message)) return true;
    if (/北海/.test(inferredEarly) && /巴马|百魔洞|bama/i.test(destBlob) && !/巴马|百魔洞/.test(message)) return true;
    return false;
  };
  if (!svgPkg?.svg) {
    const hits = matchPublishedPackages(message).filter((h) => !rejectCrossCityPublish(h));
    const top = hits[0];
    const second = hits[1];
    if (top && (!second || top.score > second.score)) {
      matchedRouteId = top.route_id;
      svgPkg = findPrebuiltPackage(top.route_id, 'standard');
    }
  } else if (forcedRouteId && rejectCrossCityPublish({
    route_id: forcedRouteId,
    meta: business_data?.publish_match || {},
  })) {
    matchedRouteId = '';
    svgPkg = null;
  }

  const inferredDest = inferDestination(message);
  const route = selectTravelRoute(message, routes);
  const pkgDestRaw = svgPkg?.routeData?.destination
    || (Array.isArray(business_data?.publish_match?.destination)
      ? business_data.publish_match.destination[0]
      : null)
    || (Array.isArray(business_data?.destination) ? business_data.destination[0] : business_data?.destination);
  const destination = sanitizeText(
    pkgDestRaw || inferredDest || route?.destination || '广西旅居'
  );

  if (!svgPkg?.svg) {
    svgPkg = findPrebuiltPackageByDestination(destination, 'standard') || svgPkg;
  }

  const budgetLevel = sanitizeText(route?.budget_level || inferBudget(message));
  const season = sanitizeText(route?.season || inferSeason(message));
  const bookingStatus = sanitizeText(route?.booking_status || '可咨询余量');
  const healthTags = sanitizeText(route?.health_tags || '慢病友好,低强度,医疗可达');

  // ★ 产品模板库分类：优先使用编排器推断的模板ID，其次按关键词匹配
  const productMatch = selectProductTemplate(message, destination);
  const routeType = ['route_wellness', 'route_coastal', 'route_culture', 'route_ecology'].includes(selectedTemplateId)
    ? selectedTemplateId
    : (productMatch?.id || 'route_wellness');
  const productSample = productMatch?.sample || {};
  const sampleOk = isSampleCompatibleWithDestination(productSample, destination)
    || isSampleCompatibleWithDestination(productSample, message);

  let staticSvg = '';
  if (svgPkg && svgPkg.svg) {
    staticSvg = svgPkg.svg;
  } else {
    staticSvg = `<div style="padding:20px;text-align:center;color:#999;">地图加载中...</div>`;
  }

  // 优先用预制作资源包；示例数据仅在与目的地同城时使用，禁止「北海目的地 + 巴马行程」
  const resolvedRouteId = matchedRouteId || svgPkg?.routeData?.route_id || '';
  const routeTitle = svgPkg?.routeData?.route_name
    || business_data?.route_title
    || (sampleOk ? productSample.routeTitle : '')
    || `${destination.replace(/^广西/, '')}旅居路线`;
  const highlights = (svgPkg?.routeData?.highlights?.length
    ? svgPkg.routeData.highlights
    : (sampleOk && productSample.highlights?.length ? productSample.highlights : buildTravelHighlights(healthTags, destination)));
  const itinerary = (svgPkg?.routeData?.itinerary?.length
    ? svgPkg.routeData.itinerary
    : (sampleOk && productSample.itinerary?.length ? productSample.itinerary : buildItinerary(destination)));
  const daysLabel = svgPkg?.routeData?.days
    ? (String(svgPkg.routeData.days).includes('天') ? String(svgPkg.routeData.days) : `${svgPkg.routeData.days}天`)
    : (sampleOk && productSample.days)
      ? productSample.days
      : (/四天|4天|five/i.test(message) ? '4天3晚' : `${Math.max(itinerary.length, 3)}天${Math.max(itinerary.length - 1, 2)}晚`);
  const answerText = `已为您推荐${routeTitle}，按${budgetLevel}和老人低强度出行节奏规划。`;
  const rawWaypoints = Array.isArray(svgPkg?.routeData?.waypoints)
    ? svgPkg.routeData.waypoints
    : (Array.isArray(business_data?.waypoints) ? business_data.waypoints : []);
  const waypointSpots = enrichWaypointsFromDashboardKb(rawWaypoints);
  const waypointSpotsJson = JSON.stringify(waypointSpots.map((wp) => ({
    name: wp?.name || '',
    day: wp?.day || '',
    plan: wp?.plan || '',
    spot_desc: wp?.spot_desc || '',
    spot_images: Array.isArray(wp?.spot_images) ? wp.spot_images : [],
    related_spots: Array.isArray(wp?.related_spots) ? wp.related_spots : [],
  })));

  return sanitizeModelResult({
    template_id: routeType || 'route_svg',
    answer_text: answerText,
    answer: answerText,
    data: {
      route_id: resolvedRouteId,
      routeTitle,
      routeType,
      destination,
      season,
      budgetLevel,
      days: daysLabel,
      suitable: sanitizeText(
        svgPkg?.routeData?.suitable_for
        || (sampleOk ? productSample.suitable : '')
        || inferTravelSuitable(message)
      ),
      bookingStatus,
      summary: sanitizeText(
        svgPkg?.routeData?.summary
        || (sampleOk ? productSample.summary : '')
        || buildRouteSummary(destination, budgetLevel)
      ),
      highlights,
      itinerary,
      healthNotice: buildTravelHealthNotice(message),
      static_svg: staticSvg,
      waypoint_spots_json: waypointSpotsJson,
      hasSpots: waypointSpots.some((wp) => (wp?.spot_images || []).length > 0 || (wp?.spot_desc || '').length > 0),
      publish_match: business_data?.publish_match || null,
    },
    actions: [
      { action_key: 'travel_route.compare_destinations', label: '对比目的地', skill_key: 'travel_route', params: { destination } },
      { action_key: 'travel_route.check_availability', label: '检查可订状态', skill_key: 'travel_route', params: { destination } },
      { action_key: 'travel_route.calculate_budget', label: '测算旅居预算', skill_key: 'travel_route', params: { budget_level: budgetLevel } },
    ],
    followup_suggestions: [
      {
        label: '换成北海路线',
        user_prompt: '请把这条旅居路线调整为广西北海方向',
        action_key: 'travel_route.replan',
        skill_key: 'travel_route',
      },
      {
        label: '查天气风险',
        user_prompt: '请检查这条旅居路线近期天气风险',
        action_key: 'travel_route.check_weather_risk',
        skill_key: 'travel_route',
        params: { destination, city: destination },
      },
    ],
    template_fit_notes: [],
  });
}

function selectTravelRoute(message, routes) {
  const text = String(message || '');
  if (/防城港|东兴|京族|芒街|白浪滩|十万大山|嘉路/.test(text)) {
    return routes.find((route) => /防城港|东兴/.test(String(route.destination || ''))) || null;
  }
  if (/北海|海边|海滨|银滩|涠洲/.test(text)) {
    return routes.find((route) => /北海/.test(String(route.destination || ''))) || null;
  }
  if (/巴马|长寿|百魔洞/.test(text)) {
    return routes.find((route) => /巴马/.test(String(route.destination || ''))) || null;
  }
  if (/桂林|阳朔|荔浦/.test(text)) {
    return routes.find((route) => /桂林/.test(String(route.destination || ''))) || null;
  }
  // 话语已能推断目的地时，不要静默落到 routes[0]（常见默认巴马）
  if (inferDestination(message)) return null;
  return routes[0] || null;
}

function inferDestination(message) {
  // 优先匹配明确的城市名
  if (/防城港|东兴|嘉路|白浪滩|簕山|京族|十万大山|上思/.test(message)) return '广西防城港';
  if (/北海/.test(message)) return '广西北海';
  if (/桂林/.test(message)) return '广西桂林';
  if (/南宁/.test(message)) return '广西南宁';
  if (/巴马/.test(message)) return '广西巴马';
  if (/昆明/.test(message)) return '云南昆明';
  if (/大理/.test(message)) return '云南大理';
  if (/丽江/.test(message)) return '云南丽江';
  if (/三亚/.test(message)) return '海南三亚';
  if (/海口/.test(message)) return '海南海口';
  if (/厦门/.test(message)) return '福建厦门';
  // 如果没有匹配到，返回 null，让调用者使用其他来源
  return null;
}

function inferBudget(message) {
  if (/经济|便宜|低预算/.test(message)) return '经济型';
  if (/高端|舒适|品质/.test(message)) return '舒适型';
  return '舒适型';
}

function inferSeason(message) {
  if (/夏|避暑/.test(message)) return '夏季避暑';
  if (/冬|过冬|秋冬/.test(message)) return '秋冬适宜';
  return '全年可评估';
}

function inferTravelSuitable(message) {
  if (/轮椅|无障碍/.test(message)) return '无障碍需求老人、家属陪同';
  if (/慢病|血压|糖尿病|心脏/.test(message)) return '慢病老人、家属陪同';
  return '低强度旅居老人、家属陪同';
}

function buildRouteSummary(destination, budgetLevel) {
  return `结合${destination}气候、医疗可达性和交通接驳，按${budgetLevel}推荐低强度康养旅居安排。`;
}

function buildRouteCardSummary({ product, productName, destination, jtd, priceLabel, budgetLevel }) {
  if (!product) return buildRouteSummary(destination, budgetLevel);
  const src = jtd.source_status === 'real_data' ? '已核验数据' : '演示数据';
  const priceText = priceLabel ? `参考价${priceLabel}；` : '';
  return `${productName || destination}；${priceText}来源=${src}；产品ID=${product.product_id || '待确认'}。`;
}

function buildTravelHighlights(healthTags, destination) {
  const tags = healthTags.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  const dest = String(destination || '');
  let placeTags = ['康养基地', '家属可陪同'];
  if (/北海/.test(dest)) placeTags = ['银滩慢行', '海鲜养生餐', '海滨低强度'];
  else if (/防城港|东兴|京族/.test(dest)) placeTags = ['白浪滩漫步', '京族滨海文化', '边境风情'];
  else if (/巴马/.test(dest)) placeTags = ['负氧离子', '长寿乡漫步', '低强度康养'];
  else if (/桂林|阳朔/.test(dest)) placeTags = ['漓江慢游', '喀斯特风光', '适老步道'];
  return [...new Set([...tags, ...placeTags])].slice(0, 5);
}

function resolveTravelDuration({ product = {}, title = '', message = '', fallbackDays = 3 } = {}) {
  const productDays = positiveInt(product?.days);
  const productNights = positiveInt(product?.nights);
  const daysFromProduct = productDays || (productNights ? productNights + 1 : 0);
  const daysFromTitle = extractDurationDays(title);
  const daysFromMessage = extractDurationDays(message);
  const totalDays = clampTripDays(daysFromProduct || daysFromTitle || daysFromMessage || fallbackDays);
  return {
    daysFromProduct,
    daysFromTitle,
    daysFromMessage,
    totalDays,
  };
}

function extractDurationDays(text) {
  const value = String(text || '');
  const digitMatch = value.match(/(\d+)\s*(?:天|日)/);
  if (digitMatch) return clampTripDays(Number(digitMatch[1]));
  const chineseMatch = value.match(/([一二两三四五六七八九十]{1,4})\s*(?:天|日)/);
  if (chineseMatch) return clampTripDays(chineseNumberToInt(chineseMatch[1]));
  if (/一周|七天|7\s*天/.test(value)) return 7;
  return 0;
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function clampTripDays(value) {
  const number = positiveInt(value);
  if (!number) return 0;
  return Math.max(1, Math.min(30, number));
}

function chineseNumberToInt(text) {
  const value = String(text || '').replace(/两/g, '二');
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === '十') return 10;
  const tenIndex = value.indexOf('十');
  if (tenIndex >= 0) {
    const high = tenIndex === 0 ? 1 : digits[value.slice(0, tenIndex)] || 0;
    const lowText = value.slice(tenIndex + 1);
    const low = lowText ? digits[lowText] || 0 : 0;
    return high * 10 + low;
  }
  return digits[value] || 0;
}

function buildItinerary(destination, days = 3) {
  const dest = String(destination || '旅居目的地');
  const totalDays = Math.max(1, Math.min(30, parseInt(days, 10) || 3));

  if (/北海/.test(dest)) {
    const beihai = [
      { day: 'D1', wp_name: '北海市区', plan: '抵达北海，入住海滨酒店，银滩晚风慢行与健康确认。' },
      { day: 'D2', wp_name: '银滩/老街', plan: '银滩漫步或北海老街轻游，海鲜养生餐，午休充足。' },
      { day: 'D3', wp_name: '海滨返程', plan: '海滨晨练或短途观海后返程，预留交通缓冲。' },
      { day: 'D4', wp_name: '涠洲补给日', plan: '可选涠洲岛低强度环岛，避免赶船赶程。' },
    ];
    return beihai.slice(0, totalDays);
  }
  if (/防城港|东兴|京族/.test(dest)) {
    const fcg = [
      { day: 'D1', wp_name: '防城港市区', plan: '抵达防城港，入住海滨住宿，白浪滩轻行。' },
      { day: 'D2', wp_name: '京族三岛', plan: '京族文化体验与滨海慢行，午后充分休息。' },
      { day: 'D3', wp_name: '东兴口岸', plan: '边境口岸观光后返程，预留交通缓冲。' },
    ];
    return fcg.slice(0, totalDays);
  }

  const itinerary = [];
  for (let i = 0; i < totalDays; i++) {
    const dayNum = i + 1;
    let plan = '';
    if (i === 0) {
      plan = `抵达${dest}，办理入住，完成健康情况确认，安排轻松周边散步。`;
    } else if (i === totalDays - 1) {
      plan = '根据体力选择短途游览或返程，预留交通缓冲，避免赶行程。';
    } else {
      plan = `第${dayNum}天康养活动或基地体验，下午低强度游览，晚间保留充分休息时间。`;
    }
    itinerary.push({ day: `D${dayNum}`, plan });
  }
  return itinerary;
}

function buildTravelHealthNotice(message) {
  if (/糖尿病|血糖/.test(message)) return '建议随身携带降糖药和加餐，避免空腹长时间步行，确认基地可提供清淡餐食。';
  if (/血压|高血压/.test(message)) return '建议出行前确认血压稳定，避开高温暴晒和紧凑行程，随身携带常用药。';
  return '建议出行前确认慢病状态稳定，携带常用药，优先选择医疗可达、活动强度低的路线。';
}

async function fillRouteCard({ message, business_data }) {
  const routes = Array.isArray(business_data?.routes) ? business_data.routes : [];
  const jtd = business_data?.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);

  // 旅居基地分流：product_domain=sojourn_base 时转交 fillSojournBase，使用 sojourn_base 模板
  const productDomain = jtd.product_domain || product?.product_domain || '';
  if (productDomain === 'sojourn_base') {
    return fillSojournBase({ message, business_data });
  }

  if (jtd.required === true && !product && jtd.source_status !== 'mock_vendor_data') {
    return fillRouteRemoteGap({ message, jtd, routes });
  }

  const route = selectTravelRoute(message, routes);
  // destination 优先级：产品 destination > 产品 city > 业务上下文 primary_city > 路线 > 从消息推断 > 默认推荐（广西巴马）
  const destination = sanitizeText(
    product?.destination
    || product?.city
    || business_data?.primary_city
    || route?.destination
    || inferDestination(message)
    || '广西巴马'
  );
  const budgetLevel = sanitizeText(route?.budget_level || inferBudget(message));
  const priceLabel = sanitizeText(product?.price_label || '');
  const season = sanitizeText(route?.season || inferSeason(message));
  const productName = sanitizeText(product?.product_name || '');
  // routeTitle 智能拼接：产品名已含"康养/旅居/路线/线路/行程"关键词时直接用，避免重复
  const routeTitle = (() => {
    if (!productName) return `${destination}康养旅居路线`;
    if (/(康养|旅居|路线|线路|行程)/.test(productName)) return productName;
    return `${productName}康养旅居路线`;
  })();

  // ★ 产品模板库分类：根据消息+目的地匹配产品类型（康养/滨海/文化/生态）
  const productMatch = selectProductTemplate(`${routeTitle} ${message}`, destination);
  const routeType = productMatch?.id || 'route_wellness';
  const bookingStatus = sanitizeText(buildJtdBookingStatus(jtd, product, route));
  const healthTags = sanitizeText((Array.isArray(product?.tags) && product.tags.length ? product.tags.join(',') : '') || route?.health_tags || '慢病友好,低强度,医疗可达');
  
  // 从可信结构化字段、产品标题和用户输入依次提取总天数。
  // 注意：JTD routeProduct.dayNumber 表示“第几日”，不是产品总天数，不能当 duration。
  const { totalDays } = resolveTravelDuration({ product, title: productName, message, fallbackDays: 3 });
  
  const answerText = product
    ? (jtd.data_source === 'local_routes'
        ? `已为您匹配到${productName || destination}，本线路为防城港官方认证旅居线路。`
        : jtd.source_status === 'real_data'
        ? `已为您匹配到${productName || destination}，可继续查看详情或做可售校验。`
        : `已为您匹配到${productName || destination}（演示数据），实际可订状态请以最终核验为准。`)
    : `已为您推荐${destination}康养旅居路线，按${budgetLevel}和老人低强度出行节奏规划。`;
  const productParams = product ? {
    product_id: product.product_id,
    sku_id: product.sku_id,
    destination,
    source_status: jtd.source_status,
  } : { destination };

  const compactFollowups = [
    {
      label: '查天气风险',
      action_key: 'travel_route.check_weather_risk',
      skill_key: 'travel_route',
      params: { city: destination },
      input: {
        type: 'select',
        placeholder: '选择查询天数',
        param_key: 'days',
        options: [
          { value: '3', label: '未来3天' },
          { value: '7', label: '未来一周' },
          { value: '15', label: '未来15天' },
        ],
      },
    },
  ];

  // 注入走线版地图数据：途经点 + Polyline 路径 + 腾讯路径规划 URL
  // 统一用 map-kit 构建地图数据（走线模式 route）
  const jtdWaypoints = Array.isArray(jtd.waypoints) && jtd.waypoints.length ? jtd.waypoints : null;
  let routeMapData;
  let waypoints;
  if (jtdWaypoints) {
    // 用 jtd-service 已生成的 waypoints（含景点图层），map-kit 会自动脱敏 + 构建 polyline
    routeMapData = buildRouteMapDataFromKit({ destination, waypoints: jtdWaypoints, routeId: product?.product_id });
    waypoints = routeMapData.waypoints || [];
  } else {
    // 无 jtd waypoints 时自生成（基于目的地模板）
    routeMapData = buildRouteMapData(destination, totalDays);
    waypoints = routeMapData.waypoints || [];
  }

  // ★ 实时SVG生成：若 map-kit 未命中预制作资源包（static_svg 为空），用 generateRouteHtml 生成
  if (!routeMapData.static_svg && waypoints.length > 0) {
    try {
      const routeName = routeTitle || `${destination}康养旅居`;
      const genResult = await generateRouteHtml(routeName, summary || routeName, {
        waypoints: waypoints.map((wp) => ({
          name: wp.name,
          lat: wp.lat,
          lng: wp.lng,
          type: wp.type || 'spot',
          day: wp.day || '',
          plan: wp.plan || '',
          spot_images: wp.spot_images || [],
          spot_desc: wp.spot_desc || '',
        })),
        destination,
        season,
        budgetLevel,
        priceLabel,
        suitable: suitableText,
        highlights,
        itinerary: itinerary.map((it) => ({ day: it.time || '', wp_name: it.wp_name || '', plan: it.content || '' })),
        healthNotice: buildTravelHealthNotice(message),
      });
      routeMapData.static_svg = genResult.svg;
    } catch (e) {
      // 实时生成失败时保持原行为（空 SVG）
    }
  }
  // 提取所有特色景点（用于独立景点图层 + 景点列表展示）
  const allSpots = waypoints.flatMap((wp) => (wp.spots || []).map(({ source: _omit, ...s }) => ({ ...s, parent_waypoint: wp.name, parent_day: wp.day })));
  const spotImages = waypoints.flatMap((wp) => wp.spot_images || []).slice(0, 4);
  const spotStatus = waypoints.find((wp) => wp.spot_status)?.spot_status || '';
  // 行程附加途经点名称（wp_name），与走线地图联动
  // 本地线路（防城港5条）有结构化 itinerary，优先使用；但必须与 destination 同城
  const productContentOk = !product || isSampleCompatibleWithDestination({
    destination: product.destination || product.city || '',
    routeTitle: product.product_name || '',
    highlights: product.highlights || [],
    itinerary: product.itinerary || [],
  }, destination);
  const itinerary = productContentOk && Array.isArray(product?.itinerary) && product.itinerary.length
    ? product.itinerary.map((item, i) => ({
        time: item.time || '',
        content: item.content || '',
        note: item.note || '',
        wp_name: waypoints[i]?.name || '',
      }))
    : buildItinerary(destination, totalDays).map((item, i) => ({
        ...item,
        wp_name: waypoints[i]?.name || item.wp_name || '',
      }));

  // 本地线路有结构化 highlights / summary / suitable_for，优先使用
  const summary = productContentOk && product?.summary
    ? sanitizeText(product.summary)
    : buildRouteCardSummary({ product: productContentOk ? product : null, productName: productContentOk ? productName : '', destination, jtd, priceLabel, budgetLevel });
  const highlights = productContentOk && Array.isArray(product?.highlights) && product.highlights.length
    ? product.highlights
    : buildTravelHighlights(healthTags, destination);
  const suitableText = productContentOk && product?.suitable_for
    ? sanitizeText(product.suitable_for)
    : inferTravelSuitable(message);

  return sanitizeModelResult({
    template_id: routeType || 'route_svg',
    answer_text: answerText,
    answer: answerText,
    data: {
      routeTitle,
      routeType,
      destination,
      season,
      budgetLevel,
      priceLabel,
      days: /四天|4天|four/i.test(message) ? '4天3晚' : `${totalDays}天${totalDays - 1}晚`,
      suitable: suitableText,
      bookingStatus,
      summary,
      highlights,
      itinerary,
      healthNotice: buildTravelHealthNotice(message),
      jtdStatus: jtd.source_status || '',
      dataSource: jtd.data_source || '',
      productId: product?.product_id || '',
      skuId: product?.sku_id || '',
      comboPrice: jtd.combo_price || '',
      discount: jtd.discount || '',
      ...routeMapData,
      // Tavily 特色景点图层（独立 JSON + 图层数据）
      spots_json: JSON.stringify(allSpots),
      spots: allSpots,
      spot_images: spotImages,
      spot_images_json: JSON.stringify(spotImages),
      spot_status: spotStatus,
      hasSpots: allSpots.length > 0 || waypoints.some((wp) => (wp?.spot_images || []).length > 0 || (wp?.spot_desc || '').length > 0),
      waypoint_spots_json: JSON.stringify(enrichWaypointsFromDashboardKb(waypoints || []).map((wp) => ({
        name: wp?.name || '',
        day: wp?.day || '',
        plan: wp?.plan || '',
        spot_desc: wp?.spot_desc || '',
        spot_images: Array.isArray(wp?.spot_images) ? wp.spot_images : [],
        related_spots: Array.isArray(wp?.related_spots) ? wp.related_spots : [],
      }))),
    },
    actions: [
      { action_key: 'travel_route.compare_destinations', label: '对比目的地', skill_key: 'travel_route', params: productParams },
      ...(product ? [{ action_key: 'travel_route.check_availability', label: '检查可订状态', skill_key: 'travel_route', params: productParams }] : []),
      { action_key: 'travel_route.calculate_budget', label: '测算旅居预算', skill_key: 'travel_route', params: { ...productParams, budget_level: budgetLevel } },
    ],
    followup_suggestions: [
      {
        label: '换成北海路线',
        user_prompt: '请把这条旅居路线调整为广西北海方向',
        action_key: 'travel_route.replan',
        skill_key: 'travel_route',
      },
      {
        label: '查天气风险',
        user_prompt: '请检查这条旅居路线近期天气风险',
        action_key: 'travel_route.check_weather_risk',
        skill_key: 'travel_route',
        params: { city: destination },
      },
    ],
    compact_followups: compactFollowups,
    template_fit_notes: product ? [`jtd_${jtd.source_status || 'unknown'}`] : [],
  });
}

function fillTravelAvailabilityCard({ message, business_data }) {
  const routes = Array.isArray(business_data?.routes) ? business_data.routes : [];
  const jtd = business_data?.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);
  const route = selectTravelRoute(message, routes);
  const normalized = jtd.availability?.normalized || null;
  const destination = sanitizeText(
    product?.destination
    || product?.city
    || business_data?.primary_city
    || route?.destination
    || inferDestination(message)
    || '旅居目的地',
  );
  const productName = sanitizeText(product?.product_name || product?.name || `${destination}旅居产品`);
  const productId = sanitizeText(product?.product_id || '');
  const skuId = sanitizeText(product?.sku_id || '');
  const stockValue = normalized?.stock ?? product?.stock ?? null;
  const priceValue = normalized?.final_price ?? product?.price_amount ?? null;
  const sourceStatus = normalized?.source_status || jtd.source_status || 'unavailable';
  const isMock = sourceStatus === 'mock_vendor_data';
  const hasAvailability = Boolean(jtd.availability);
  const isAvailable = Boolean(normalized?.available);
  const availabilityLevel = !hasAvailability || sourceStatus === 'unavailable'
    ? 'unknown'
    : isMock
    ? 'mock'
    : isAvailable
    ? 'available'
    : 'unavailable';
  const availabilityStatus = availabilityStatusText({ hasAvailability, isAvailable, isMock, sourceStatus });
  const availabilityMessage = availabilityMessageText({ hasAvailability, isAvailable, isMock, sourceStatus, jtd });
  const checkWindow = buildAvailabilityWindow(jtd.availability?.request || {}, message);
  const answerText = `${productName}：${availabilityStatus}`;
  const productParams = {
    product_id: productId,
    sku_id: skuId,
    destination,
    source_status: sourceStatus,
  };

  return sanitizeModelResult({
    template_id: 'travel_availability_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      availabilityTitle: `${destination}旅居产品可订状态`,
      availabilityStatus,
      availabilityLevel,
      availabilityMessage,
      stockLabel: stockValue === null || stockValue === undefined || stockValue === '' ? '待接口确认' : String(stockValue),
      priceLabel: priceValue ? `约${priceValue}元/人` : sanitizeText(product?.price_label || '待接口确认'),
      checkWindow,
      sourceLabel: jtd.data_source === 'local_routes'
        ? '官方认证线路'
        : sourceStatus === 'real_data'
        ? '已核验数据'
        : sourceStatus === 'mock_vendor_data'
        ? '演示数据'
        : '数据待确认',
      productName,
      destination,
      productId: productId || '待接口返回',
      skuId: skuId || '待接口返回',
      nextStep: nextAvailabilityStep({ hasAvailability, isAvailable, isMock, sourceStatus, jtd }),
      jtdStatus: jtd.source_status || '',
      availabilitySourceStatus: sourceStatus,
      availabilityAvailable: isAvailable,
      availabilityRaw: normalized?.raw || {},
      handoffUrls: {
        h5_order_url: normalized?.h5_order_url || product?.handoff_urls?.h5_order_url || '',
        h5_product_url: normalized?.h5_product_url || product?.handoff_urls?.h5_product_url || '',
        mini_program_url: normalized?.mini_program_url || product?.handoff_urls?.mini_program_url || '',
      },
    },
    actions: [
      ...(product ? [{ action_key: 'travel_route.view_product_detail', label: '查看产品详情', skill_key: 'travel_route', params: productParams }] : []),
      ...(isAvailable && jtd.handoff_enabled ? [{
        action_key: 'travel_route.booking_handoff',
        label: '继续预订',
        skill_key: 'travel_route',
        params: {
          ...productParams,
          h5_order_url: normalized?.h5_order_url || product?.handoff_urls?.h5_order_url || '',
          h5_product_url: normalized?.h5_product_url || product?.handoff_urls?.h5_product_url || '',
        },
      }] : []),
      { action_key: 'travel_route.request_manual_review', label: '人工复核', skill_key: 'travel_route', params: { ...productParams, reason: isMock ? 'jtd_mock_availability' : 'jtd_availability_review' } },
    ],
    followup_suggestions: [
      {
        label: '换个日期再查',
        user_prompt: '请换一个入住日期重新查询这条旅居产品是否可订',
        action_key: 'travel_route.check_availability',
        skill_key: 'travel_route',
        params: productParams,
      },
      {
        label: '查看路线详情',
        user_prompt: '请展示这条旅居路线的详细安排',
        action_key: 'travel_route.view_detail',
        skill_key: 'travel_route',
        params: productParams,
      },
    ],
    template_fit_notes: ['jtd_availability_result'],
  });
}

function availabilityStatusText({ hasAvailability, isAvailable, isMock, sourceStatus }) {
  if (!hasAvailability) return '未完成可订校验';
  if (isMock) return isAvailable ? '演示数据，显示可订' : '演示数据，显示不可订';
  if (sourceStatus === 'unavailable') return '可订校验暂不可用';
  return isAvailable ? '已校验可订' : '已校验当前不可订';
}

function availabilityMessageText({ hasAvailability, isAvailable, isMock, sourceStatus, jtd }) {
  if (!hasAvailability) return '本次响应没有取得可订校验结果，请补充入住日期、人数后重新查询。';
  if (isMock) return '当前结果为演示数据，仅用于流程预览，不作为正式下单或库存承诺。';
  if (sourceStatus === 'unavailable') return `可订校验暂不可用：${jtd.availability?.error || '未返回有效结果'}。`;
  return isAvailable
    ? '已取得可订校验结果，请在继续预订前再次核对入住日期、人数和最终价格。'
    : '已取得校验结果，当前日期或库存暂不支持预订。';
}

function nextAvailabilityStep({ hasAvailability, isAvailable, isMock, sourceStatus, jtd }) {
  if (!hasAvailability) return '请补充入住日期、离店日期和人数后重新查询，避免只展示路线信息。';
  if (isMock) return '请切换到真实环境或请求人工复核，演示数据不可作为真实可订依据。';
  if (sourceStatus === 'unavailable') return '请稍后重试或联系人工复核，必要时检查接口配置与网络连通性。';
  if (isAvailable && jtd.handoff_enabled) return '可继续进入预订跳转，并在下单页确认最终价格与库存。';
  if (isAvailable) return '接口显示可订，但未返回可用预订跳转地址，请先人工确认后再下单。';
  return '建议更换入住日期、减少人数或选择其他旅居产品。';
}

function buildAvailabilityWindow(requestPayload = {}, message = '') {
  const checkIn = requestPayload.checkIn || requestPayload.check_in || '';
  const checkOut = requestPayload.checkOut || requestPayload.check_out || '';
  if (checkIn && checkOut) return `${checkIn} 至 ${checkOut}`;
  const text = String(message || '');
  const dateMatch = text.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g);
  if (Array.isArray(dateMatch) && dateMatch.length >= 2) return `${dateMatch[0]} 至 ${dateMatch[1]}`;
  if (Array.isArray(dateMatch) && dateMatch.length === 1) return dateMatch[0];
  return '待确认入住日期';
}

export function fillTravelH5EmbedCard({ message, business_data } = {}) {
  const jtd = business_data?.jtd || {};
  const product = jtd.selected_product || jtd.products?.[0] || {};
  const availability = jtd.availability?.normalized || {};
  const handoffUrls = product.handoff_urls || {};
  const dataSource = jtd.data_source || jtd.source_status || '';

  // H5 URL：优先使用金跳动提供的下单页 URL
  //（不再用 iframe 内嵌，改为新标签页打开 → 用户可先登录再下单）
  let h5Url = availability.h5_order_url
    || handoffUrls.h5_order_url
    || availability.h5_product_url
    || handoffUrls.h5_product_url
    || '';

  // 确保 hash 路由格式
  if (h5Url && !h5Url.includes('#/pages/')) {
    h5Url = h5Url.replace(/\/h5\/pages\//, '/h5/#/pages/');
  }

  const productName = sanitizeText(product.product_name || inferDestination(message) || '旅居产品');
  const destination = sanitizeText(product.destination || product.city || business_data?.primary_city || '');
  const priceLabel = product.price_label || (product.price_amount ? `约${product.price_amount}元/人` : '');
  const productId = product.product_id || '';

  // 场景1：无 H5 URL — 友好降级提示（区分原因）
  if (!h5Url) {
    // 判断原因：本地线路（防城港5条）没有金跳动产品ID
    const isLocalRoute = productId.startsWith('fcg_') || dataSource === 'local_routes';
    // 判断原因：可订校验未通过
    const isUnavailable = availability && availability.available === false;

    let reasonText = '';
    let answerText = '';

    if (isLocalRoute) {
      reasonText = '官方认证线路';
      answerText = `${productName}是官方推荐的旅居线路，目前尚未接入在线预订系统。`;
    } else if (isUnavailable) {
      reasonText = '当前日期不可订';
      answerText = `${productName}在您选择的日期暂不可预订。建议更换入住日期或减少出行人数后重试。`;
    } else {
      reasonText = '暂未开放在线预订';
      answerText = `${productName}暂时无法提供在线预订页面。您可以联系旅居顾问（400-xxx-xxxx）获取最新报价和预订信息。`;
    }

    return {
      template_id: 'travel_h5_embed_card',
      answer_text: answerText,
      data: {
        h5Url: '',
        productName,
        destination,
        priceLabel,
        productId,
        hasH5Url: false,
        reasonText,
        isLocalRoute,
        isUnavailable,
      },
      actions: [],
    };
  }

  // 场景2：有 H5 URL — 正常嵌入
  return {
    template_id: 'travel_h5_embed_card',
    answer_text: `正在为您加载${productName}的预订页面，请在页面内确认入住日期、人数和价格后完成下单。`,
    data: {
      h5Url,
      productName,
      destination,
      priceLabel,
      productId,
      hasH5Url: true,
    },
    actions: [
      { action_key: 'travel_route.open_h5_external', label: '在新页面打开', skill_key: 'travel_route', params: { h5_url: h5Url, product_id: productId } },
    ],
  };
}

async function fillTravelItineraryCard({ message, business_data }) {
  let routeResult;
  try {
    routeResult = await fillRouteCard({ message, business_data });
  } catch (e) {
    console.error('[fillTravelItineraryCard] fillRouteCard 调用失败，降级返回基础行程:', e?.message || e);
    const destination = sanitizeText(inferDestination(message) || '旅居目的地');
    const fallbackDays = 3;
    const days = buildItinerary(destination, fallbackDays).map((item, index) => buildItineraryDay(item, index, destination, fallbackDays));
    return sanitizeModelResult({
      template_id: 'travel_itinerary_card',
      answer_text: `已为您生成${destination}行程安排建议。`,
      answer: `已为您生成${destination}行程安排建议。`,
      data: {
        title: `${destination}行程安排`,
        intro: '按低强度、少赶路、每日留足休息时间来安排，适合长者和家属陪同出行。',
        days,
        note: '行程可随身体状态、天气和可订日期灵活调整；下单前请继续做可售校验。',
        destination,
      },
      actions: [],
      followup_suggestions: [],
      template_fit_notes: ['travel_itinerary_card_fallback'],
    });
  }
  const routeData = routeResult.data || {};
  const destination = sanitizeText(routeData.destination || inferDestination(message));
  const productName = sanitizeText(String(routeData.routeTitle || '').replace(/康养旅居路线$/, '')) || destination;
  
  const product = business_data?.jtd?.selected_product || business_data?.jtd?.products?.[0];
  const { totalDays } = resolveTravelDuration({
    product,
    title: `${routeData.routeTitle || ''} ${productName}`,
    message,
    fallbackDays: 3,
  });
  
  // 从 routeData.itinerary 或构建默认行程
  const rawItinerary = Array.isArray(routeData.itinerary) ? routeData.itinerary : buildItinerary(destination, totalDays);
  // 确保 itinerary 中的每个 item 都有正确的格式
  const itinerary = rawItinerary.map((item, idx) => {
    // 如果 item 已经是正确的格式，直接返回
    if (typeof item === 'object' && item !== null) {
      // 确保 plan 是字符串
      const plan = typeof item.plan === 'string' 
        ? item.plan 
        : (item.plan && typeof item.plan === 'object' && item.plan.text)
          ? item.plan.text
          : item.plan?.toString?.() || '';
      return {
        ...item,
        plan,
      };
    }
    return buildItinerary(destination, totalDays)[idx] || { day: `D${idx + 1}`, plan: '' };
  });
  
  const days = itinerary.map((item, index) => buildItineraryDay(item, index, destination, itinerary.length));
  const sourceText = routeData.dataSource === 'local_routes'
    ? '来源：官方认证线路'
    : routeData.jtdStatus === 'real_data'
    ? '来源：已核验数据'
    : routeData.jtdStatus === 'mock_vendor_data'
      ? '来源：演示数据'
      : '来源：本地行程建议';

  return sanitizeModelResult({
    ...routeResult,
    template_id: 'travel_itinerary_card',
    data: {
      title: `${productName}行程安排`,
      intro: `${sourceText}。按低强度、少赶路、每日留足休息时间来安排，适合长者和家属陪同出行。`,
      days,
      note: '行程可随身体状态、天气和可订日期灵活调整；下单前请继续做可售校验。',
      routeTitle: routeData.routeTitle,
      destination,
      season: routeData.season,
      budgetLevel: routeData.budgetLevel,
      priceLabel: routeData.priceLabel || '',
      suitable: routeData.suitable,
      bookingStatus: routeData.bookingStatus,
      jtdStatus: routeData.jtdStatus || '',
      productId: routeData.productId || '',
      skuId: routeData.skuId || '',
    },
    template_fit_notes: [...(routeResult.template_fit_notes || []), 'travel_itinerary_card_selected'],
  });
}

function inferWeatherRiskTips(forecasts = [], current = {}) {
  const join = (f) => `${f.weather || ''} ${f.nightWeather || ''} ${f.dayWeather || ''}`;
  const allText = forecasts.map(join).join(' ') + ' ' + (current.weather || '');
  const hasRain = /雨|雪|雷|阵|暴雨|中雨|大雨|雨夹雪/.test(allText);
  const hasHot = forecasts.some((f) => (f.tempDay != null && f.tempDay >= 33) || (f.dayTemp != null && f.dayTemp >= 33));
  const hasCold = forecasts.some((f) => (f.tempNight != null && f.tempNight <= 12) || (f.nightTemp != null && f.nightTemp <= 12));
  const hasStrongWind = /(7|8|9|10|11|12)级|大风|暴风|台风/.test(forecasts.map((f) => f.wind || '').join(' '));
  const hasHaze = /霾|雾|沙尘|扬沙|浮尘/.test(allText);
  const tips = [];
  if (hasRain) tips.push('有降雨/雷雨：地面湿滑，外出备好防滑鞋与雨具，避免山区、临水与陡坡活动。');
  if (hasHot) tips.push('高温天气：注意补水、防中暑，避开正午暴晒，把户外安排放在早晚凉爽时段。');
  if (hasCold) tips.push('昼夜温差大或夜间偏凉：备好外套，留意长者心脑血管与呼吸道不适。');
  if (hasStrongWind) tips.push('风力较大：减少高处、临海与空旷地带活动，固定好遮阳伞等随身物品。');
  if (hasHaze) tips.push('有雾/霾/沙尘：呼吸道敏感长者减少户外活动，必要时佩戴口罩。');
  if (!tips.length) tips.push('未来几天天气总体平稳，可按原行程轻量出行；仍建议每日关注实时预报并留足休息。');
  return tips;
}

// 天气风险研判：结合上下文（目的地城市）+ 腾讯天气接口结果，输出长者旅居风险提示卡片
export async function fillTravelWeatherRiskCard({ message, business_data, weatherService } = {}) {
  // 打印完整的 selected_product 数据
  const selectedProduct = business_data?.jtd?.selected_product;
  console.log('[WeatherRiskCard] selected_product 详情:', JSON.stringify(selectedProduct, null, 2));
  
  console.log('[WeatherRiskCard] 输入参数:', { 
    message: message?.slice(0, 100), 
    business_data_keys: business_data ? Object.keys(business_data) : [],
    jtd: business_data?.jtd ? Object.keys(business_data.jtd) : [],
    selected_product: selectedProduct ? 'present' : 'missing',
  });
  
  // 从消息或业务数据中提取城市（多种来源）
  const fromMessage = inferDestination(message || '');
  const fromJtdProduct = business_data?.jtd?.selected_product?.destination;
  const fromJtdRoute = business_data?.jtd?.route?.destination;
  const fromBusinessData = business_data?.destination;
  const fromProductName = business_data?.jtd?.selected_product?.name;
  
  // 从产品名称中提取目的地
  let fromProductExtract = null;
  if (fromProductName) {
    // 常见格式: "广西北海康养旅居三日体验" -> 提取 "广西北海"
    // 或: "0730测试旅居路线5天4日游" -> 需要其他方式
    const match = fromProductName.match(/(广西|云南|海南|福建|四川|浙江|江苏|广东|北京|上海)[^\s]*(市|州|县|地区|北海|桂林|巴马|昆明|大理|丽江|三亚|海口|厦门)/);
    if (match) {
      fromProductExtract = match[0];
    } else {
      // 尝试匹配城市名
      const cityMatch = fromProductName.match(/(北海|桂林|巴马|昆明|大理|丽江|三亚|海口|厦门|巴马瑶族)/);
      if (cityMatch) {
        // 根据城市名补全省份
        const cityProvinceMap = {
          '北海': '广西北海', '桂林': '广西桂林', '巴马': '广西巴马', '巴马瑶族': '广西巴马',
          '昆明': '云南昆明', '大理': '云南大理', '丽江': '云南丽江',
          '三亚': '海南三亚', '海口': '海南海口',
          '厦门': '福建厦门',
        };
        fromProductExtract = cityProvinceMap[cityMatch[0]] || cityMatch[0];
      }
    }
  }
  
  // 优先级: 消息 > 产品目的地 > 路线目的地 > 产品名称提取 > 业务数据
  const cityName = sanitizeText(
    fromMessage 
    || fromJtdProduct 
    || fromJtdRoute 
    || fromProductExtract 
    || fromBusinessData 
    || null
  );
  
  console.log('[WeatherRiskCard] 城市提取结果:', { 
    fromMessage, 
    fromJtdProduct, 
    fromJtdRoute, 
    fromProductExtract,
    fromBusinessData,
    cityName 
  });
  
  // 如果没有提取到城市，提示用户
  if (!cityName || cityName === '目的地') {
    const answerText = `### 天气风险查询\n\n抱歉，我无法确定您要查询的目的地城市。请问您想查询哪个城市的天气？例如：\n\n- 广西北海\n- 云南昆明\n- 海南三亚\n\n您也可以直接说出城市名，如"北海天气如何"。`;
    return sanitizeModelResult({
      template_id: 'travel_weather_risk_card',
      answer_text: answerText,
      answer: answerText,
      data: {
        city: '',
        ok: false,
        degraded: true,
        degradedNote: '请指定查询的目的地城市',
        currentWeather: '',
        forecasts: [],
        riskTips: [{ text: '请提供目的地城市名称' }],
      },
      actions: [],
      followup_suggestions: [
        { text: '查询北海天气', action_key: 'travel_route.check_weather_risk', skill_key: 'travel_route', params: { city: '广西北海' } },
        { text: '查询昆明天气', action_key: 'travel_route.check_weather_risk', skill_key: 'travel_route', params: { city: '云南昆明' } },
        { text: '查询三亚天气', action_key: 'travel_route.check_weather_risk', skill_key: 'travel_route', params: { city: '海南三亚' } },
      ],
      template_fit_notes: ['missing_destination'],
    });
  }

  let weather = null;
  let ok = false;

  // 调用天气服务获取实时天气
  if (weatherService) {
    try {
      // 兼容不同的方法名：getWeatherByCity 或 getWeather
      const getWeatherFn = weatherService.getWeatherByCity || weatherService.getWeather;
      if (typeof getWeatherFn === 'function') {
        weather = await getWeatherFn.call(weatherService, cityName);
        ok = weather && weather.ok;
        console.log('[WeatherRiskCard] 天气服务调用结果:', { city: cityName, ok, source: weather?.source, error: weather?.error });
      } else {
        console.error('[WeatherRiskCard] 天气服务没有 getWeather 或 getWeatherByCity 方法');
      }
    } catch (error) {
      console.error('[WeatherRiskCard] 天气服务调用失败:', error.message);
    }
  } else {
    console.log('[WeatherRiskCard] 天气服务未配置');
  }

  const current = (weather && weather.current) || {};
  const forecasts = Array.isArray(weather?.forecasts) ? weather.forecasts : [];
  const tips = inferWeatherRiskTips(forecasts, current);

  const lines = [`### ${cityName} 旅居天气风险研判`];
  if (!ok) {
    lines.push('> 暂未获取到该城市的实时天气（未配置腾讯天气接口或接口异常）。建议出行前关注当地气象预报，或稍后重试。');
  } else {
    lines.push(`**当前**：${current.weather || '—'}，${current.temp != null ? current.temp + '℃' : '—'}${current.windDir ? '，' + current.windDir + (current.windPower || '') : ''}。`);
    if (forecasts.length) {
      lines.push('', '**未来几天：**', '| 日期 | 天气 | 温度 | 风 |', '| --- | --- | --- | --- |');
      for (const f of forecasts.slice(0, 5)) {
        const w = f.weather || '—';
        const t = `${f.tempDay != null ? f.tempDay + '°' : '—'}/${f.tempNight != null ? f.tempNight + '°' : '—'}`;
        lines.push(`| ${f.date || f.week || '—'} | ${w} | ${t} | ${f.wind || '—'} |`);
      }
    }
    lines.push('', '**长者风险提示：**');
    for (const t of tips) lines.push(`- ${t}`);
    if (weather?.updatedAt) lines.push(`\n_数据来源：腾讯天气（${weather.updatedAt}）_`);
  }
  const answerText = lines.join('\n');

  return sanitizeModelResult({
    template_id: 'travel_weather_risk_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      city: cityName,
      ok,
      degraded: !ok,
      currentWeather: current.weather || '',
      currentTemp: current.temp != null ? String(current.temp) : '',
      currentWind: [current.windDir, current.windPower].filter(Boolean).join(' ') || '',
      currentHumidity: current.humidity || '',
      currentFeel: current.feelTemp != null ? String(current.feelTemp) : '',
      updatedAt: weather?.updatedAt || '',
      forecasts: forecasts.slice(0, 5).map((f) => ({
        date: f.date || f.week || '',
        weather: f.weather || '',
        nightWeather: f.nightWeather || '',
        tempDay: f.tempDay != null ? String(f.tempDay) : '',
        tempNight: f.tempNight != null ? String(f.tempNight) : '',
        wind: f.wind || '',
      })),
      riskTips: tips.map((t) => ({ text: t })),
      degradedNote: ok ? '' : '暂未获取到实时天气，以下为通用提醒，请以当地实际预报为准。',
    },
    actions: [
      { action_key: 'travel_route.replan', label: '调整行程避开恶劣天气', skill_key: 'travel_route', params: { destination: cityName } },
    ],
    followup_suggestions: [
      { label: '查看可订状态', user_prompt: '请检查这条旅居路线近期是否可预订', action_key: 'travel_route.check_availability', skill_key: 'travel_route', params: { destination: cityName } },
    ],
    model_used: 'flatTalk.travel.weather',
    model_status: ok ? 'ok' : 'degraded',
    template_fit_notes: ['travel_weather_risk'],
  });
}

function buildItineraryDay(item = {}, index = 0, destination = '', totalDays = 3) {
  const day = sanitizeText(item.day || `D${index + 1}`);
  // plan 可能是字符串或对象，需要正确处理
  const planValue = item.plan;
  const planText = typeof planValue === 'string' 
    ? planValue 
    : (planValue && typeof planValue === 'object' && planValue.text) 
      ? planValue.text 
      : '';
  const plan = sanitizeText(planText);
  
  // 根据天数位置确定主题
  const isLastDay = index === totalDays - 1;
  const theme = index === 0 
    ? `抵达${destination || '目的地'}`
    : isLastDay 
      ? '轻松返程'
      : `第${index + 1}天康养体验`;

  // 根据天数位置构建行程时段
  let slots = [];
  
  if (index === 0) {
    // 第一天：抵达安顿
    slots = [
      { time: '上午', text: `抵达${destination || '目的地'}，办理入住，熟悉周边环境。` },
      { time: '下午', text: plan || '完成健康情况确认，安排轻松周边散步。' },
      { time: '傍晚', text: '基地或酒店附近慢行，早些休息。' },
    ];
  } else if (isLastDay) {
    // 最后一天：返程
    slots = [
      { time: '上午', text: plan || '根据体力选择短途游览或返程。' },
      { time: '下午', text: '预留交通缓冲，避免赶行程。' },
    ];
  } else {
    // 中间天数：康养活动
    slots = [
      { time: '上午', text: '参加康养活动或基地体验，控制步行强度。' },
      { time: '下午', text: plan || '低强度游览，保留午休和补水时间。' },
      { time: '傍晚', text: '清淡晚餐后休息，确认次日安排。' },
    ];
  }

  return {
    day,
    theme,
    slots,
    tip: '贴心提示：如老人血压、血糖波动或天气不适合外出，当天行程可改为基地内休整。',
  };
}

function fillRouteRemoteGap({ message, jtd, routes }) {
  const route = selectTravelRoute(message, routes);
  const destination = sanitizeText(route?.destination || inferDestination(message));
  const answerText = '金跳动旅居产品接口当前不可用，已停止生成可订产品推荐，可先保留需求并转人工确认。';
  // ★ 兜底也尝试加载预制作 SVG
  const svgPkg = findPrebuiltPackageByDestination(destination, 'standard');
  const staticSvg = (svgPkg && svgPkg.svg) ? svgPkg.svg : '';
  return sanitizeModelResult({
    template_id: 'route_svg',
    answer_text: answerText,
    answer: answerText,
    data: {
      routeTitle: `${destination}旅居产品待确认`,
      destination,
      season: sanitizeText(route?.season || inferSeason(message)),
      budgetLevel: '价格待真实接口确认',
      days: /四天|4天|four/i.test(message) ? '4天3晚' : '3天2晚',
      suitable: inferTravelSuitable(message),
      bookingStatus: '金跳动接口不可用，暂不可预订',
      summary: `未取得 JTD searchProducts 返回的 product_id，不能使用本地知识或表数据替代真实产品。状态=${jtd.source_status || 'unavailable'}。`,
      highlights: ['待接口恢复', '不生成订单', '需人工确认'],
      itinerary: buildItinerary(destination),
      healthNotice: buildTravelHealthNotice(message),
      jtdStatus: jtd.source_status || 'unavailable',
      productId: '',
      skuId: '',
      static_svg: staticSvg,
      waypoint_spots_json: JSON.stringify((svgPkg?.routeData?.waypoints || []).map((wp) => ({
        name: wp?.name || '',
        day: wp?.day || '',
        plan: wp?.plan || '',
        spot_desc: wp?.spot_desc || '',
        spot_images: Array.isArray(wp?.spot_images) ? wp.spot_images : [],
      }))),
    },
    actions: [
      { action_key: 'travel_route.request_manual_review', label: '请求人工复核', skill_key: 'travel_route', params: { reason: 'jtd_unavailable', destination } },
      { action_key: 'travel_route.replan', label: '重新规划路线', skill_key: 'travel_route', params: { destination } },
    ],
    followup_suggestions: [
      {
        label: '补充出行偏好',
        user_prompt: '我先补充出行日期、人数和预算，等接口恢复后再校验可订状态',
        action_key: 'travel_route.fill_preferences',
        skill_key: 'travel_route',
      },
    ],
    template_fit_notes: ['jtd_remote_gap'],
  });
}

function buildJtdBookingStatus(jtd, product, route) {
  if (!product) return route?.booking_status || '可咨询余量';
  if (jtd.availability?.normalized?.available) return '已校验可订';
  if (jtd.availability && !jtd.availability.normalized?.available) return '已校验，当前日期不可订';
  if (jtd.source_status === 'real_data') return '已返回真实产品，待日期可售校验';
  if (jtd.source_status === 'mock_vendor_data') return '演示数据，不能视为真实可订';
  return '数据状态待确认';
}

async function fillPolicyListCard({ message, knowledgeService }) {
  const text = String(message || '');
  let policyContent = null;

  try {
    const keywords = extractPolicyKeywords(text);
    if (knowledgeService?.retriever && keywords.length > 0) {
      const knowledgeResult = await knowledgeService.retriever.retrieve({
        skill_key: 'common',
        query: keywords.join(' '),
        limit: 5,
      });
      if (knowledgeResult?.matches?.length > 0) {
        policyContent = summarizePolicyKnowledge(knowledgeResult.matches, text);
      }
    }
  } catch (error) {
    console.error('[PolicyListCard] 知识库查询失败:', error.message);
  }

  const policies = (policyContent?.items?.length ? policyContent.items : buildDefaultPolicyList(text))
    .slice(0, 6)
    .map((item, index) => ({
      id: item.id || `policy_${String(index + 1).padStart(3, '0')}`,
      icon: item.icon || '📋',
      title: item.title || item.label || '养老政策信息',
      description: item.description || item.detail || '可继续补充老人年龄、户籍、失能情况，我会整理申请条件和办理材料。',
      tags: item.tags || inferPolicyTags(item.label || item.title || item.detail || text),
    }));

  const answerText = policyContent?.summary
    || '已为您整理社区居家养老、补贴和支持政策方向。具体标准通常与老人年龄、户籍或居住地、失能等级和经济状况有关。';

  return sanitizeModelResult({
    template_id: 'policy_list_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      eyebrow: '📋 政策知识库',
      title: /社区居家养老|居家养老|社区养老/.test(text) ? '社区居家养老支持政策' : '养老补贴相关政策',
      summary: answerText,
      count: policies.length,
      policies,
      hint: '💡 可继续告诉我老人所在城市、年龄、户籍和失能情况，我会按当地口径整理申请条件、材料和办理流程。',
    },
    actions: [],
    followup_suggestions: [
      { label: '查询办理流程', user_prompt: '养老补贴应该去哪里办理，流程是什么' },
      { label: '整理办理材料', user_prompt: '办理养老补贴需要准备哪些材料' },
      { label: '说明老人情况', user_prompt: '老人80岁，广西户籍，想了解可以申请哪些补贴' },
    ],
    template_fit_notes: ['deterministic_policy_list'],
  });
}

function fillPolicyApplyGuideCard({ message }) {
  const text = String(message || '');
  const isHomeModification = /适老化改造|居家改造/.test(text);
  const title = isHomeModification ? '适老化改造补贴申请指引' : '养老补贴申请指引';
  const answerText = isHomeModification
    ? '适老化改造补贴一般先确认老人身份和改造需求，再向社区、街道或民政部门提交申请，审核评估后按当地目录实施改造和验收。'
    : '养老补贴通常按“确认条件、准备材料、提交申请、审核评估、发放或服务兑现”的流程办理，具体以当地民政、人社、医保部门要求为准。';

  return sanitizeModelResult({
    template_id: 'policy_apply_guide_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      eyebrow: '📝 办事指引',
      title,
      subtitle: isHomeModification ? '防滑、扶手、如厕洗浴、室内安全等居家改造申请流程' : '高龄津贴、护理补贴、困难老人补助等申请流程',
      conditions: {
        items: isHomeModification
          ? [
              { label: '老人范围', value: '高龄、失能、残疾、困难或有居家安全改造需求的老人' },
              { label: '居住地', value: '通常需在申请地常住，具体看当地政策' },
              { label: '改造需求', value: '经入户评估确认存在防跌倒、如厕洗浴等改造需求' },
              { label: '补贴限制', value: '同一住房或同一老人是否重复享受，以当地规定为准' },
            ]
          : [
              { label: '年龄', value: '通常为60周岁及以上，部分津贴按更高年龄段' },
              { label: '户籍/居住', value: '以当地户籍、居住证或常住要求为准' },
              { label: '能力等级', value: '护理类补贴一般需失能或半失能评估' },
              { label: '经济状况', value: '困难类补贴需符合当地收入或救助认定标准' },
            ],
      },
      steps: {
        items: [
          { number: '1', title: '确认政策口径', description: '先确认老人所在城市/区县、年龄、户籍、居住地和身体能力情况。' },
          { number: '2', title: '准备申请材料', description: '准备身份证、户口本或居住证明、评估材料、银行卡等基础资料。' },
          { number: '3', title: '提交申请', description: '到社区、街道办事处、民政窗口或当地线上政务平台提交申请。' },
          { number: '4', title: '审核评估', description: '相关部门审核材料，必要时进行入户评估、公示或复核。' },
          { number: '5', title: '结果兑现', description: isHomeModification ? '审核通过后按改造目录施工、验收，再按规定结算或补贴。' : '审核通过后按月发放补贴，或以服务券、服务包等方式兑现。' },
        ],
      },
      materials: {
        items: isHomeModification
          ? ['身份证原件及复印件', '户口本或居住证明', '房屋权属或居住证明', '改造需求评估表', '银行卡信息', '委托代办材料']
          : ['身份证原件及复印件', '户口本或居住证明', '近期免冠照片', '能力/失能评估报告', '银行卡信息', '困难证明或救助材料'],
      },
      contact: {
        location: '户籍或常住地社区/街道办事处/民政部门',
        phone: '12345政务服务热线或当地民政窗口',
        duration: '一般15-30个工作日，具体以当地规定为准',
      },
      highlight: '⚠️ 提示：各地补贴对象、金额、材料和办理入口可能不同，建议补充城市/区县后再核对当地最新口径。',
    },
    actions: [],
    followup_suggestions: [
      { label: '整理办理材料', user_prompt: `${isHomeModification ? '适老化改造' : '养老补贴'}办理需要准备哪些材料` },
      { label: '查询补贴条件', user_prompt: `${isHomeModification ? '适老化改造' : '养老补贴'}申请条件是什么` },
    ],
    template_fit_notes: ['deterministic_policy_apply_guide'],
  });
}

async function fillPolicyDetailCard({ message, knowledgeService }) {
  const text = String(message || '');
  let policyContent = null;

  try {
    const keywords = extractPolicyKeywords(text);
    if (knowledgeService?.retriever && keywords.length > 0) {
      const knowledgeResult = await knowledgeService.retriever.retrieve({
        skill_key: 'common',
        query: keywords.join(' '),
        limit: 5,
      });
      if (knowledgeResult?.matches?.length > 0) {
        policyContent = summarizePolicyKnowledge(knowledgeResult.matches, text);
      }
    }
  } catch (error) {
    console.error('[PolicyDetailCard] 知识库查询失败:', error.message);
  }

  const isHomeModification = /适老化改造|居家改造/.test(text);
  const answerText = policyContent?.summary
    || (isHomeModification
      ? '适老化改造政策重点关注居家安全风险，常见改造包括防滑处理、安装扶手、如厕洗浴改造、紧急呼叫和室内通行优化。'
      : '养老政策通常覆盖高龄津贴、长期护理保险、护理补贴、助餐补贴、社区居家养老服务和能力评估等内容。');

  return sanitizeModelResult({
    template_id: 'policy_detail_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      eyebrow: '政策解读',
      title: isHomeModification ? '适老化改造政策解读' : '养老政策要点解读',
      tags: inferPolicyTags(text),
      summary: answerText,
      highlights: {
        items: (policyContent?.items?.length ? policyContent.items : buildDefaultPolicyList(text)).slice(0, 4).map((item, index) => ({
          icon: String(index + 1),
          text: item.detail || item.description || item.title || item.label,
        })),
      },
      details: {
        heading: '办理提示',
        content: '<p>建议先确认老人所在城市/区县、年龄、户籍或居住情况、失能等级和经济状况。</p><p>不同地区对补贴标准、材料清单、审核时限和发放方式会有差异，最终以当地民政、人社、医保等部门最新要求为准。</p>',
      },
      footer_tip: '如需了解具体申请条件和办理流程，请告诉我老人年龄、户籍和失能情况。',
    },
    actions: [],
    followup_suggestions: [
      { label: '查询办理流程', user_prompt: '这个政策怎么办理，流程是什么' },
      { label: '整理办理材料', user_prompt: '办理这个政策需要哪些材料' },
    ],
    template_fit_notes: ['deterministic_policy_detail'],
  });
}

function buildDefaultPolicyList(text = '') {
  if (/适老化改造|居家改造/.test(text)) {
    return [
      { icon: '🏠', title: '居家适老化改造补贴', description: '围绕防滑、扶手、如厕洗浴、通行安全和紧急呼叫等项目进行改造支持。', tags: ['适老化改造', '居家安全'] },
      { icon: '🧾', title: '困难老年人改造支持', description: '部分地区优先支持低保、特困、失能、残疾、高龄等困难老年人家庭。', tags: ['困难老人', '补贴'] },
      { icon: '🛠️', title: '改造目录和验收', description: '通常需先评估后施工，按当地改造目录、限额和验收标准执行。', tags: ['办理流程', '验收'] },
    ];
  }

  return [
    { icon: '💰', title: '高龄津贴', description: '面向达到当地规定年龄的老年人，通常与户籍、年龄档次和申请审核有关。', tags: ['津贴', '高龄'] },
    { icon: '🏥', title: '长期护理保险', description: '面向经评估达到护理需求等级的参保人员，提供护理服务或待遇支付。', tags: ['长护险', '护理'] },
    { icon: '🤝', title: '社区居家养老服务', description: '包含助餐送餐、上门照护、日间照料、探访关爱等服务支持。', tags: ['居家养老', '社区服务'] },
    { icon: '🍽️', title: '助餐补贴', description: '部分地区对符合条件老人提供助餐、送餐或老年食堂价格优惠。', tags: ['助餐', '补贴'] },
    { icon: '🏠', title: '适老化改造', description: '对符合条件家庭开展防滑、扶手、如厕洗浴等居家安全改造支持。', tags: ['适老化', '安全'] },
  ];
}

function inferPolicyTags(text = '') {
  const tags = [];
  if (/补贴|津贴/.test(text)) tags.push('补贴政策');
  if (/社区居家养老|居家养老|社区养老/.test(text)) tags.push('居家养老');
  if (/适老化改造|居家改造/.test(text)) tags.push('适老化改造');
  if (/长护险|长期护理保险/.test(text)) tags.push('长护险');
  if (/办理|申请|流程|材料/.test(text)) tags.push('办理指引');
  return tags.length ? tags : ['养老政策'];
}

function fillServiceQualityEvalCard({ message = '', business_data = {}, selectedTemplateId = 'institution_quality_report' } = {}) {
  const rows = Array.isArray(business_data?.quality_evaluation?.rows) ? business_data.quality_evaluation.rows : [];
  const feedback = business_data?.feedback_metrics || {};
  const metrics = feedback.metrics || {};
  const samples = Array.isArray(feedback.samples) ? feedback.samples : [];
  const summary = buildQualitySummary(rows, metrics, samples);
  const sourceStatus = [business_data?.quality_evaluation?.source, feedback.source].filter(Boolean).join('+') || 'unavailable';

  if (selectedTemplateId === 'evaluation_standard') return fillQualityStandardCard(sourceStatus);
  if (selectedTemplateId === 'staff_quality_report') return fillStaffQualityReport(summary, sourceStatus);
  if (selectedTemplateId === 'org_quality_ranking') return fillOrgQualityRanking(summary, sourceStatus);
  if (selectedTemplateId === 'staff_quality_ranking') return fillStaffQualityRanking(summary, sourceStatus);
  if (selectedTemplateId === 'rectification_suggestion') return fillRectificationSuggestion(summary, sourceStatus);
  if (selectedTemplateId === 'complaint_detail') return fillComplaintDetail(summary, sourceStatus);

  const answerText = `${summary.orgName}服务质量综合评分 ${summary.totalScore} 分，等级 ${summary.level}，投诉率 ${summary.complaintRate}%。`;
  return sanitizeModelResult({
    template_id: 'institution_quality_report',
    answer_text: answerText,
    answer: answerText,
    data: {
      orgName: summary.orgName,
      period: summary.period,
      serviceScope: summary.serviceScope,
      totalScore: summary.totalScore,
      level: summary.level,
      percentile: summary.percentile,
      delta: summary.delta,
      rankLabel: summary.rankLabel,
      workOrderCount: summary.workOrderCount,
      goodRate: summary.goodRate,
      complaintRate: summary.complaintRate,
      complaintClass: summary.complaintRate >= 5 ? 'bad' : summary.complaintRate >= 2 ? 'warn' : 'ok',
      dimensions: summary.dimensions,
      problemTop: summary.problemTop,
      praiseTags: summary.praiseTags,
      riskTags: summary.riskTags,
      aiSuggestions: summary.aiSuggestions,
      showWarn: summary.totalScore < 70 || summary.complaintRate >= 5,
      warnText: summary.totalScore < 70
        ? '当前评分进入重点关注区间，建议生成整改任务并转督导复核。'
        : '当前未进入后 10% 预警，但投诉与工单质量需连续跟踪。',
    },
    actions: qualityActions(),
    followup_suggestions: qualityFollowups(),
    model_used: 'flatTalk.service_quality.rules',
    model_status: sourceStatus.includes('simulated') ? 'degraded' : 'ok',
    template_fit_notes: [`service_quality_source:${sourceStatus}`],
  });
}

function buildQualitySummary(rows, metrics, samples) {
  const now = new Date().toISOString().slice(0, 10);
  const workOrderCount = rows.length || Number(metrics.total || 0) || 0;
  const ratings = rows
    .map((row) => Number(row.order_rating ?? row.work_rating ?? row.rating ?? 0))
    .filter((rating) => rating > 0);
  const avgRating = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : Number(metrics.avg_rating || 4);
  const goodRate = workOrderCount ? round1((ratings.filter((rating) => rating >= 4).length / Math.max(ratings.length, 1)) * 100) : 0;
  const complaintCount = Number(metrics.by_type?.find?.((item) => /投诉/.test(item.feedback_type || item.type || ''))?.cnt || 0)
    || samples.filter((item) => /投诉/.test(item.feedback_type || item.type || item.title || '')).length;
  const complaintRate = workOrderCount ? round1((complaintCount / workOrderCount) * 100) : (complaintCount ? 100 : 0);
  const onTimeIssues = rows.filter((row) => /迟到|超时|延迟/.test(`${row.evaluate_tags || ''}${row.exception_type || ''}${row.evaluate_content || ''}`)).length;
  const completeCount = rows.filter((row) => /已完成|完成/.test(`${row.work_status || row.status || ''}`)).length;
  const d1 = clampScore(avgRating * 20);
  const d2 = workOrderCount ? clampScore((completeCount / workOrderCount) * 100) : 85;
  const d3 = workOrderCount ? clampScore(100 - (onTimeIssues / workOrderCount) * 40) : 82;
  const d4 = clampScore(100 - complaintRate * 8);
  const totalScore = round1(d1 * 0.3 + d2 * 0.2 + d3 * 0.2 + d4 * 0.3);
  const orgName = firstNonEmpty(rows, ['org_name', 'orgName']) || firstNonEmpty(samples, ['org_name', 'orgName']) || '嘉路康养中心';
  const staffName = firstNonEmpty(rows, ['staff_name', 'nurse_name', 'staffName', 'nurseName']) || '服务人员';
  const weak = [
    { code: 'D1', name: '用户评价评分', score: round1(d1), weight: '30%', desc: '由订单评价星级与好中差评加权推导' },
    { code: 'D2', name: '流程完成度', score: round1(d2), weight: '20%', desc: '由已完成工单占比与闭环字段推导' },
    { code: 'D3', name: '工单服务质量', score: round1(d3), weight: '20%', desc: '由准时、完成、异常标签综合推导' },
    { code: 'D4', name: '投诉率', score: round1(d4), weight: '30%', desc: '由投诉件数/参评工单数反向计分' },
  ].sort((a, b) => a.score - b.score)[0];
  const dimensions = [
    { code: 'D1', name: '用户评价评分', weight: '30%', score: round1(d1), pct: round1(d1), barClass: d1 < 70 ? 'warn' : '', desc: '由评价星级、评价内容与好中差评标签推导' },
    { code: 'D2', name: '流程完成度', weight: '20%', score: round1(d2), pct: round1(d2), barClass: d2 < 70 ? 'warn' : '', desc: '完成闭环工单占比，缺少签退/小结会扣分' },
    { code: 'D3', name: '工单服务质量', weight: '20%', score: round1(d3), pct: round1(d3), barClass: d3 < 70 ? 'warn' : '', desc: '准时到达、服务过程、异常标签共同影响' },
    { code: 'D4', name: '投诉率', weight: '30%', score: round1(d4), pct: round1(d4), barClass: d4 < 70 ? 'warn' : '', desc: '投诉越少得分越高，重复投诉触发整改' },
  ];
  const riskTags = extractTags(rows, samples, false);
  const praiseTags = extractTags(rows, samples, true);
  return {
    period: now,
    orgName,
    staffName,
    staffNo: firstNonEmpty(rows, ['staff_no', 'staffNo', 'staff_id']) || '未登记',
    serviceScope: '上门/院内/巡访',
    totalScore,
    level: scoreLevel(totalScore),
    percentile: totalScore >= 90 ? 20 : totalScore >= 80 ? 50 : totalScore >= 70 ? 75 : 90,
    delta: totalScore >= 80 ? '+1.2' : '-2.4',
    rankLabel: totalScore < 70 ? '后10%预警' : totalScore >= 90 ? '前20%推荐' : '正常归档',
    workOrderCount,
    goodRate,
    complaintCount,
    complaintRate,
    dimensions,
    weak,
    praiseTags: praiseTags.length ? praiseTags : ['沟通清晰', '耐心细致'],
    riskTags: riskTags.length ? riskTags : (complaintCount ? ['服务时效'] : ['暂无高频风险']),
    problemTop: [
      { title: weak.name, count: Math.max(1, complaintCount || onTimeIssues || 1), desc: `${weak.code} 为当前薄弱维度，建议优先复核相关工单与投诉。`, itemClass: weak.score < 70 ? 'bad' : 'warn', pillClass: weak.score < 70 ? 'bad' : 'warn' },
      { title: '服务过程留痕', count: Math.max(0, onTimeIssues), desc: '迟到、签退、服务小结等过程字段会直接影响 D2/D3。', itemClass: onTimeIssues ? 'warn' : '', pillClass: onTimeIssues ? 'warn' : 'blue' },
    ],
    aiSuggestions: [
      { type: `${weak.code}偏弱`, dimension: weak.name, text: `建议围绕「${weak.name}」建立日清复核：抽查低分工单、补齐证据、复盘责任人。`, itemClass: weak.score < 70 ? 'bad' : 'warn', pillClass: weak.score < 70 ? 'bad' : 'warn' },
      { type: '投诉闭环', dimension: 'D4', text: '投诉样本需关联机构、人员、工单与处理结果，关闭后再回写评分。', itemClass: '', pillClass: 'blue' },
    ],
    samples,
    rows,
  };
}

function fillStaffQualityReport(summary, sourceStatus) {
  const answerText = `${summary.staffName}服务质量评分 ${summary.totalScore} 分，${summary.rankLabel}。`;
  return sanitizeModelResult({
    template_id: 'staff_quality_report',
    answer_text: answerText,
    answer: answerText,
    data: {
      staffName: summary.staffName,
      staffNo: summary.staffNo,
      orgName: summary.orgName,
      serviceType: '上门服务',
      totalScore: summary.totalScore,
      level: summary.level,
      orgRank: summary.totalScore >= 90 ? 3 : summary.totalScore >= 70 ? 18 : 58,
      orgTotal: 58,
      tagStatus: summary.rankLabel,
      workOrderCount: summary.workOrderCount,
      onTimeRate: round1(Math.max(0, summary.dimensions[2].score)),
      complaintCount: summary.complaintCount,
      complaintClass: summary.complaintCount ? 'warn' : 'ok',
      dimensions: summary.dimensions,
      goodTags: summary.praiseTags,
      badTags: summary.riskTags,
      reviews: summary.rows.slice(0, 3).map((row) => ({
        who: row.elder_name || row.user_name || '服务对象',
        stars: `${row.order_rating || row.work_rating || row.rating || 4}星`,
        text: row.evaluate_content || row.service_summary || '服务已完成，建议补充评价文本。',
      })),
      aiSuggestions: summary.aiSuggestions,
    },
    actions: qualityActions(),
    followup_suggestions: qualityFollowups(),
    model_used: 'flatTalk.service_quality.rules',
    model_status: sourceStatus.includes('simulated') ? 'degraded' : 'ok',
    template_fit_notes: [`service_quality_source:${sourceStatus}`],
  });
}

function fillOrgQualityRanking(summary, sourceStatus) {
  const ranking = buildOrgRanking(summary);
  return sanitizeModelResult({
    template_id: 'org_quality_ranking',
    answer_text: `已生成${summary.orgName}所在区域机构质量排名视图。`,
    answer: `已生成${summary.orgName}所在区域机构质量排名视图。`,
    data: {
      region: '广西养老服务辖区',
      period: summary.period,
      orgTotal: ranking.length,
      recommendCount: ranking.filter((item) => item.tag === '优先推荐').length,
      warningCount: ranking.filter((item) => item.tag === '预警推送').length,
      ranking,
      alertClass: summary.totalScore < 70 ? 'bad' : 'ok',
      supervisionNote: summary.totalScore < 70 ? '该机构应进入整改跟踪队列。' : '当前无末位预警，建议持续跟踪薄弱维度。',
    },
    actions: qualityActions(),
    followup_suggestions: qualityFollowups(),
    model_used: 'flatTalk.service_quality.rules',
    model_status: sourceStatus.includes('simulated') ? 'degraded' : 'ok',
  });
}

function fillStaffQualityRanking(summary, sourceStatus) {
  const ranking = buildStaffRanking(summary);
  return sanitizeModelResult({
    template_id: 'staff_quality_ranking',
    answer_text: `已生成${summary.orgName}服务人员质量排名。`,
    answer: `已生成${summary.orgName}服务人员质量排名。`,
    data: {
      orgName: summary.orgName,
      period: summary.period,
      staffTotal: ranking.length,
      adaptCount: ranking.filter((item) => item.tag === '服务适配').length,
      warningCount: ranking.filter((item) => item.tag === '预警').length,
      ranking,
      complaintTop: ranking.filter((item) => item.complaints > 0).map((item) => ({
        staffName: item.staffName,
        count: item.complaints,
        summary: '投诉与低分评价需关联工单复盘。',
        itemClass: item.complaints >= 2 ? 'bad' : 'warn',
        pillClass: item.complaints >= 2 ? 'bad' : 'warn',
      })),
    },
    actions: qualityActions(),
    followup_suggestions: qualityFollowups(),
    model_used: 'flatTalk.service_quality.rules',
    model_status: sourceStatus.includes('simulated') ? 'degraded' : 'ok',
  });
}

function fillRectificationSuggestion(summary, sourceStatus) {
  return sanitizeModelResult({
    template_id: 'rectification_suggestion',
    answer_text: `已围绕${summary.weak.code}生成整改建议。`,
    answer: `已围绕${summary.weak.code}生成整改建议。`,
    data: {
      period: summary.period,
      targetName: summary.orgName,
      weakDimension: `${summary.weak.code} ${summary.weak.name}`,
      weakScore: summary.weak.score,
      confidence: sourceStatus.includes('simulated') ? 62 : 86,
      openIssues: Math.max(1, summary.complaintCount || 1),
      complaints: summary.complaintCount,
      slaHours: summary.totalScore < 70 ? 24 : 72,
      causes: summary.problemTop.map((item) => ({ title: item.title, dimension: summary.weak.code, desc: item.desc, itemClass: item.itemClass, pillClass: item.pillClass })),
      suggestions: [
        { title: '补齐服务过程闭环节点', owner: '机构管理员', action: '复核签到、签退、服务小结、评价与投诉处理结果，缺项生成补证任务。', acceptance: 'D2/D3 连续 7 日不低于 85 分' },
        { title: '建立投诉日清复盘', owner: '督导人员', action: '投诉提交后 24 小时内关联人员和工单，形成原因、措施、回访结果。', acceptance: 'D4 回升且同类投诉不连续出现' },
      ],
      handoffClass: summary.totalScore < 70 ? 'bad' : 'warn',
      handoffText: summary.totalScore < 70 ? '建议转监管端督导，并生成整改工单。' : '建议机构内部整改跟踪，必要时转人工督导。',
    },
    actions: qualityActions(),
    followup_suggestions: qualityFollowups(),
    model_used: 'flatTalk.service_quality.rules',
    model_status: sourceStatus.includes('simulated') ? 'degraded' : 'ok',
  });
}

function fillComplaintDetail(summary, sourceStatus) {
  const sample = summary.samples.find((item) => /投诉/.test(item.feedback_type || item.type || item.title || '')) || summary.samples[0] || {};
  return sanitizeModelResult({
    template_id: 'complaint_detail',
    answer_text: `已生成投诉详情：${sample.title || '服务质量投诉'}`,
    answer: `已生成投诉详情：${sample.title || '服务质量投诉'}`,
    data: {
      status: sample.status || '待处理',
      title: sample.title || '服务质量投诉',
      complaintId: sample.feedback_id || sample.id || '待生成',
      createdAt: sample.create_time || sample.created_at || summary.period,
      severity: summary.totalScore < 70 ? '较重' : '一般',
      complainant: sample.user_name || sample.complainant || '服务对象/家属',
      orgName: sample.org_name || summary.orgName,
      staffName: sample.staff_name || summary.staffName,
      complaintType: sample.feedback_type || '投诉',
      workOrderNo: sample.work_order_no || sample.workOrderNo || '未关联',
      description: sample.content || sample.description || '投诉描述暂未补齐，需要关联原始反馈记录。',
      timeline: [
        { time: sample.create_time || summary.period, node: '投诉提交', detail: '系统记录投诉反馈', stepClass: 'bad' },
        { time: sample.handle_time || '待处理', node: '处理跟进', detail: sample.handle_result || '等待机构补充处理结果', stepClass: sample.handle_result ? 'done' : '' },
      ],
      orgImpact: summary.complaintCount ? '-2.0' : '0',
      staffImpact: summary.complaintCount ? '-3.0' : '0',
      impactClass: summary.complaintCount ? 'bad' : 'ok',
      impactAnalysis: '投诉需回写 D4，并与机构、人员、工单形成闭环证据。',
      resultTitle: sample.handle_result ? '已记录处理结果' : '待补充处理结果',
      satisfaction: sample.status || '待回访',
      resultText: sample.handle_result || '建议完成投诉回访后再关闭工单。',
    },
    actions: qualityActions(),
    followup_suggestions: qualityFollowups(),
    model_used: 'flatTalk.service_quality.rules',
    model_status: sourceStatus.includes('simulated') ? 'degraded' : 'ok',
  });
}

function fillQualityStandardCard(sourceStatus) {
  return sanitizeModelResult({
    template_id: 'evaluation_standard',
    answer_text: '服务质量评估采用 D1-D4 四维度加权评分。',
    answer: '服务质量评估采用 D1-D4 四维度加权评分。',
    data: {
      standardName: '养老服务质量评估标准',
      version: 'v2.0',
      dimensions: [
        { code: 'D1', name: '用户评价评分', weight: '30%', target: '评价', orgRule: '机构：由归属人员 D1 按 T-1 工单量加权推导。', staffRule: '人员：好中差评得分 0.5 + 星级评分 0.5。' },
        { code: 'D2', name: '工单满意度/流程完成度', weight: '20%', target: '流程', orgRule: '机构：已完成工单中满意反馈占比。', staffRule: '人员：完成全流程工单数 / 总工单数。' },
        { code: 'D3', name: '工单服务质量/时长达标率', weight: '20%', target: '执行', orgRule: '机构：准时到达率 50% + 完成率 50%。', staffRule: '人员：实际服务时长达到标准时长的工单占比。' },
        { code: 'D4', name: '投诉率', weight: '30%', target: '风险', orgRule: '机构：（1 - 投诉工单数 / 总工单数）×100。', staffRule: '人员：（1 - 投诉工单数 / 总工单数）×100。' },
      ],
      positiveTags: ['服务态度好', '技术专业', '准时到达', '耐心细致', '沟通清晰'],
      negativeTags: ['态度不好', '迟到早退', '服务不专业', '流程缺失'],
    },
    actions: qualityActions(),
    followup_suggestions: qualityFollowups(),
    model_used: 'flatTalk.service_quality.rules',
    model_status: sourceStatus.includes('simulated') ? 'degraded' : 'ok',
  });
}

function qualityActions() {
  return [
    { action_key: 'service_quality_eval.view_report', label: '机构报告', params: {} },
    { action_key: 'service_quality_eval.view_staff', label: '人员评估', params: {} },
    { action_key: 'service_quality_eval.rectify', label: '整改建议', params: {} },
    { action_key: 'service_quality_eval.view_standard', label: '评分标准', params: {} },
  ];
}

function qualityFollowups() {
  return [
    { label: '查看机构排名', user_prompt: '查看机构服务质量排名', action_key: 'service_quality_eval.view_org_rank' },
    { label: '查看投诉详情', user_prompt: '查看服务质量投诉详情', action_key: 'service_quality_eval.view_complaint' },
    { label: '生成人员排名', user_prompt: '查看护理员服务质量排名', action_key: 'service_quality_eval.view_staff_rank' },
  ];
}

function buildOrgRanking(summary) {
  const score = summary.totalScore;
  return [
    rankOrg(1, '青秀区颐养中心', 95.2, '青秀区'),
    rankOrg(2, summary.orgName, score, '防城港'),
    rankOrg(3, '港口区安康护理站', 82.6, '港口区'),
    rankOrg(4, '边海社区居家养老点', 66.4, '防城区'),
  ].sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, rank: index + 1, noClass: index < 2 ? 'top' : item.score < 70 ? 'warn' : '' }));
}

function rankOrg(rank, orgName, score, area) {
  return {
    rank,
    noClass: '',
    orgName,
    area,
    score: round1(score),
    level: scoreLevel(score),
    levelClass: score >= 85 ? 'ok' : score >= 70 ? 'blue' : 'bad',
    tag: score >= 90 ? '优先推荐' : score < 70 ? '预警推送' : '',
    tagClass: score >= 90 ? 'ok' : score < 70 ? 'bad' : '',
    delta: score >= 80 ? '+1.0' : '-2.0',
    d1: round1(score + 1),
    d2: round1(score - 1),
    d3: round1(score - 2),
    d4: round1(score),
  };
}

function buildStaffRanking(summary) {
  const base = [
    { staffName: summary.staffName, score: summary.totalScore, complaints: summary.complaintCount },
    { staffName: '李秀琴', score: 94.1, complaints: 0 },
    { staffName: '王桂芳', score: 90.5, complaints: 0 },
    { staffName: '孙伟', score: 58.4, complaints: 3 },
  ].sort((a, b) => b.score - a.score);
  return base.map((item, index) => ({
    rank: index + 1,
    noClass: index < 2 ? 'top' : item.score < 70 ? 'warn' : '',
    staffName: item.staffName,
    serviceType: '上门服务',
    score: round1(item.score),
    level: scoreLevel(item.score),
    levelClass: item.score >= 85 ? 'ok' : item.score >= 70 ? 'blue' : 'bad',
    tag: item.score >= 90 ? '服务适配' : item.score < 70 ? '预警' : '',
    tagClass: item.score >= 90 ? 'ok' : item.score < 70 ? 'bad' : '',
    workOrders: summary.workOrderCount || 30,
    complaints: item.complaints,
    delta: item.score >= 80 ? '+0.8' : '-3.1',
  }));
}

function extractTags(rows, samples, positive) {
  const text = [...rows, ...samples].map((item) => `${item.evaluate_tags || ''} ${item.content || ''} ${item.title || ''}`).join(' ');
  const pool = positive
    ? ['服务态度好', '技术专业', '准时到达', '耐心细致', '沟通清晰']
    : ['迟到早退', '态度不好', '服务不专业', '流程缺失', '服务时效'];
  return pool.filter((tag) => text.includes(tag) || (!positive && /迟到|超时|投诉|不专业|态度差/.test(text) && ['迟到早退', '服务时效'].includes(tag))).slice(0, 4);
}

function firstNonEmpty(rows, keys) {
  for (const row of rows) {
    for (const key of keys) {
      if (row?.[key]) return String(row[key]);
    }
  }
  return '';
}

function scoreLevel(score) {
  const value = Number(score || 0);
  if (value >= 90) return 'A级';
  if (value >= 80) return 'B级';
  if (value >= 70) return 'C级';
  return 'D级';
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Number(score || 0)));
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

const HTML_SAFE_KEYS = new Set(['static_svg', 'compact_followups', 'rendered_html', 'waypoint_spots_json']);
function sanitizeModelResult(result, parentKey = '') {
  if (Array.isArray(result)) return result.map((item) => sanitizeModelResult(item, parentKey));
  if (result && typeof result === 'object') {
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, sanitizeModelResult(value, key)]));
  }
  if (typeof result === 'string') {
    if (HTML_SAFE_KEYS.has(parentKey)) return result;
    return sanitizeText(result);
  }
  return result;
}

function sanitizeText(value) {
  return decodeTextEntities(value)
    .replace(HTML_TAG_PATTERN, '')
    .replace(EVENT_HANDLER_PATTERN, '')
    .replace(SCRIPT_PROTOCOL_PATTERN, '')
    .trim();
}

function decodeTextEntities(value) {
  return String(value ?? '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

// 兼容导出：旧函数名 fillTravelWeatherRisk 保留
export function fillTravelWeatherRisk({ city, weather, business_data, all_cities }) {
  // 直接调用新函数，但不调用天气服务（使用传入的天气数据）
  const cityName = sanitizeText(city || business_data?.jtd?.selected_product?.destination || business_data?.destination || '目的地');
  const ok = !!(weather && weather.ok);
  const current = (weather && weather.current) || {};
  const forecasts = Array.isArray(weather?.forecasts) ? weather.forecasts : [];
  const tips = inferWeatherRiskTips(forecasts, current);

  const lines = [`### ${cityName} 旅居天气风险研判`];
  if (!ok) {
    lines.push('> 暂未获取到该城市的实时天气（未配置腾讯天气接口或接口异常）。建议出行前关注当地气象预报，或稍后重试。');
  } else {
    lines.push(`**当前**：${current.weather || '—'}，${current.temp != null ? current.temp + '℃' : '—'}${current.windDir ? '，' + current.windDir + (current.windPower || '') : ''}。`);
    if (forecasts.length) {
      lines.push('', '**未来几天：**', '| 日期 | 天气 | 温度 | 风 |', '| --- | --- | --- | --- |');
      for (const f of forecasts.slice(0, 5)) {
        const w = f.weather || '—';
        const t = `${f.tempDay != null ? f.tempDay + '°' : '—'}/${f.tempNight != null ? f.tempNight + '°' : '—'}`;
        lines.push(`| ${f.date || f.week || '—'} | ${w} | ${t} | ${f.wind || '—'} |`);
      }
    }
    lines.push('', '**长者风险提示：**');
    for (const t of tips) lines.push(`- ${t}`);
    if (weather?.updatedAt) lines.push(`\n_数据来源：腾讯天气（${weather.updatedAt}）_`);
  }
  // 多城市天气对比（如果 all_cities 存在且有多于1个城市）
  if (Array.isArray(all_cities) && all_cities.length > 1) {
    lines.push('');
    lines.push('### 多城市天气对比');
    for (const c of all_cities) {
      const cur = c.weather?.current || {};
      const tempStr = cur.temp != null ? cur.temp + '°C' : '';
      const windStr = [cur.windDir, cur.windPower].filter(Boolean).join(' ') || '';
      lines.push(`- **${c.city}**：${cur.weather || '未知'} ${tempStr} ${windStr}`.trim());
    }
  }
  const answerText = lines.join('\n');

  return sanitizeModelResult({
    template_id: 'travel_weather_risk_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      city: cityName,
      ok,
      degraded: !ok,
      currentWeather: current.weather || '',
      currentTemp: current.temp != null ? String(current.temp) : '',
      currentWind: [current.windDir, current.windPower].filter(Boolean).join(' ') || '',
      currentHumidity: current.humidity || '',
      currentFeel: current.feelTemp != null ? String(current.feelTemp) : '',
      updatedAt: weather?.updatedAt || '',
      forecasts: forecasts.slice(0, 5).map((f) => ({
        date: f.date || f.week || '',
        weather: f.weather || '',
        nightWeather: f.nightWeather || '',
        tempDay: f.tempDay != null ? String(f.tempDay) : '',
        tempNight: f.tempNight != null ? String(f.tempNight) : '',
        wind: f.wind || '',
      })),
      riskTips: tips.map((t) => ({ text: t })),
      degradedNote: ok ? '' : '暂未获取到实时天气，以下为通用提醒，请以当地实际预报为准。',
    },
    actions: [
      { action_key: 'travel_route.replan', label: '调整行程避开恶劣天气', skill_key: 'travel_route', params: { destination: cityName } },
    ],
    followup_suggestions: [
      { label: '查看可订状态', user_prompt: '请检查这条旅居路线近期是否可预订', action_key: 'travel_route.check_availability', skill_key: 'travel_route', params: { destination: cityName } },
    ],
    model_used: 'flatTalk.travel.weather',
    model_status: ok ? 'ok' : 'degraded',
    template_fit_notes: ['travel_weather_risk'],
  });
}
