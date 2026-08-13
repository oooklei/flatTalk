// 找服务类卡片 + 服务质量评估卡。
// - fillFindServiceCard：service_recommend / service_detail / service_catalog / org_profile / worker_profile /
//   order_preview / order_status / service_booking_confirm / booking_success / booking_reschedule / contact_confirm
// - fillServiceEmergencyCard：SOS 紧急求助卡
// - fillServiceTransitionalCard：service_card / service_intent / service_thinking 过渡态卡
// - fillServiceQualityEvalCard：institution_quality_report / staff_quality_report / org_quality_ranking /
//   staff_quality_ranking / rectification_suggestion / complaint_detail / evaluation_standard

import { sanitizeModelResult } from './utils.js';
import {
  pickByLockedId,
  withEntityParams,
  findServiceEntityParams,
  qualityEntityParams,
} from '../conversation/entity-params.js';

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
      provider_avail_text: (() => {
        const raw = svc.provider_avail ?? svc.availability ?? svc.avail_pct;
        if (raw === null || raw === undefined || raw === '') return '可预约';
        const n = Number(raw);
        if (Number.isFinite(n)) return `空闲${n}%`;
        const text = String(raw).trim();
        if (/%$/.test(text) || /可约|可预约|空闲/.test(text)) return text.replace(/空闲\s*/, '空闲');
        return text;
      })(),
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
    // 卡片内已有 tel:120 / 通知家属；追问只保留「我已安全」，避免三层同文案
    followup_suggestions: [
      {
        action_key: 'find_service.sos_mark_safe',
        label: '我已安全',
        user_prompt: '我已经安全了，取消紧急求助',
      },
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
  const elderName = bd.elder_name || bd.elderName || '';
  const elderId = bd.elder_id || '';
  const svc = pickByLockedId(catalog, bd.service_id, ['service_id', 'id'], { allowFallback: !bd.service_id }) || {};
  const org = pickByLockedId(orgs, bd.org_id, ['org_id', 'id'], { allowFallback: !bd.org_id }) || {};
  const worker = pickByLockedId(workers, bd.worker_id, ['worker_id', 'id'], { allowFallback: !bd.worker_id })
    || (!bd.worker_id ? (workers.find((x) => x.available) || workers[0] || {}) : {});
  const order = pickByLockedId(orders, bd.order_id, ['order_id', 'id'], { allowFallback: !bd.order_id }) || {};
  const entityBase = findServiceEntityParams({
    elder_id: elderId,
    elder_name: elderName,
    service_id: svc.service_id || bd.service_id || '',
    org_id: org.org_id || bd.org_id || '',
    worker_id: worker.worker_id || worker.id || bd.worker_id || '',
    order_id: order.order_id || bd.order_id || '',
  }, bd);

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
      data: { sceneTitle: '养老服务目录', total: catalog.length, categories, elder_id: elderId, elder_name: elderName },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '智能推荐', user_prompt: '请智能推荐适合的养老服务', action_key: 'find_service.recommend' },
        { label: '全部服务', user_prompt: '查看全部养老服务目录', action_key: 'find_service.catalog' },
      ], entityBase),
      template_fit_notes: [],
    });
  }

  if (tpl === 'org_profile') {
    const answerText = `为您介绍服务机构：${org.org_name || '桂小养康养中心'}。`;
    return sanitizeModelResult({
      template_id: 'org_profile',
      answer_text: answerText, answer: answerText,
      data: {
        orgName: org.org_name || '桂小养康养中心',
        org_id: org.org_id || '',
        orgType: org.org_type || 'institution',
        address: org.address || '',
        scope: org.service_scope || '',
        bedCount: org.bed_count || 0,
        price: org.price_from || 0,
        rating: org.rating || 0,
        certified: org.certified ? '已认证' : '未认证',
        elder_id: elderId,
        elder_name: elderName,
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '查看机构', user_prompt: '有哪些养老机构可以入住', action_key: 'find_service.list_orgs' },
        { label: '查看服务人员', user_prompt: '我想找护工上门护理', action_key: 'find_service.list_workers' },
      ], { ...entityBase, org_id: org.org_id || entityBase.org_id }),
      template_fit_notes: [],
    });
  }

  if (tpl === 'worker_profile') {
    const answerText = `为您推荐服务人员：${worker.name || '韦芳'}。`;
    return sanitizeModelResult({
      template_id: 'worker_profile',
      answer_text: answerText, answer: answerText,
      data: {
        name: worker.name || '韦芳',
        worker_id: worker.worker_id || worker.id || '',
        skillTags: (worker.skill_tags || []).join('、'),
        certLevel: worker.cert_level || '',
        area: worker.service_area || '',
        rating: worker.rating || 0,
        orderCount: worker.order_count || 0,
        available: worker.available ? '可接单' : '暂不接单',
        elder_id: elderId,
        elder_name: elderName,
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '看机构', user_prompt: '有哪些养老机构可以入住', action_key: 'find_service.list_orgs' },
        { label: '智能推荐', user_prompt: '请智能推荐适合的养老服务', action_key: 'find_service.recommend' },
      ], { ...entityBase, worker_id: worker.worker_id || worker.id || entityBase.worker_id }),
      template_fit_notes: [],
    });
  }

  if (tpl === 'order_preview') {
    const answerText = `请确认「${svc.name || '上门护理'}」订单信息后提交。`;
    return sanitizeModelResult({
      template_id: 'order_preview',
      answer_text: answerText, answer: answerText,
      data: {
        pageTitle: '确认您的订单',
        cardTitle: '请确认您的订单',
        orderId: order.order_id || 'so_new',
        order_id: order.order_id || 'so_new',
        elderName: elderName,
        elder_id: elderId,
        elder_name: elderName,
        serviceName: svc.name || '上门护理',
        service_id: svc.service_id || '',
        orgName: org.org_name || '',
        org_id: org.org_id || '',
        dateDisplay: order.expected_time || '明天（待确认）',
        timeSlot: order.time_slot || '09:00-11:00',
        contactName: elderName || '张大爷',
        contactPhone: business_data?.phone || '138****5678',
        contactAddress: business_data?.address || '桂林市秀峰区丽君路123号',
        confirmBtnText: '确认下单',
        changeOptions: ['改日期', '改时段', '改信息', '改备注'],
        formBtnText: '改用表单填写',
        footSource: '订单确认',
        price: svc.price_from || 0,
        unit: svc.unit || '次',
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '查看订单', user_prompt: '查看我的服务订单', action_key: 'find_service.detail_order' },
        { label: '全部服务', user_prompt: '查看全部养老服务目录', action_key: 'find_service.catalog' },
        { label: '找护工上门', user_prompt: '我想找护工上门护理', action_key: 'find_service.list_workers' },
      ], entityBase),
      template_fit_notes: [],
    });
  }

  if (tpl === 'service_booking_confirm') {
    const answerText = `已为「${svc.name || '居家服务'}」推荐预约时间，请确认或修改。`;
    return sanitizeModelResult({
      template_id: 'service_booking_confirm',
      answer_text: answerText, answer: answerText,
      data: {
        pageTitle: '预约确认',
        cardEyebrow: '预约确认',
        serviceName: svc.name || '居家深度清洁',
        heroSub: 'AI 已为您推荐最优服务时间',
        dateLabel: '预约日期',
        dateDisplay: order.expected_time || '明天（待确认）',
        dateValue: order.expected_date || '待确认',
        recommendTag: 'AI智能推荐',
        hintText: '您可以说“好的”确认，或告诉我其他日期，如“后天”、“下周三”。',
        confirmBtnText: '确认',
        modifyBtnText: '修改',
        footSource: 'AI预约确认',
        service_id: svc.service_id || '',
        elder_id: elderId,
        elder_name: elderName,
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '改期', user_prompt: '我想修改预约日期', action_key: 'find_service.booking_reschedule', params: { template_id: 'booking_reschedule' } },
        { label: '确认下单', user_prompt: '请确认我的订单', action_key: 'find_service.preview_order', params: { template_id: 'order_preview' } },
      ], { ...entityBase, service_id: svc.service_id || entityBase.service_id }),
      template_fit_notes: [],
    });
  }

  if (tpl === 'booking_success') {
    const answerText = `「${svc.name || '居家服务'}」预约已安排，请留意来电确认。`;
    return sanitizeModelResult({
      template_id: 'booking_success',
      answer_text: answerText, answer: answerText,
      data: {
        pageTitle: '预约成功',
        cardTitle: '预约成功',
        cardSub: '已为您安排服务，请注意接听来电',
        dateLabel: '预约日期',
        dateDisplay: order.expected_time || '明天（待确认）',
        serviceName: svc.name || '居家深度清洁',
        dateValue: order.expected_date || '待确认',
        recommendTag: 'AI智能推荐',
        contactNote: '服务人员将于服务前 30 分钟电话与您确认，如需调整请提前联系客服。',
        footSource: 'AI预约确认',
        service_id: svc.service_id || '',
        elder_id: elderId,
        elder_name: elderName,
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '改期', user_prompt: '我想修改预约日期', action_key: 'find_service.booking_reschedule', params: { template_id: 'booking_reschedule' } },
        { label: '查看服务', user_prompt: '查看服务详情', action_key: 'find_service.detail_service', params: { template_id: 'service_detail' } },
      ], { ...entityBase, service_id: svc.service_id || entityBase.service_id }),
      template_fit_notes: [],
    });
  }

  if (tpl === 'booking_reschedule') {
    const answerText = `请为「${svc.name || '居家服务'}」选择改期日期。`;
    return sanitizeModelResult({
      template_id: 'booking_reschedule',
      answer_text: answerText, answer: answerText,
      data: {
        pageTitle: '修改预约日期',
        cardEyebrow: '修改预约',
        serviceName: svc.name || '居家深度清洁',
        heroSub: '为您推荐以下可预约日期，点击即可改期',
        contactNote: '以上日期均可预约，确认后服务人员将致电与您核对上门时间。',
        footSource: 'AI预约确认',
        altDates: business_data?.alt_dates || [
          { day: '明天', week: '建议优先' },
          { day: '后天', week: '可预约' },
          { day: '下周一', week: '可预约' },
        ],
        service_id: svc.service_id || '',
        elder_id: elderId,
        elder_name: elderName,
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '返回预约确认', user_prompt: '返回预约确认', action_key: 'find_service.booking_confirm', params: { template_id: 'service_booking_confirm' } },
      ], { ...entityBase, service_id: svc.service_id || entityBase.service_id }),
      template_fit_notes: [],
    });
  }

  if (tpl === 'contact_confirm') {
    const answerText = '请确认联系人、电话与上门地址。';
    return sanitizeModelResult({
      template_id: 'contact_confirm',
      answer_text: answerText, answer: answerText,
      data: {
        pageTitle: '联系人信息确认',
        cardTitle: '联系人信息',
        contactName: elderName || '张大爷',
        contactPhone: business_data?.phone || '138****5678',
        contactAddress: business_data?.address || '桂林市秀峰区丽君路123号',
        sourceNote: '来自您的健康档案',
        confirmBtnText: '确认',
        modifyBtnText: '修改',
        footSource: '联系人确认',
        elder_id: elderId,
        elder_name: elderName,
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '确认下单', user_prompt: '请确认我的订单', action_key: 'find_service.preview_order', params: { template_id: 'order_preview' } },
      ], entityBase),
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
        order_id: order.order_id || '',
        elder_id: elderId,
        elder_name: elderName,
        orders: orders.map((o) => ({
          orderId: o.order_id, elderName: o.elder_name, serviceName: o.service_name,
          status: o.status, expectedTime: o.expected_time,
        })),
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '订单详情', user_prompt: '查看服务订单详情', action_key: 'find_service.detail_order' },
        { label: '查看派单', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
      ], { ...entityBase, order_id: order.order_id || entityBase.order_id }),
      template_fit_notes: [],
    });
  }

  if (tpl === 'service_detail') {
    const tags = svc.scene_tags || ['实名认证', '专业培训', '即时响应'];
    const features = svc.features || ['持证上岗', '服务保险', '24小时响应', '不满意可返工'];
    const avail = org.availability_rate ?? svc.availability_rate;
    const availText = typeof avail === 'number'
      ? `${Math.round(avail <= 1 ? avail * 100 : avail)}%`
      : (avail || '85%');
    const answerText = `为您展示「${svc.name || '养老服务'}」详情。`;
    return sanitizeModelResult({
      template_id: 'service_detail',
      answer_text: answerText, answer: answerText,
      data: {
        eyebrow: svc.category || '🏠 居家服务',
        category: svc.category || '养老服务',
        icon: svc.icon || '🧹',
        name: svc.name || '居家深度清洁',
        service_id: svc.service_id || '',
        price: svc.price_from || 180,
        unit: svc.unit || '次',
        price_text: svc.price_from ? `${svc.price_from} 元/${svc.unit || '次'}` : '面议',
        summary: svc.summary || svc.description || '包含做饭、洗衣、洗澡协助、全屋打扫卫生等日常照料',
        intro: svc.description || '由持证护理人员提供专业上门照护服务，涵盖生活照料、健康监测、康复辅助等。',
        fullDesc: svc.full_desc || svc.description || '为您提供全方位的居家深度清洁服务，包含厨房清洁、卫生间消毒、卧室整理、客厅打扫等。服务人员均经过专业培训，持有健康证，服务过程全程可追溯。',
        has_tags: tags.length > 0,
        tags,
        has_features: features.length > 0,
        features,
        providerName: org.org_name || svc.org_name || '桂林夕阳红养老服务中心',
        overallScore: String(org.rating || svc.rating || '4.7'),
        availabilityRateText: availText,
        responseTime: String(org.response_time || svc.response_time || 15),
        staffCount: String(org.staff_count || svc.staff_count || 28),
        timeRange: svc.time_range || '08:00-18:00',
        hotline: svc.hotline || '400-888-1234',
        footSource: '居家服务详情',
        elder_id: elderId,
        elder_name: elderName,
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '一键预定', user_prompt: '帮我预约这项服务', action_key: 'find_service.booking_confirm', params: { template_id: 'service_booking_confirm' } },
        { label: '全部服务', user_prompt: '查看全部养老服务目录', action_key: 'find_service.catalog' },
        { label: '服务机构', user_prompt: '有哪些养老机构可以入住', action_key: 'find_service.list_orgs' },
      ], { ...entityBase, service_id: svc.service_id || entityBase.service_id }),
      template_fit_notes: [],
    });
  }

  const _serviceIconMap = { '居家照护': '🏠', '居家护理': '🏠', '康复理疗': '🏥', '助餐': '🍽️', '陪护': '🛡️', '清洁': '🧹', '护理': '🩺' };
  const inferServiceIcon = (cat) => {
    if (!cat) return '📋';
    if (_serviceIconMap[cat]) return _serviceIconMap[cat];
    if (cat.includes('餐')) return '🍽️';
    if (cat.includes('康复') || cat.includes('医') || cat.includes('理疗')) return '🏥';
    if (cat.includes('照护') || cat.includes('居家')) return '🏠';
    return '📋';
  };
  const top = catalog.slice(0, 4).map((s) => {
    const sid = s.service_id || s.id || '';
    return {
      id: sid,
      service_id: sid,
      name: s.name,
      category: s.category,
      price: s.price_from,
      unit: s.unit,
      tags: (s.scene_tags || []).join('/'),
      desc: s.description,
      icon: inferServiceIcon(s.category),
      summary: s.description || '',
      timeRange: s.time_range || '全天',
      provider_name: org.org_name || s.org_name || '',
      provider_score: String(org.rating || '4.5'),
      provider_avail_text: '可预约',
      action_params: JSON.stringify({
        service_id: sid,
        service_name: s.name || '',
        template_id: 'service_detail',
      }),
    };
  });
  const primaryServiceId = top[0]?.id || svc.service_id || '';
  const answerText = `已为您匹配 ${top.length} 项养老服务，并推荐机构「${org.org_name || ''}」与人员「${worker.name || ''}」。`;
  return sanitizeModelResult({
    template_id: 'service_recommend',
    answer_text: answerText, answer: answerText,
    data: {
      sceneTitle: '养老服务推荐',
      summary: '根据老人情况为您匹配以下服务',
      services: top,
      total: catalog.length,
      service_id: primaryServiceId,
      org_id: org.org_id || '',
      worker_id: worker.worker_id || worker.id || '',
      elder_id: elderId,
      elder_name: elderName,
      highlightOrg: { name: org.org_name || '', rating: org.rating || 0, scope: org.service_scope || '', price: org.price_from || 0 },
      highlightWorker: { name: worker.name || '', skill: (worker.skill_tags || []).join('/'), rating: worker.rating || 0 },
      // 显式关闭：避免模板 defaultData 里的演示区块（猜你喜欢/拓展）渗入正式卡
      has_guess: false,
      has_expanded: false,
    },
    actions: [],
    followup_suggestions: withEntityParams([
      { label: '查看详情', user_prompt: '查看推荐服务的详情', action_key: 'find_service.detail_service', params: { service_id: primaryServiceId } },
      { label: '全部服务', user_prompt: '查看全部养老服务目录', action_key: 'find_service.catalog' },
      { label: '找护工上门', user_prompt: '我想找护工上门护理', action_key: 'find_service.list_workers' },
      { label: '看养老机构', user_prompt: '有哪些养老机构可以入住', action_key: 'find_service.list_orgs' },
    ], { ...entityBase, service_id: primaryServiceId || entityBase.service_id }),
    template_fit_notes: [],
  });
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
      org_id: summary.orgId || '',
      org_name: summary.orgName,
      staff_id: summary.staffId || '',
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
    followup_suggestions: qualityFollowups(summary),
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
    orgId: firstNonEmpty(rows, ['org_id', 'orgId']) || firstNonEmpty(samples, ['org_id', 'orgId']) || '',
    staffName,
    staffId: firstNonEmpty(rows, ['staff_id', 'staffId', 'staff_no', 'staffNo']) || '',
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
      org_id: summary.orgId || '',
      org_name: summary.orgName,
      staff_id: summary.staffId || '',
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
    followup_suggestions: qualityFollowups(summary),
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
      org_id: summary.orgId || '',
      org_name: summary.orgName,
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
    followup_suggestions: qualityFollowups(summary),
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
      org_id: summary.orgId || '',
      org_name: summary.orgName,
      staff_id: summary.staffId || '',
      orgName: summary.orgName,
      period: summary.period,
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
    followup_suggestions: qualityFollowups(summary),
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
    followup_suggestions: qualityFollowups(summary),
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
    followup_suggestions: qualityFollowups(summary),
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
    followup_suggestions: qualityFollowups({}),
    model_used: 'flatTalk.service_quality.rules',
    model_status: sourceStatus.includes('simulated') ? 'degraded' : 'ok',
  });
}

