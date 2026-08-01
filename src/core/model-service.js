import { createYz365Service } from '../services/yz365/index.js';
import { createShezhenService } from '../services/shezhen/shezhen-service.js';
import crypto from 'node:crypto';

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
  const selectedTemplateId = selectTemplateId({
    message,
    template_id,
    default_template_id,
    template_library,
    intent_context,
  });

  if (selectedTemplateId === 'weekly_plan') {
    return fillWeeklyPlan({ message, business_data });
  }
  if (selectedTemplateId === 'diet_card') {
    return fillDietCard({ message, business_data });
  }
  if (selectedTemplateId === 'route_card') {
    return fillRouteCard({ message, business_data });
  }
  if (selectedTemplateId.startsWith('nearby_')) {
    return fillNearbyResourceCard({ message, business_data, intent_context });
  }
  if (selectedTemplateId === 'travel_itinerary_card') {
    return fillTravelItineraryCard({ message, business_data });
  }
  if (selectedTemplateId === 'health_warning_card'
   || selectedTemplateId === 'health_risk_signal_card'
   || selectedTemplateId === 'health_risk_rule_card'
   || selectedTemplateId === 'risk_assessment_card'
   || selectedTemplateId === 'health_report_card'
   || selectedTemplateId === 'risk_warning_card'
   || selectedTemplateId === 'dietary_regimen_card') {
    return fillHealthWarningCard({ message, business_data, selectedTemplateId });
  }
  if (selectedTemplateId === 'policy_card') {
    return fillPolicyCard({ message, knowledgeService });
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
  if (['dispatch_list', 'dispatch_detail', 'work_order', 'dispatch_status'].includes(selectedTemplateId)) {
    return fillDispatchManageCard({ message, business_data, selectedTemplateId });
  }

  const answerText = sanitizeText(message
    ? `抱歉，我暂时无法处理「${message}」，请稍后重试或换个问法。`
    : '抱歉，我暂时无法处理您的请求，请稍后重试。');
  return sanitizeModelResult({
    template_id: selectedTemplateId || 'answer',
    answer_text: answerText,
    answer: answerText,
    data: {
      title: '桂小养答复',
      skill_name: '通用回答',
      answer_text: answerText,
      answer: answerText,
      metrics: [
        { label: '处理状态', value: '降级兜底' },
        { label: '下一步', value: '请稍后重试或换个问法' },
      ],
    },
    actions: [],
    followup_suggestions: [],
    template_fit_notes: ['fallback_common_answer'],
  });
}

