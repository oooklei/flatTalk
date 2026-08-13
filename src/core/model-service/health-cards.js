// 健康类卡片：健康风险预警卡（health_warning_card / health_risk_signal_card / health_risk_rule_card /
// health_report_card / risk_warning_card / dietary_regimen_card）。
// 健康下钻卡（constitution_card / tongue_diagnosis_card 等）由 extra-template-fills 提供。
// 这里主要负责：合并云诊365 + 云诊舌诊的远程数据 → 输出统一健康风险卡。

import { sanitizeModelResult } from './utils.js';
import { getYz365Service, getShezhenService } from './services.js';
import { findEldersByName } from '../../services/interface-data/mock-collaboration.js';
import { fillElderDuplicateConfirmCard } from '../model-runtime/extra-template-fills.js';
import { elderEntityParams, withEntityParams } from '../conversation/entity-params.js';

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
  const extractedName = extractElderNameLocal(message);
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
    const szService = shezhenServiceLocal() || getShezhenService();
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
    if (elderName) data.elder_name = elderName;
    if (elderId) data.elder_id = elderId;
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
      actions: [],
      followup_suggestions: [
        { label: '重新读取信号', user_prompt: '请重新读取设备健康信号', action_key: 'health_risk_warning.refresh_signals', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
        { label: '查看规则命中', user_prompt: '请展示触发预警的具体规则', action_key: 'health_risk_warning.view_rule_detail', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
        { label: '综合风险评估', user_prompt: '查看综合风险评估', action_key: 'health_risk_warning.view_assessment', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
        { label: '查看体检报告详情', user_prompt: '查看体检报告详情', action_key: 'health_risk_warning.view_report', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
        { label: '查看体质详情', user_prompt: '查看中医体质辨识', action_key: 'health_risk_warning.view_constitution', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
        { label: '查看舌诊详情', user_prompt: '查看舌诊详情', action_key: 'health_risk_warning.view_tongue', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
        { label: '查看调理方案', user_prompt: '查看个性化调理方案', action_key: 'health_risk_warning.view_advice', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
        { label: '转人工复核', user_prompt: '转人工复核', action_key: 'health_risk_warning.request_manual_review', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
        { label: '补充老人信息', user_prompt: '补充老人信息', action_key: 'health_risk_warning.fill_elder_info', params: { ...(elderId ? { elder_id: elderId } : {}), ...(elderName ? { elder_name: elderName } : {}) } },
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
      actions: [],
      followup_suggestions: [
        { label: '选择/绑定老人档案', user_prompt: '选择或绑定老人档案', action_key: 'health_risk_warning.fill_elder_info' },
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
    data: { ...data, yz365Gap: true, elder_id: elderId || '', elder_name: elderName || '', elderName: elderName || '' },
    actions: [],
    followup_suggestions: withEntityParams([
      { label: '重新读取信号', user_prompt: '请重新读取设备健康信号', action_key: 'health_risk_warning.refresh_signals' },
      { label: '查看规则命中', user_prompt: '请展示触发预警的具体规则', action_key: 'health_risk_warning.view_rule_detail' },
      { label: '转人工复核', user_prompt: '转人工复核', action_key: 'health_risk_warning.request_manual_review' },
      { label: '补充老人信息', user_prompt: '补充老人信息', action_key: 'health_risk_warning.fill_elder_info' },
      { label: '如何上传云诊体检报告？', user_prompt: '如何上传云诊体检报告？' },
      { label: '体检报告需要包含哪些指标？', user_prompt: '体检报告需要包含哪些指标？' },
    ], elderEntityParams({ elder_id: elderId, elder_name: elderName, elderName }, business_data)),
    template_fit_notes: ['fallback_health_risk_warning'],
  });
}

// 健康模块内部的 extractElderName 实现（与 utils.extractElderName 行为一致，但避免循环依赖）
// 直接复用 utils.extractElderName 即可，这里只做转发。
import { extractElderName } from './utils.js';
function extractElderNameLocal(message) {
  return extractElderName(message);
}

// shezhenService 单例从 services.js 拿不到内部变量值（导出的是 null 占位），
// 这里通过 getShezhenService() 取实际实例；保留原代码 `shezhenService || getShezhenService()` 的语义。
function shezhenServiceLocal() {
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

export {
  fillHealthWarningCard,
};
