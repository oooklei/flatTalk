import { createYz365Service } from '../services/yz365/index.js';

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

export async function fillTemplateSlots({
  message = '',
  template_id = '',
  default_template_id = '',
  template_library = [],
  business_data = {},
  intent_context = {},
  knowledgeService = null,
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
  if (selectedTemplateId === 'travel_itinerary_card') {
    return fillTravelItineraryCard({ message, business_data });
  }
  if (selectedTemplateId === 'health_warning_card' || selectedTemplateId === 'health_risk_signal_card' || selectedTemplateId === 'health_risk_rule_card') {
    return fillHealthWarningCard({ message, business_data, selectedTemplateId });
  }
  if (selectedTemplateId === 'policy_card') {
    return fillPolicyCard({ message, knowledgeService });
  }

  const answerText = sanitizeText(message ? `已收到：${message}` : '已收到您的问题。');
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
        { label: '处理状态', value: '已接收' },
        { label: '下一步', value: '请补充老人情况' },
      ],
    },
    actions: [],
    followup_suggestions: [],
    template_fit_notes: ['fallback_common_answer'],
  });
}

function selectTemplateId({ message, template_id, default_template_id, template_library, intent_context = {} }) {
  if (template_id && template_id !== 'answer') return template_id;
  if (template_id === 'answer') return 'health_card';
  const templates = Array.isArray(template_library) ? template_library : [];
  const ids = templates.map((item) => item.id).filter(Boolean);

  const text = `${message} ${templates.map((item) => item.match || '').join(' ')}`;
  // 优先消费场景路由识别出的周计划意图；并兜底识别"周一…周日"等结构化一周表述
  const isWeekly = intent_context?.intent === 'meal_plan_weekly_plan'
    || isWeeklyPlanText(message)
    || isStructuredWeekText(message);
  if (ids.includes('weekly_plan') && isWeekly) return 'weekly_plan';
  if (ids.includes('policy_card') && isPolicyText(message)) return 'policy_card';
  if (ids.includes('diet_card') && isMealPlanText(text)) return 'diet_card';
  if (ids.includes('route_card') && isTravelRouteText(text)) return 'route_card';
  if (ids.includes('health_warning_card') && isHealthRiskText(text)) return 'health_warning_card';
  if (default_template_id && ids.includes(default_template_id)) return default_template_id;
  return ids[0] || default_template_id || 'answer';
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

  // 如果有云诊数据，使用云诊数据构建卡片
  if (hasYzData && yzData?.hasData) {
    const data = buildHealthWarningDataFromYz365(yzData, selectedTemplateId);
    const answerText = `已为${data.elderName}完成健康风险研判（基于云诊365体检报告），风险等级：${data.level}。体检时间：${data.checkTime || '近期'}，健康指数：${data.healthIndex || '暂无'}。`;
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
      template_fit_notes: ['yz365_health_risk_warning'],
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
  if (/北海|海边|海滨/.test(message)) return '广西北海';
  if (/桂林|山水/.test(message)) return '广西桂林';
  if (/南宁/.test(message)) return '广西南宁';
  return '广西巴马';
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

function buildItinerary(destination) {
  return [
    { day: 'D1', plan: `抵达${destination}，办理入住，完成健康情况确认，安排轻松周边散步。` },
    { day: 'D2', plan: '上午康养活动或基地体验，下午低强度游览，晚间保留充分休息时间。' },
    { day: 'D3', plan: '根据体力选择短途游览或返程，预留交通缓冲，避免赶行程。' },
  ];
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
  const destination = sanitizeText(product?.destination || product?.city || route?.destination || inferDestination(message));
  const budgetLevel = sanitizeText(route?.budget_level || inferBudget(message));
  const priceLabel = sanitizeText(product?.price_label || '');
  const season = sanitizeText(route?.season || inferSeason(message));
  const bookingStatus = sanitizeText(buildJtdBookingStatus(jtd, product, route));
  const healthTags = sanitizeText((Array.isArray(product?.tags) && product.tags.length ? product.tags.join(',') : '') || route?.health_tags || '慢病友好,低强度,医疗可达');
  const productName = sanitizeText(product?.product_name || '');
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
      days: /四天|4天|four/i.test(message) ? '4天3晚' : '3天2晚',
      suitable: inferTravelSuitable(message),
      bookingStatus,
      summary: buildRouteCardSummary({ product, productName, destination, jtd, priceLabel, budgetLevel }),
      highlights: buildTravelHighlights(healthTags, destination),
      itinerary: buildItinerary(destination),
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
      },
    ],
    template_fit_notes: product ? [`jtd_${jtd.source_status || 'unknown'}`] : [],
  });
}

function fillTravelItineraryCard({ message, business_data }) {
  const routeResult = fillRouteCard({ message, business_data });
  const routeData = routeResult.data || {};
  const destination = sanitizeText(routeData.destination || inferDestination(message));
  const productName = sanitizeText(String(routeData.routeTitle || '').replace(/康养旅居路线$/, '')) || destination;
  
  // 从 routeData.itinerary 或构建默认行程
  const rawItinerary = Array.isArray(routeData.itinerary) ? routeData.itinerary : buildItinerary(destination);
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
    return buildItinerary(destination)[idx] || { day: `D${idx + 1}`, plan: '' };
  });
  
  const days = itinerary.map((item, index) => buildItineraryDay(item, index, destination));
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
export function fillTravelWeatherRisk({ city = '', weather = null, business_data = {} } = {}) {
  const cityName = sanitizeText(
    city
    || business_data?.jtd?.selected_product?.destination
    || business_data?.destination
    || '目的地'
  );
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

function buildItineraryDay(item = {}, index = 0, destination = '') {
  const day = sanitizeText(item.day || `D${index + 1}`);
  // plan 可能是字符串或对象，需要正确处理
  const planValue = item.plan;
  const planText = typeof planValue === 'string' 
    ? planValue 
    : (planValue && typeof planValue === 'object' && planValue.text) 
      ? planValue.text 
      : '';
  const plan = sanitizeText(planText);
  const theme = index === 0
    ? `抵达${destination || '目的地'}`
    : index === 1
      ? '康养体验'
      : '轻松返程';
  const slots = index === 0
    ? [
        { time: '上午', text: `抵达${destination || '目的地'}，办理入住，熟悉周边环境。` },
        { time: '下午', text: plan || '完成健康情况确认，安排轻松周边散步。' },
        { time: '傍晚', text: '基地或酒店附近慢行，早些休息。' },
      ]
    : index === 1
      ? [
        { time: '上午', text: '参加康养活动或基地体验，控制步行强度。' },
        { time: '下午', text: plan || '低强度游览，保留午休和补水时间。' },
        { time: '傍晚', text: '清淡晚餐后休息，确认次日安排。' },
      ]
      : [
        { time: '上午', text: plan || '根据体力选择短途游览或返程。' },
        { time: '下午', text: '预留交通缓冲，避免赶行程。' },
      ];
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