function selectTemplateId({ message, template_id, default_template_id, template_library, intent_context = {} }) {
  if (template_id && template_id !== 'answer') return template_id;
  // template_id='answer' 时不再强制改写为 health_card，保留 answer 作为通用兜底
  if (template_id === 'answer' && template_library?.some(t => t.id === 'answer')) return 'answer';
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
  if (ids.includes('route_card') && isTravelRouteText(text)) return 'route_card';
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
  const msg = String(message || '');
  const has = (re) => re.test(msg);

  // 优先使用传入的老人姓名，其次从 business_data 获取，最后从消息中提取
  const elderName = providedElderName 
    || (business_data && business_data.elder_name) 
    || (business_data && business_data.elderName) 
    || extractElderName(message) 
    || '未知老人';
  const elderAge = providedElderAge 
    || (business_data && business_data.elder_age) 
    || (business_data && business_data.elderAge) 
    || '未知';

  let level = '关注';
  let levelColor = '#FB923C';
  let levelIcon = '⚠️';
  if (has(/紧急|危急|危重|高危|重度/)) {
    level = '紧急'; levelColor = '#EF4444'; levelIcon = '🚨';
  } else if (has(/一般|正常|平稳|无异常|未见异常/)) {
    level = '一般'; levelColor = '#22C55E'; levelIcon = '✅';
  }

  const signals = [];
  if (has(/血压/)) signals.push({ type: '血压', value: '148/92 mmHg', status: 'abnormal', status_label: '异常', source: '本地设备' });
  if (has(/血糖/)) signals.push({ type: '血糖', value: '6.8 mmol/L', status: 'normal', status_label: '正常', source: '本地设备' });
  if (has(/心率/)) signals.push({ type: '心率', value: '92 次/分', status: 'normal', status_label: '正常', source: '本地设备' });
  if (has(/跌倒|离床/)) signals.push({ type: '跌倒/离床', value: '夜间离床 2 次', status: 'abnormal', status_label: '异常', source: '本地设备' });
  if (has(/血氧|呼吸/)) signals.push({ type: '血氧/呼吸', value: '血氧 93%', status: 'abnormal', status_label: '异常', source: '本地设备' });
  if (signals.length === 0) signals.push({ type: '血压', value: '146/90 mmHg', status: 'abnormal', status_label: '异常', source: '本地设备' });

  const rules = [];
  if (has(/血压/)) rules.push({ ruleName: '血压持续偏高', riskLevel: level === '紧急' ? '紧急' : '关注', ruleLevelStatus: 'abnormal', condition: '收缩压≥140 且持续≥3天' });
  if (has(/血糖/)) rules.push({ ruleName: '血糖波动', riskLevel: '关注', ruleLevelStatus: 'abnormal', condition: '空腹血糖波动≥2 mmol/L' });
  if (has(/心率/)) rules.push({ ruleName: '心率异常', riskLevel: '关注', ruleLevelStatus: 'abnormal', condition: '静息心率>90 或<50' });
  if (has(/跌倒|离床/)) rules.push({ ruleName: '跌倒高风险', riskLevel: level === '紧急' ? '紧急' : '关注', ruleLevelStatus: 'abnormal', condition: '近7天夜间离床≥2次或曾有跌倒' });
  if (has(/血氧|呼吸/)) rules.push({ ruleName: '血氧/呼吸异常', riskLevel: level === '紧急' ? '紧急' : '关注', ruleLevelStatus: 'abnormal', condition: '静息血氧<94% 或呼吸异常' });

  const recommendedActions = [
    { action: '每日测量血压并记录', owner: '家属/护理员', priority: '高', priorityStatus: 'high' },
    { action: '减少高盐饮食、保证作息规律', owner: '护理员', priority: '中', priorityStatus: 'mid' },
  ];
  if (has(/血糖/)) recommendedActions.push({ action: '规律监测血糖、控制主食总量', owner: '家属/护理员', priority: '高', priorityStatus: 'high' });
  if (has(/跌倒|离床/)) recommendedActions.push({ action: '居家防跌倒改造、夜间陪护', owner: '护理员', priority: '高', priorityStatus: 'high' });

  const nextSteps = '建议补充远程体检指标（云诊365）以提升判定置信度；如信号持续异常请转人工复核。';
  const remoteGap = has(/云诊365|远程不可用|远程缺失|远程体检/) ? '远程体检指标（云诊365）暂不可用，判定基于本地设备信号，置信度有限。' : '';

  const assessTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const isSignalCard = selectedTemplateId === 'health_risk_signal_card';
  const isRuleCard = selectedTemplateId === 'health_risk_rule_card';

  return {
    badge: isSignalCard ? '设备信号' : isRuleCard ? '风险规则' : '健康风险预警',
    elderName, elderAge, assessTime,
    level, levelColor, levelIcon,
    summary: `结合老人近 7 天设备信号与风险规则，当前风险等级为“${level}”，建议加强居家观察并补充远程指标。`,
    signals_count: signals.length,
    signals,
    rules_count: rules.length,
    rules,
    actions_count: recommendedActions.length,
    recommendedActions,
    nextSteps,
    remoteGap,
    sourceLabel: isSignalCard ? '本地设备信号' : isRuleCard ? '健康风险预警规则库' : '本地设备信号 + 风险规则',
  };
}