function qualityActions() {
  // 服务质量：导航全部走追问，避免 actions + followups + 旧 manifest「您可以：」三层重复
  return [];
}

function qualityFollowups(summary = {}) {
  return withEntityParams([
    { label: '机构报告', user_prompt: '查看机构服务质量报告', action_key: 'service_quality_eval.view_report' },
    { label: '人员评估', user_prompt: '查看护理员服务质量评估', action_key: 'service_quality_eval.view_staff' },
    { label: '整改建议', user_prompt: '查看服务质量整改建议', action_key: 'service_quality_eval.rectify' },
    { label: '评分标准', user_prompt: '查看服务质量评分标准', action_key: 'service_quality_eval.view_standard' },
    { label: '查看机构排名', user_prompt: '查看机构服务质量排名', action_key: 'service_quality_eval.view_org_rank' },
    { label: '查看投诉详情', user_prompt: '查看服务质量投诉详情', action_key: 'service_quality_eval.view_complaint' },
  ], qualityEntityParams({
    org_id: summary.orgId || summary.org_id,
    org_name: summary.orgName || summary.org_name,
    staff_id: summary.staffId || summary.staff_id,
  }, summary));
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

export {
  fillServiceTransitionalCard,
  fillServiceEmergencyCard,
  fillFindServiceCard,
  fillServiceQualityEvalCard,
};