async function fillHealthWarningCard({ message, business_data, selectedTemplateId = 'health_warning_card', yz365Service } = {}) {
  // 尝试从云诊365获取真实数据
  const elderName = business_data?.elder_name || business_data?.elderName || extractElderName(message) || '未知老人';
  
  let yzData = null;
  let hasYzData = false;
  let shezhenData = null;
  let hasShezhenData = false;

  try {
    const service = yz365Service || getYz365Service();
    const yzResult = await service.getElderHealthCheck(elderName);

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
        { action_key: 'health_risk_warning.request_manual_review', label: '请求人工复核/转接', payload: {} },
        { action_key: 'health_risk_warning.fill_elder_info', label: '补充老人信息', payload: {} },
      ],
      followup_suggestions: [
        { label: '查看体检报告详情', user_prompt: '查看体检报告详情', action_key: 'health_risk_warning.view_report' },
        { label: '查看风险规则命中', user_prompt: '查看风险规则命中', action_key: 'health_risk_warning.view_rule_detail' },
        { label: '转人工复核', user_prompt: '转人工复核', action_key: 'health_risk_warning.request_manual_review' },
      ],
      template_fit_notes: ['yz365_health_risk_warning', 'shezhen_health_risk_warning'],
    });
  }

  // 没有云诊数据时，使用本地模拟数据
  const data = buildHealthWarningData({ message, business_data, selectedTemplateId, elderName });
  const answerText = `当前未获取到${elderName}的云诊体检报告数据，暂时无法进行健康风险评估，建议确认体检数据是否已上传至系统后再进行评估。`;
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
  // 尝试提取老人姓名：周舟老人、张奶奶、李爷爷等
  const match = text.match(/([^\s,，。！？、]+?)(老人|奶奶|爷爷|伯伯|婆婆|公公|长辈)/);
  return match ? match[1] : null;
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

// 腾讯地图 JS API Key（已验证可用的项目 key）。留空或占位符时卡片自动降级为 SVG 方位图。
const NEARBY_TENCENT_JS_KEY = 'KI4BZ-5GGLT-POOXY-LQK77-6XA62-YVFPH';

/**
 * 构建腾讯静态图 URL（降级中间层）
 * 用于 JS API 加载失败时，提供比 SVG 更真实的地图截图。
 */
function buildStaticMapUrl(center, markers = [], options = {}) {
  const wsKey = process.env.TENCENT_MAP_KEY || '';
  const sk = process.env.TENCENT_MAP_SK || '';
  if (!wsKey) return '';

  const params = {
    center: `${center.lat},${center.lng}`,
    zoom: options.zoom || 11,
    size: options.size || '600*420',
  };
  if (markers.length) {
    params.markers = markers.slice(0, 30).map((m) =>
      `coord:${m.lat},${m.lng};title:${(m.name || '').slice(0, 10)}`
    ).join('|');
  }
  const signParams = { ...params, key: wsKey };
  const sortedQuery = Object.keys(signParams).sort()
    .map((k) => `${k}=${signParams[k]}`).join('&');
  let url = `https://apis.map.qq.com/ws/staticmap/v2?${sortedQuery}`;
  if (sk) {
    const sig = crypto.createHash('md5').update(`/ws/staticmap/v2?${sortedQuery}${sk}`, 'utf8').digest('hex');
    url += '&sig=' + sig;
  }
  return url;
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
    radiusKm,
    map_key: NEARBY_TENCENT_JS_KEY,
    center_json,
    stats,
    statsLabels: nbStatsLabels(stats),
    category: cat,
    categoryLabel: nbCatLabel(cat),
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
      { key: 'sos.call_120', label: '📞 立即拨打120' },
      { key: 'sos.notify_family', label: '👪 通知家属' },
    ],
    followup_suggestions: [
      { key: 'sos.call_120', label: '拨打120' },
      { key: 'sos.notify_family', label: '通知家属' },
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
        elderName: '黄秀英',
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

  const top = catalog.slice(0, 4).map((s) => ({
    id: s.service_id, name: s.name, category: s.category,
    price: s.price_from, unit: s.unit, tags: (s.scene_tags || []).join('/'), desc: s.description,
  }));
  const org = orgs[0] || {};
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

function fillRouteCardLegacy({ message, business_data }) {
  const routes = Array.isArray(business_data?.routes) ? business_data.routes : [];
  const route = selectTravelRoute(message, routes);
  const destination = sanitizeText(route?.destination || inferDestination(message));
  const budgetLevel = sanitizeText(route?.budget_level || inferBudget(message));
  const season = sanitizeText(route?.season || inferSeason(message));
  const bookingStatus = sanitizeText(route?.booking_status || '可咨询余量');
  const healthTags = sanitizeText(route?.health_tags || '慢病友好,低强度,医疗可达');
  const answerText = `已为您推荐${destination}康养旅居路线，按${budgetLevel}和老人低强度出行节奏规划。`;

  return sanitizeModelResult({
    template_id: 'route_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      routeTitle: `${destination}康养旅居三日路线`,
      destination,
      season,
      budgetLevel,
      days: /四天|4天|four/i.test(message) ? '4天3晚' : '3天2晚',
      suitable: inferTravelSuitable(message),
      bookingStatus,
      summary: buildRouteSummary(destination, budgetLevel),
      highlights: buildTravelHighlights(healthTags, destination),
      itinerary: buildItinerary(destination),
      healthNotice: buildTravelHealthNotice(message),
    },
    actions: [
      { action_key: 'travel_route.compare_destinations', label: '对比目的地', params: { destination } },
      { action_key: 'travel_route.check_availability', label: '检查可订状态', params: { destination } },
      { action_key: 'travel_route.calculate_budget', label: '测算旅居预算', params: { budget_level: budgetLevel } },
    ],
    followup_suggestions: [
      {
        label: '换成北海路线',
        user_prompt: '请把这条旅居路线调整为广西北海方向',
        action_key: 'travel_route.replan',
      },
      {
        label: '查天气风险',
        user_prompt: '请检查这条旅居路线近期天气风险',
        action_key: 'travel_route.check_weather_risk',
        params: { destination, city: destination },
      },
    ],
    template_fit_notes: [],
  });
}

function selectTravelRoute(message, routes) {
  const text = String(message || '');
  if (/北海|海边|海滨/.test(text)) return routes.find((route) => /北海/.test(route.destination)) || routes[1] || routes[0];
  if (/巴马|长寿/.test(text)) return routes.find((route) => /巴马/.test(route.destination)) || routes[0];
  return routes[0] || null;
}

function inferDestination(message) {
  // 优先匹配明确的城市名
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
  const src = jtd.source_status === 'real_data' ? '金跳动真实接口' : '厂家接口联调 mock 数据';
  const priceText = priceLabel ? `参考价${priceLabel}；` : '';
  return `${productName || destination}；${priceText}来源=${src}；产品ID=${product.product_id || '待确认'}。`;
}

function buildTravelHighlights(healthTags, destination) {
  const tags = healthTags.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  return [...new Set([...tags, destination.includes('北海') ? '海滨慢行' : '康养基地', '家属可陪同'])].slice(0, 5);
}

function buildItinerary(destination, days = 3) {
  // 根据实际天数构建行程
  const itinerary = [];
  const totalDays = Math.max(1, Math.min(30, parseInt(days) || 3));
  
  for (let i = 0; i < totalDays; i++) {
    const dayNum = i + 1;
    let plan = '';
    
    if (i === 0) {
      plan = `抵达${destination}，办理入住，完成健康情况确认，安排轻松周边散步。`;
    } else if (i === totalDays - 1) {
      plan = '根据体力选择短途游览或返程，预留交通缓冲，避免赶行程。';
    } else {
      // 中间天数：康养活动或基地体验
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

function fillRouteCard({ message, business_data }) {
  const routes = Array.isArray(business_data?.routes) ? business_data.routes : [];
  const jtd = business_data?.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);

  if (jtd.required === true && !product && jtd.source_status !== 'mock_vendor_data') {
    return fillRouteRemoteGap({ message, jtd, routes });
  }

  const route = selectTravelRoute(message, routes);
  const destination = sanitizeText(business_data?.primary_city || product?.destination || product?.city || route?.destination || inferDestination(message));
  const budgetLevel = sanitizeText(route?.budget_level || inferBudget(message));
  const priceLabel = sanitizeText(product?.price_label || '');
  const season = sanitizeText(route?.season || inferSeason(message));
  const bookingStatus = sanitizeText(buildJtdBookingStatus(jtd, product, route));
  const healthTags = sanitizeText((Array.isArray(product?.tags) && product.tags.length ? product.tags.join(',') : '') || route?.health_tags || '慢病友好,低强度,医疗可达');
  const productName = sanitizeText(product?.product_name || '');
  
  // 从产品数据中提取天数
  const daysFromProduct = parseInt(product?.days || product?.nights || 0) + 1;
  const daysFromTitle = parseInt(productName?.match(/(\d+)天/)?.[1] || 0);
  const totalDays = daysFromProduct || daysFromTitle || 3;
  
  // 调试日志：检查产品数据
  console.log('[fillRouteCard] product data:', {
    productName,
    days: product?.days,
    nights: product?.nights,
    daysFromProduct,
    daysFromTitle,
    totalDays,
    raw: product?.raw,
  });
  
  const answerText = product
    ? (jtd.source_status === 'real_data'
        ? `已调用金跳动真实接口，为您匹配到${productName || destination}，可继续查看详情或做可售校验。`
        : `当前使用金跳动厂家联调 mock 数据，为您匹配到${productName || destination}；这不是正式可订结果。`)
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

  return sanitizeModelResult({
    template_id: 'route_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      routeTitle: `${productName || destination}康养旅居路线`,
      destination,
      season,
      budgetLevel,
      priceLabel,
      days: /四天|4天|four/i.test(message) ? '4天3晚' : `${totalDays}天${totalDays - 1}晚`,
      suitable: inferTravelSuitable(message),
      bookingStatus,
      summary: buildRouteCardSummary({ product, productName, destination, jtd, priceLabel, budgetLevel }),
      highlights: buildTravelHighlights(healthTags, destination),
      itinerary: buildItinerary(destination, totalDays),
      healthNotice: buildTravelHealthNotice(message),
      jtdStatus: jtd.source_status || '',
      productId: product?.product_id || '',
      skuId: product?.sku_id || '',
    },
    actions: [
      { action_key: 'travel_route.compare_destinations', label: '对比目的地', params: productParams },
      ...(product ? [{ action_key: 'travel_route.check_availability', label: '检查可订状态', params: productParams }] : []),
      { action_key: 'travel_route.calculate_budget', label: '测算旅居预算', params: { ...productParams, budget_level: budgetLevel } },
    ],
    followup_suggestions: [
      {
        label: '换成北海路线',
        user_prompt: '请把这条旅居路线调整为广西北海方向',
        action_key: 'travel_route.replan',
      },
      {
        label: '查天气风险',
        user_prompt: '请检查这条旅居路线近期天气风险',
        action_key: 'travel_route.check_weather_risk',
        params: { city: destination },
      },
    ],
    compact_followups: compactFollowups,
    template_fit_notes: product ? [`jtd_${jtd.source_status || 'unknown'}`] : [],
  });
}

function fillTravelItineraryCard({ message, business_data }) {
  const routeResult = fillRouteCard({ message, business_data });
  const routeData = routeResult.data || {};
  const destination = sanitizeText(routeData.destination || inferDestination(message));
  const productName = sanitizeText(String(routeData.routeTitle || '').replace(/康养旅居路线$/, '')) || destination;
  
  // 从产品数据中提取天数
  const product = business_data?.jtd?.selected_product || business_data?.jtd?.products?.[0];
  const daysFromProduct = parseInt(product?.days || product?.nights || 0) + 1;
  const daysFromTitle = parseInt(routeData.routeTitle?.match(/(\d+)天/)?.[1] || 0);
  const totalDays = daysFromProduct || daysFromTitle || 3;
  
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
  const sourceText = routeData.jtdStatus === 'real_data'
    ? '来源：金跳动真实接口'
    : routeData.jtdStatus === 'mock_vendor_data'
      ? '来源：厂家联调数据'
      : '来源：本地行程建议';

  return sanitizeModelResult({
    ...routeResult,
    template_id: 'travel_itinerary_card',
    data: {
      title: `${productName}行程安排`,
      intro: `${sourceText}。按低强度、少赶路、每日留足休息时间来安排，适合长者和家属陪同出行。`,
      days,
      note: '行程可随身体状态、天气和可订日期灵活调整；下单前请继续做金跳动可售校验。',
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
        { text: '查询北海天气', action_key: 'travel_route.check_weather_risk', params: { city: '广西北海' } },
        { text: '查询昆明天气', action_key: 'travel_route.check_weather_risk', params: { city: '云南昆明' } },
        { text: '查询三亚天气', action_key: 'travel_route.check_weather_risk', params: { city: '海南三亚' } },
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
      { action_key: 'travel_route.replan', label: '调整行程避开恶劣天气', params: { destination: cityName } },
    ],
    followup_suggestions: [
      { label: '查看可订状态', user_prompt: '请检查这条旅居路线近期是否可预订', action_key: 'travel_route.check_availability', params: { destination: cityName } },
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
  return sanitizeModelResult({
    template_id: 'route_card',
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
    },
    actions: [
      { action_key: 'travel_route.request_manual_review', label: '请求人工复核', params: { reason: 'jtd_unavailable', destination } },
      { action_key: 'travel_route.replan', label: '重新规划路线', params: { destination } },
    ],
    followup_suggestions: [
      {
        label: '补充出行偏好',
        user_prompt: '我先补充出行日期、人数和预算，等接口恢复后再校验可订状态',
        action_key: 'travel_route.fill_preferences',
      },
    ],
    template_fit_notes: ['jtd_remote_gap'],
  });
}

function buildJtdBookingStatus(jtd, product, route) {
  if (!product) return route?.booking_status || '可咨询余量';
  if (jtd.availability?.normalized?.available) return '金跳动已校验可订';
  if (jtd.availability && !jtd.availability.normalized?.available) return '金跳动已校验，当前日期不可订';
  if (jtd.source_status === 'real_data') return '金跳动已返回真实产品，待日期可售校验';
  if (jtd.source_status === 'mock_vendor_data') return '厂家接口联调 mock 数据，不能视为真实可订';
  return '金跳动接口状态待确认';
}

function sanitizeModelResult(result) {
  if (Array.isArray(result)) return result.map((item) => sanitizeModelResult(item));
  if (result && typeof result === 'object') {
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, sanitizeModelResult(value)]));
  }
  if (typeof result === 'string') return sanitizeText(result);
  return result;
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(HTML_TAG_PATTERN, '')
    .replace(EVENT_HANDLER_PATTERN, '')
    .replace(SCRIPT_PROTOCOL_PATTERN, '')
    .trim();
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
      { action_key: 'travel_route.replan', label: '调整行程避开恶劣天气', params: { destination: cityName } },
    ],
    followup_suggestions: [
      { label: '查看可订状态', user_prompt: '请检查这条旅居路线近期是否可预订', action_key: 'travel_route.check_availability', params: { destination: cityName } },
    ],
    model_used: 'flatTalk.travel.weather',
    model_status: ok ? 'ok' : 'degraded',
    template_fit_notes: ['travel_weather_risk'],
  });
}
