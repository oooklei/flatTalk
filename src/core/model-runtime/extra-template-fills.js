/**
 * 扩展模板确定性填槽：覆盖 intent 已映射但主 model-service 尚未分支的模板。
 * 数据不足时返回 null，由调用方放开走 LLM。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pickByLockedId,
  withEntityParams,
  findServiceEntityParams,
  dispatchEntityParams,
  travelEntityParams,
  elderEntityParams,
} from '../conversation/entity-params.js';
import { listReferenceTravelProducts, selectProduct } from '../../services/travel/jtd-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

/**
 * 标量展示文本。云诊结构化报告里大量字段是对象（如 analysis_table.舌色 =
 * {detected, standard}），直接 String(obj) 会变成页面上的 "[object Object]"。
 */
function text(v, fallback = '') {
  if (v == null || v === '') return String(fallback ?? '').trim();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v).trim();
  }
  if (Array.isArray(v)) {
    const joined = v.map((item) => text(item, '')).filter(Boolean).join('、');
    return joined || String(fallback ?? '').trim();
  }
  if (typeof v === 'object') {
    const picked = v.detected ?? v.current ?? v.value ?? v.text ?? v.name
      ?? v.label ?? v.standard ?? v.summary ?? v.desc ?? v.meaning;
    if (picked != null && picked !== v) return text(picked, fallback);
  }
  return String(fallback ?? '').trim();
}

function loadLatestShezhenStructured() {
  const dir = path.join(ROOT, 'data', 'shezhen_reports');
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.structured.json'));
    if (!files.length) return null;
    files.sort();
    const raw = fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseConstitutionPrimary(healthState = '') {
  const m = String(healthState).match(/健康状态\s*([^\s兼\n]+)/) || String(healthState).match(/([^\s兼\n]{2,4}质)/);
  if (m) return m[1].replace(/质$/, '') + (m[1].includes('质') ? '' : '质');
  if (/痰湿/.test(healthState)) return '痰湿质';
  if (/血瘀/.test(healthState)) return '血瘀质';
  if (/气虚/.test(healthState)) return '气虚质';
  return '平和质';
}

function buildConstitutions(primary) {
  const nine = ['平和质', '气虚质', '阳虚质', '阴虚质', '痰湿质', '湿热质', '血瘀质', '气郁质', '特禀质'];
  return nine.map((name) => ({
    name,
    score: name === primary ? 78 : (name.includes(primary.replace('质', '')) ? 55 : 20 + (name.length % 7) * 3),
    is_primary: name === primary,
  }));
}

/**
 * 云诊膳食字段常为长字符串（非数组）。truthy 字符串会绕过 `|| fallback`，
 * 再 .map 会抛 TypeError → /api/chat/message 500。
 */
function normalizeFoodList(raw, fallback = []) {
  const toItem = (c) => {
    if (typeof c === 'string') return c.trim();
    if (c && typeof c === 'object') return text(c.name || c.content || c.label, '');
    return '';
  };
  if (Array.isArray(raw)) {
    return raw.map(toItem).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/[\n、，,；;。]/)
      .map((s) => s.replace(/^宜多食|^少食|^忌|^可适当应用/u, '').trim())
      .filter((s) => s.length >= 2);
  }
  return (Array.isArray(fallback) ? fallback : [fallback]).map(toItem).filter(Boolean);
}

/**
 * 归一化异常项为 [{ name, desc }]。
 *
 * 上游 abnormal_items 有三种真实形态，原代码直接 .map 只兼容第一种：
 *   1. 数组：['齿痕', ...] 或 [{ name, desc }]
 *   2. 对象：{ tooth_marks: { current: '有齿痕', meaning: '...' } }
 *      —— 舌诊/面诊报告的真实结构（data/shezhen_reports/*.structured.json），
 *         对象没有 .map，会抛 "is not a function" 使整个请求 500
 *   3. 缺失：回落到 indicators 里标记为 abnormal 的项
 */
function normalizeAbnormalItems(raw, indicators = []) {
  const pick = (x, fallbackName = '') => {
    if (typeof x === 'string') {
      return {
        name: x,
        desc: '',
        levelLabel: '异常',
        pillClass: 'warn',
        itemClass: 'warn',
      };
    }
    if (x && typeof x === 'object') {
      const name = text(x.name || x.current || fallbackName, fallbackName);
      const desc = text(
        x.pathological_meaning || x.desc || x.value || x.meaning || x.detected,
        '',
      ).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      return {
        name,
        desc,
        levelLabel: text(x.levelLabel || x.level || '异常', '异常'),
        pillClass: 'warn',
        itemClass: 'warn',
      };
    }
    return {
      name: text(x, fallbackName),
      desc: '',
      levelLabel: '异常',
      pillClass: 'warn',
      itemClass: 'warn',
    };
  };

  if (Array.isArray(raw)) return raw.map((x) => pick(x));
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([key, val]) => pick(val, key));
  }
  return indicators.filter((i) => i.abnormal).map((x) => pick(x));
}

function tableToIndicators(table = {}) {
  return Object.entries(table || {}).map(([name, raw]) => {
    const detected = text(
      (raw && typeof raw === 'object') ? (raw.detected ?? raw.current ?? raw.value ?? raw) : raw,
      '—',
    );
    const standard = text(
      (raw && typeof raw === 'object') ? (raw.standard ?? raw.normal ?? '') : '',
      '',
    );
    const value = detected || '—';
    const abnormal = Boolean(
      (standard && detected && standard !== detected)
      || /偏|异常|暗|黄|腻|胖|裂纹|少津|厚|齿痕|\+|↑|↓/.test(value),
    );
    return {
      name,
      value,
      standard,
      abnormal,
      statusLabel: abnormal ? '异常' : '正常',
      valClass: abnormal ? (/厚|齿痕|暗/.test(value) ? 'bad' : 'warn') : 'ok',
    };
  });
}

function buildTongueMeasures(tongue = {}) {
  const measures = [];
  const tongueArea = text(tongue.tongue_color_area_percent, '');
  const mossArea = text(tongue.moss_color_area_percent, '');
  if (tongueArea) measures.push({ k: '舌色面积占比', v: tongueArea });
  if (mossArea) measures.push({ k: '苔色面积占比', v: mossArea });
  const table = tongue.analysis_table || {};
  for (const key of ['舌形', '苔质', '津液']) {
    const cell = table[key];
    if (!cell) continue;
    measures.push({
      k: key,
      v: text(cell, '—') + (cell?.standard ? `（标准：${text(cell.standard, '')}）` : ''),
    });
  }
  return measures;
}

/** @returns {object|null} */
export function fillTravelTransportCard({ message, business_data } = {}) {
  const jtd = business_data?.jtd || {};
  const product = jtd.selected_product || null;
  const dest = text(
    business_data?.destination
    || business_data?.primary_city
    || product?.destination
    || product?.city
    || inferDest(message),
    '',
  ) || '防城港';
  return {
    template_id: 'travel_transport_card',
    answer_text: `已整理前往${dest}的适老交通参考（高铁+包车）。`,
    data: {
      title: `${dest}交通接驳指南`,
      intro: '优先高铁直达，站点接驳可选包车；避免夜间赶路。',
      destination: dest,
      tickets: [
        {
          trainNo: 'D37xx',
          depTime: '08:20',
          depStation: '南宁东',
          duration: '约2.5小时',
          arrTime: '10:50',
          arrStation: `${dest}站`,
          seats: [
            { name: '二等座', price: '约95元', status: '余票充足', cls: 'ok' },
            { name: '一等座', price: '约150元', status: '余票一般', cls: '' },
          ],
        },
      ],
      charter: {
        icon: '🚗',
        name: '包车接驳',
        items: [
          { icon: '⏱', name: '站到基地', text: '约40-60分钟' },
          { icon: '💰', name: '预估费用', text: '150-280元/车' },
          { icon: '♿', name: '适老说明', text: '可预约无障碍车辆' },
        ],
      },
    },
    actions: [],
    followup_suggestions: withEntityParams([
      { label: '查看天气风险', user_prompt: '请检查目的地的天气风险', action_key: 'travel_route.check_weather_risk' },
      { label: '检查可订状态', user_prompt: '请检查这条旅居路线近期是否可预订', action_key: 'travel_route.check_availability' },
    ], travelEntityParams({ destination: dest }, business_data)),
  };
}

export function fillTravelNeedSummaryCard({ message, business_data } = {}) {
  const msg = text(message);
  const tags = [
    { cat: '出行诉求', items: [{ label: /基地|住/.test(msg) ? '康养基地' : '旅居线路' }] },
    { cat: '适老约束', items: [{ label: '低强度' }, { label: '医疗可达' }] },
    { cat: '预算偏好', items: [{ label: /经济|便宜/.test(msg) ? '经济型' : '舒适型' }] },
  ];
  return {
    template_id: 'travel_need_summary_card',
    answer_text: '已提炼您的旅居需求摘要，可据此继续规划线路或基地。',
    data: {
      title: '旅居需求摘要',
      desc: msg ? `根据「${msg.slice(0, 40)}」识别` : '根据当前对话识别',
      tags,
      conclusion: '建议优先选择有医护支持、步行强度可控的线路/基地。',
    },
    actions: [],
    followup_suggestions: withEntityParams([
      { label: '按此需求规划', user_prompt: '请按此需求规划旅居路线', action_key: 'travel_route.replan', params: { template_id: 'sojourn_route' } },
    ], travelEntityParams({}, business_data)),
  };
}

export function fillTravelPlanSummaryCard({ message, business_data } = {}) {
  const jtd = business_data?.jtd || {};
  const destHint = text(
    business_data?.destination
    || business_data?.primary_city
    || jtd.selected_product?.destination
    || jtd.selected_product?.city
    || inferDest(message),
    '',
  );
  const product = resolveTravelPlanProduct(business_data, message, destHint);
  const dest = text(product.destination || product.city || destHint, '') || '目的地待确认';
  const name = text(
    product.product_name || product.name || business_data?.route_title,
    dest && dest !== '目的地待确认' ? `${dest.replace(/^广西/, '')}旅居套餐` : '旅居套餐',
  );
  const daysLabel = formatTravelDays(product);
  const priceLabel = formatTravelPlanPrice(product, business_data, jtd);
  return {
    template_id: 'travel_plan_summary_card',
    answer_text: `已汇总「${name}」方案确认信息。`,
    data: {
      title: '旅居方案确认',
      destination: dest.replace(/^广西/, '') || dest,
      route_id: business_data?.route_id || product.product_id || '',
      rows: [
        { label: '方案名称', value: name },
        { label: '目的地', value: dest.replace(/^广西/, '') || dest },
        { label: '建议天数', value: daysLabel || '详询行程' },
        { label: '适配人群', value: text(product.suitable || (Array.isArray(product.tags) ? product.tags.slice(0, 2).join('·') : ''), '适老康养') },
      ],
      totalLabel: '参考总价',
      // 模板自带 ¥ 前缀；勿再拼「待确认元起」
      totalPrice: priceLabel || '面议',
      totalNote: '最终以金跳动可订校验与下单页为准',
    },
    actions: [],
    followup_suggestions: withEntityParams([
      { label: '检查可订状态', user_prompt: '请检查这条旅居路线近期是否可预订', action_key: 'travel_route.check_availability' },
      { label: '去预订', user_prompt: '我想继续预订这条旅居产品', action_key: 'travel_route.booking_handoff' },
    ], travelEntityParams({
      destination: dest,
      product_id: product.product_id,
      route_title: name,
    }, business_data)),
  };
}

/** 旅居预算卡：基于已选产品/目的地做分项测算（本地填槽，不走 BFF） */
export function fillTravelBudgetCard({ message, business_data } = {}) {
  const jtd = business_data?.jtd || {};
  const destHint = text(
    business_data?.destination
    || business_data?.primary_city
    || jtd.selected_product?.destination
    || jtd.selected_product?.city
    || inferDest(message),
    '',
  );
  const product = resolveTravelPlanProduct(business_data, message, destHint);
  const dest = text(product.destination || product.city || destHint, '') || '目的地待确认';
  const city = dest.replace(/^广西/, '') || dest;
  const days = Number(product.days) || (() => {
    const m = String(product.product_name || message || '').match(/(\d+)\s*[天日]/);
    return m ? parseInt(m[1], 10) : 7;
  })();
  const headcount = Number(business_data?.headcount || business_data?.action_params?.headcount || 2) || 2;
  const unit = Number(product.price_amount) > 0 ? Number(product.price_amount) : 1680;
  const lodging = Math.round(unit * Math.max(1, days) / 3);
  const transport = Math.round(180 * headcount);
  const meal = Math.round(80 * headcount * Math.max(1, days));
  const ticket = Math.round(60 * headcount * Math.max(1, Math.min(days, 5)));
  const total = lodging + transport + meal + ticket;
  const name = text(product.product_name || product.name, `${city}旅居`);
  return {
    template_id: 'travel_budget_card',
    answer_text: `已按「${name}」测算${city}约${days}天、${headcount}人参考预算。`,
    data: {
      title: '旅居预算明细',
      destination: city,
      rows: [
        { label: '目的地', value: city },
        { label: '旅居天数', value: `${days}天` },
        { label: '出行人数', value: `${headcount}人` },
        { label: '首选产品', value: name },
        { label: '住宿参考', value: `${lodging}元` },
        { label: '交通参考', value: `${transport}元` },
        { label: '餐食参考', value: `${meal}元` },
        { label: '门票/体验', value: `${ticket}元` },
      ],
      totalLabel: '预估总费用',
      totalPrice: `${total}起`,
      totalNote: '仅供参考，最终以金跳动可订与下单页为准',
    },
    actions: [],
    followup_suggestions: withEntityParams([
      { label: '检查可订状态', user_prompt: '请检查这条旅居路线近期是否可预订', action_key: 'travel_route.check_availability' },
      { label: '去预订', user_prompt: '我想继续预订这条旅居产品', action_key: 'travel_route.booking_handoff' },
    ], travelEntityParams({
      destination: dest,
      product_id: product.product_id,
      route_title: name,
    }, business_data)),
  };
}

/** 方案确认卡：优先已选产品，其次会话产品池，再回退参考价目录（含巴马/北海 mock） */
function resolveTravelPlanProduct(business_data = {}, message = '', destHint = '') {
  const jtd = business_data?.jtd || {};
  const selected = jtd.selected_product;
  if (selected && (selected.price_amount || selected.price_label || selected.product_id || selected.combo_price)) {
    return selected;
  }
  const pool = [];
  const seen = new Set();
  for (const p of [...(Array.isArray(jtd.products) ? jtd.products : []), ...listReferenceTravelProducts()]) {
    if (!p) continue;
    const id = String(p.product_id || p.product_name || '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    pool.push(p);
  }
  const picked = selectProduct(pool, message, {
    params: {
      product_id: business_data?.product_id || selected?.product_id || '',
      destination: destHint || business_data?.destination || business_data?.primary_city || '',
    },
  });
  return picked || selected || {};
}

function formatTravelDays(product = {}) {
  let days = Number(product.days);
  if (!Number.isFinite(days) || days <= 0) {
    const name = String(product.product_name || product.name || '');
    const m = name.match(/(\d+)\s*[天日]|([三四五六七八九十]+)\s*[天日]/);
    if (m?.[1]) days = parseInt(m[1], 10);
    else if (m?.[2]) {
      const map = { 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      days = map[m[2]] || NaN;
    }
  }
  const nights = product.nights != null ? Number(product.nights) : (Number.isFinite(days) ? Math.max(0, days - 1) : NaN);
  if (Number.isFinite(days) && days > 0 && Number.isFinite(nights)) return `${days}天${nights}晚`;
  if (Number.isFinite(days) && days > 0) return `${days}天`;
  return text(product.duration || product.days_label, '');
}

function formatTravelPlanPrice(product = {}, business_data = {}, jtd = {}) {
  const amount = Number(product.price_amount ?? product.price ?? product.retail_price ?? business_data.price_amount);
  if (Number.isFinite(amount) && amount > 0) return `${amount}起`;
  const raw = text(
    product.price_label
    || product.combo_price
    || product.retail_price
    || business_data.price_label
    || jtd.combo_price
    || jtd.price_label,
    '',
  );
  if (!raw || /待确认|价格待确认/.test(raw)) return '';
  return raw.replace(/^¥\s*/, '');
}

export function fillFindServiceExtra({ message, business_data, selectedTemplateId } = {}) {
  const bd = business_data || {};
  const catalog = Array.isArray(bd.service_catalog) ? bd.service_catalog : [];
  const orgs = Array.isArray(bd.orgs) ? bd.orgs : [];
  const workers = Array.isArray(bd.workers) ? bd.workers : [];
  const orders = Array.isArray(bd.orders) ? bd.orders : [];
  const quality = bd.quality_evaluation || bd.feedback_metrics || {};
  const elderName = text(bd.elder_name || bd.elderName, '老人');
  const svc = pickByLockedId(catalog, bd.service_id, ['service_id', 'id'], { allowFallback: !bd.service_id }) || {};
  const org = pickByLockedId(orgs, bd.org_id, ['org_id', 'id'], { allowFallback: !bd.org_id }) || {};
  const order = pickByLockedId(orders, bd.order_id, ['order_id', 'id'], { allowFallback: !bd.order_id }) || {};
  const tpl = selectedTemplateId;
  const entityBase = findServiceEntityParams({
    elder_id: bd.elder_id || '',
    elder_name: elderName,
    service_id: svc.service_id || '',
    org_id: org.org_id || '',
    order_id: order.order_id || '',
  }, bd);

  if (tpl === 'service_order_form') {
    return {
      template_id: tpl,
      answer_text: `请确认「${svc.name || '上门护理'}」预约信息后提交。`,
      data: {
        service_name: svc.name || '上门护理',
        service_price: svc.price_from || 80,
        service_unit: svc.unit || '次',
        name: elderName,
        name_source: bd.elder_name ? '登录档案' : '请填写',
        phone: text(bd.phone, ''),
        phone_source: bd.phone ? '档案' : '请填写',
        address: text(bd.address_label || bd.address, ''),
        address_source: bd.address_label ? '档案' : '请填写',
        date: '',
        date_source: '请选择',
        time_slot: '上午',
        time_reason: '建议避开午休与晚间',
        notes: '',
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '查看订单', user_prompt: '查看我的服务订单', action_key: 'find_service.detail_order' },
      ], entityBase),
    };
  }

  if (tpl === 'service_order_ticket') {
    const orderNo = order.order_id || `GD${Date.now().toString().slice(-10)}`;
    return {
      template_id: tpl,
      answer_text: `预定成功，订单号 ${orderNo}。`,
      data: {
        pageTitle: '预定成功',
        cardTitle: '预定成功',
        orderNo,
        order_no: orderNo,
        ticket_desc: '请留意服务人员联系电话',
        serviceName: order.service_name || svc.name || '上门助浴服务',
        service_name: order.service_name || svc.name || '上门助浴服务',
        name: order.elder_name || elderName,
        phone: text(bd.phone, '—'),
        dateDisplay: order.expected_time || '明天（待确认）',
        date: order.expected_time || '待确认',
        timeSlot: order.time_slot || '09:00-11:00',
        institution: order.org_name || org.org_name || '桂林乐颐家政服务公司',
        org: order.org_name || org.org_name || '',
        status: order.status || '待确认',
        status_class: 'ok',
        footSource: '预定成功',
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '查看订单进度', user_prompt: '查看服务订单进度', action_key: 'find_service.detail_order' },
        { label: '服务追溯', user_prompt: '查看服务过程追溯', action_key: 'find_service.trace', params: { template_id: 'service_trace' } },
      ], { ...entityBase, order_id: order.order_id || entityBase.order_id }),
    };
  }

  if (tpl === 'service_expand' || tpl === 'service_guess_like') {
    const item = pickByLockedId(catalog, bd.service_id, ['service_id', 'id'], { allowFallback: !bd.service_id }) || {};
    const base = {
      icon: '🩺',
      name: item.name || '健康随访',
      price: item.price_from || 60,
      unit: item.unit || '次',
      summary: text(item.desc || item.intro, '适老化服务推荐'),
      provider_name: org.org_name || '桂小养康养中心',
    };
    if (tpl === 'service_expand') {
      return {
        template_id: tpl,
        answer_text: `为您拓展推荐：${base.name}。`,
        data: {
          ...base,
          badge_text: '拓展推荐',
          badge_class: 'hot',
          badge_icon: '★',
          timeRange: '08:00-18:00',
          provider_env: String(org.rating || '4.5'),
          provider_avail_text: '近期可约',
        },
        actions: [],
        followup_suggestions: withEntityParams([
          { label: '智能推荐', user_prompt: '请智能推荐适合的养老服务', action_key: 'find_service.recommend' },
        ], { ...entityBase, service_id: item.service_id || entityBase.service_id }),
      };
    }
    return {
      template_id: tpl,
      answer_text: `猜您可能还需要：${base.name}。`,
      data: {
        ...base,
        image_bg: 'linear-gradient(135deg,#FF9A5C,#FF7826)',
        tag: (item.scene_tags || ['精选'])[0] || '精选',
        service_id: item.service_id || '',
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '全部服务', user_prompt: '查看全部养老服务目录', action_key: 'find_service.catalog' },
      ], { ...entityBase, service_id: item.service_id || entityBase.service_id }),
    };
  }

  if (tpl === 'service_trace') {
    const oid = order.order_id || 'SO0001';
    return {
      template_id: tpl,
      answer_text: `已生成订单 ${oid} 的服务过程追溯。`,
      data: {
        orderNo: oid,
        serviceName: order.service_name || svc.name || '上门护理',
        staff: workers[0]?.name || '待指派',
        org: order.org_name || org.org_name || '',
        date: order.expected_time || order.created_at || '近期',
        showAnomaly: false,
        anomaly: '',
        traceNodes: [
          { time: '09:00', node: '下单成功', detail: '家属确认服务需求', itemClass: 'done', detailClass: '' },
          { time: '09:20', node: '派单成功', detail: '已匹配服务人员', itemClass: 'done', detailClass: '' },
          { time: '10:00', node: '上门服务中', detail: order.status || '进行中', itemClass: 'active', detailClass: '' },
          { time: '—', node: '服务完成', detail: '待回访确认', itemClass: '', detailClass: '' },
        ],
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '查看订单', user_prompt: '查看我的服务订单', action_key: 'find_service.detail_order' },
        { label: '查看口碑', user_prompt: '查看服务机构口碑评价', action_key: 'find_service.review', params: { template_id: 'service_review' } },
      ], entityBase),
    };
  }

  if (tpl === 'service_review') {
    const score = Number(quality.org_score || org.rating || 4.6);
    return {
      template_id: tpl,
      answer_text: `「${org.org_name || '服务机构'}」综合口碑 ${score} 分。`,
      data: {
        orgName: org.org_name || '桂小养康养中心',
        totalScore: score,
        level: score >= 4.5 ? '优秀' : score >= 4 ? '良好' : '一般',
        complaintCount: Number(quality.complaint_count || 0),
        dims: [
          { name: '服务态度', score: Math.min(5, score + 0.1).toFixed(1), pct: 90 },
          { name: '专业技能', score: score.toFixed(1), pct: 86 },
          { name: '响应时效', score: Math.max(3.5, score - 0.2).toFixed(1), pct: 80 },
          { name: '过程规范', score: score.toFixed(1), pct: 84 },
        ],
        reviews: [
          { who: '家属A', text: '护理员态度好，按时上门。' },
          { who: '家属B', text: '服务过程有记录，比较放心。' },
        ],
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '看机构', user_prompt: '有哪些养老机构可以入住', action_key: 'find_service.list_orgs' },
        { label: '智能推荐', user_prompt: '请智能推荐适合的养老服务', action_key: 'find_service.recommend' },
      ], { ...entityBase, org_id: org.org_id || entityBase.org_id }),
    };
  }

  return null;
}

export function fillDispatchExtra({ message, business_data, selectedTemplateId } = {}) {
  const bd = business_data || {};
  const dispatches = Array.isArray(bd.dispatch_orders) ? bd.dispatch_orders : [];
  const orders = Array.isArray(bd.orders) ? bd.orders : [];
  const workers = Array.isArray(bd.workers) ? bd.workers : [];
  const d = pickByLockedId(dispatches, bd.dispatch_id, ['dispatch_id', 'id'], { allowFallback: !bd.dispatch_id }) || {};
  const o = pickByLockedId(orders, bd.order_id || d.order_id, ['order_id', 'id'], {
    allowFallback: !(bd.order_id || d.order_id),
  })
    || orders.find((x) => x.order_id === d.order_id)
    || {};
  const dispatchParams = dispatchEntityParams({
    dispatchId: d.dispatch_id,
    orderId: o.order_id || d.order_id,
  }, bd);
  const orderNo = d.dispatch_id || d.order_id || o.order_id || 'WO0001';
  const serviceName = o.service_name || d.skill_tag || '上门护理';
  const name = o.elder_name || '服务对象';
  const tpl = selectedTemplateId;

  if (tpl === 'dispatch_accept') {
    return {
      template_id: tpl,
      answer_text: `请确认接单：${orderNo}（${serviceName}）。`,
      data: {
        orderNo,
        serviceName,
        name,
        address: text(o.address || bd.address_label, '待确认地址'),
        date: text(o.expected_time || d.created_at, '待排期'),
        staff: d.worker_name || workers[0]?.name || '待指派',
        supplier: o.org_name || '本地服务商',
        eta: '2小时内联系',
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '查看进度', user_prompt: '帮我查看这条派单的进度', action_key: 'dispatch_manage.status' },
        { label: '返回列表', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
      ], dispatchParams),
    };
  }

  if (tpl === 'dispatch_reject') {
    return {
      template_id: tpl,
      answer_text: `请选择拒单原因：${orderNo}。`,
      data: {
        order_no: orderNo,
        service_name: serviceName,
        reasons: ['人手不足', '距离过远', '时间冲突', '技能不匹配', '其他原因'],
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '返回列表', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
        { label: '返回详情', user_prompt: '查看派单详情', action_key: 'dispatch_manage.detail' },
      ], dispatchParams),
    };
  }

  if (tpl === 'dispatch_transfer') {
    const targets = (workers.length ? workers : [
      { name: '备用护工A', skill_tags: ['护理'], rating: 4.7 },
      { name: '备用护工B', skill_tags: ['助浴'], rating: 4.5 },
    ]).slice(0, 3).map((w) => ({
      name: w.name,
      meta: `${(w.skill_tags || []).join('/') || w.skill || '综合'} · 评分${w.rating || '-'}`,
    }));
    return {
      template_id: tpl,
      answer_text: `可为订单 ${orderNo} 选择改派对象。`,
      data: { order_no: orderNo, service_name: serviceName, targets },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '返回列表', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
      ], dispatchParams),
    };
  }

  if (tpl === 'dispatch_supplier_action') {
    return {
      template_id: tpl,
      answer_text: `供应商待处理订单：${orderNo}。`,
      data: {
        order_no: orderNo,
        service_name: serviceName,
        name,
        address: text(o.address || bd.address_label, ''),
        date: text(o.expected_time || d.created_at, ''),
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '查看详情', user_prompt: '查看派单详情', action_key: 'dispatch_manage.detail' },
        { label: '返回列表', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
      ], dispatchParams),
    };
  }

  return null;
}

export function fillMealDashboardCard({ message, business_data } = {}) {
  const profileName = text(business_data?.elder_name || business_data?.elderName, '老人');
  const meals = [
    { mealName: '早餐', mealEmoji: '🌅', mealTotal: '320kcal', foods: [{ foodName: '小米粥', cal: 120 }, { foodName: '水煮蛋', cal: 70 }, { foodName: '全麦面包', cal: 130 }] },
    { mealName: '午餐', mealEmoji: '☀️', mealTotal: '520kcal', foods: [{ foodName: '杂粮饭', cal: 200 }, { foodName: '清蒸鱼', cal: 180 }, { foodName: '时蔬', cal: 140 }] },
    { mealName: '晚餐', mealEmoji: '🌙', mealTotal: '430kcal', foods: [{ foodName: '番茄豆腐汤', cal: 150 }, { foodName: '青菜', cal: 120 }, { foodName: '燕麦粥', cal: 160 }] },
  ];
  return {
    template_id: 'meal_dashboard_card',
    answer_text: `已生成${profileName}的膳食营养看板。`,
    data: {
      pageTitle: '膳食营养看板',
      pageSubtitle: '今日摄入概览',
      profileName,
      profileDesc: '慢病友好 · 低盐低糖',
      profileStats: [{ val: '1270', lbl: 'kcal' }, { val: '3', lbl: '餐次' }],
      donutTotal: '1270',
      ratios: [
        { name: '碳水', pct: 55, kcal: 700, color: '#FF9A5C' },
        { name: '蛋白', pct: 25, kcal: 320, color: '#5B8FF9' },
        { name: '脂肪', pct: 20, kcal: 250, color: '#61DDAA' },
      ],
      tags: [{ tagIcon: '🧂', tagLabel: '低盐' }, { tagIcon: '🍬', tagLabel: '控糖' }],
      tableBadge: '今日',
      meals,
      grandTotal: '1270kcal',
      hasRelated: false,
      related: [],
    },
    actions: [],
    followup_suggestions: [],
  };
}

export function fillHealthDrilldownCard({ selectedTemplateId, business_data, message } = {}) {
  const structured = loadLatestShezhenStructured();
  const elderParams = elderEntityParams({}, business_data || {});
  const elderName = text(elderParams.elder_name || business_data?.elder_name || structured?.metadata?.name, '老人');
  const tpl = selectedTemplateId;
  const drillFollowups = healthDrillFollowups(elderParams);
  const elderData = {
    elder_id: elderParams.elder_id || '',
    elder_name: elderName,
  };

  if (tpl === 'help_card') {
    return {
      template_id: tpl,
      answer_text: '健康风险预警使用说明。',
      data: {
        ...elderData,
        helps: [
          { text: '输入老人姓名或绑定档案后，可读取远程体检/舌诊信号。' },
          { text: '主卡展示风险等级；可下钻体质、舌诊、面诊、调理方案。' },
          { text: '同名老人会出现确认卡，请选择正确档案后再评估。' },
          { text: '急症（胸痛/昏迷/呼救）会短路到 SOS 应急卡，请优先拨打120。' },
        ],
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '补充老人信息', user_prompt: '补充老人信息', action_key: 'health_risk_warning.fill_elder_info' },
      ], elderParams),
    };
  }

  if (tpl === 'risk_level_card') {
    return {
      template_id: tpl,
      answer_text: '健康风险五级标准说明。',
      data: {
        ...elderData,
        risk_levels: [
          { label: '低风险', color_key: 'green', score_range: '80-100', desc: '指标平稳，保持随访' },
          { label: '轻度风险', color_key: 'blue', score_range: '70-79', desc: '个别指标波动，建议一周复测' },
          { label: '中度风险', color_key: 'orange', score_range: '60-69', desc: '需关注并调整生活方式' },
          { label: '较高风险', color_key: 'red', score_range: '50-59', desc: '建议尽快线下复核' },
          { label: '高风险', color_key: 'darkred', score_range: '<50', desc: '立即联系家属/医护介入' },
        ],
      },
      actions: [],
      followup_suggestions: drillFollowups,
    };
  }

  if (!structured && !['constitution_card', 'care_advice_card', 'tcm_syndrome_card', 'tongue_diagnosis_card', 'face_observation_card', 'risk_assessment_card'].includes(tpl)) {
    return null;
  }

  const ha = structured?.health_analysis || {};
  const primary = parseConstitutionPrimary(ha.health_state || business_data?.constitution || '痰湿质');
  const constitutions = buildConstitutions(primary);
  const tongue = structured?.tongue_diagnosis || {};
  const face = structured?.face_observation || {};
  const regimen = structured?.regimen_plan || {};
  const dietary = regimen.dietary_regimen || {};
  const acupoints = (regimen.acupoint_healthcare?.selected_points || []).map((p) => ({
    content: typeof p === 'string' ? p : (p.name || p.point || JSON.stringify(p)),
  }));
  const herbal = (regimen.medicated_food?.items || []).map((p) => ({
    content: typeof p === 'string' ? p : (p.name || p.content || JSON.stringify(p)),
  }));

  if (tpl === 'constitution_card') {
    return {
      template_id: tpl,
      answer_text: `${elderName}主体质：${primary}。`,
      data: { ...elderData, primary_constitution: primary, constitutions },
      actions: [],
      followup_suggestions: drillFollowups,
    };
  }

  if (tpl === 'tcm_syndrome_card') {
    const syndrome = text(
      (ha.health_state || '').match(/兼有[（(]?([^）)\n]+)[）)]?/)?.[1] || ha.pathology_factor?.level,
      '痰湿兼气虚',
    );
    return {
      template_id: tpl,
      answer_text: `${elderName}中医证候：${syndrome}。`,
      data: {
        ...elderData,
        syndrome_name: syndrome,
        syndrome_desc: text(ha.occurrence_mechanism || ha.main_manifestations?.[0], '气虚运化无力，水湿停聚。').slice(0, 120),
      },
      actions: [],
      followup_suggestions: drillFollowups,
    };
  }

  if (tpl === 'tongue_diagnosis_card') {
    const indicators = tableToIndicators(tongue.analysis_table || {
      舌色: text(business_data?.tongueFeature, '淡红'),
      苔色: '薄白',
      舌形: '正常',
      苔质: '薄',
      津液: '正常',
      舌下脉络: '正常',
    });
    const abnormalItems = normalizeAbnormalItems(tongue.abnormal_items, indicators);
    const measures = buildTongueMeasures(tongue);
    const summary = text(
      tongue.summary
      || indicators.map((i) => `${i.name}${i.value}`).join('，'),
      '舌象大致正常',
    );
    const riskWarning = text(tongue.risk_warning || ha.risk_status, '');
    const conclusion = text(
      riskWarning.split(/[。；;]/)[0]
      || indicators.filter((i) => i.abnormal).map((i) => i.value).slice(0, 2).join(' · '),
      '舌象辨识结果',
    );
    return {
      template_id: tpl,
      answer_text: `已生成${elderName}舌诊详情。`,
      data: {
        ...elderData,
        elderName,
        elderAge: text(structured?.metadata?.age, '') ? `${text(structured?.metadata?.age, '')}岁` : '',
        device: text(structured?.metadata?.issuer, '云诊舌诊仪'),
        assessTime: text(structured?.metadata?.report_date, ''),
        badge: '云诊舌象辨识',
        conclusion,
        tongue_summary: summary,
        indicators_count: indicators.length,
        tongue_indicators: indicators,
        tongue_area: text(tongue.tongue_color_area_percent, ''),
        measures,
        abnormal_count: abnormalItems.length,
        abnormal_items: abnormalItems,
        risk_warning: riskWarning,
        advice: abnormalItems.length
          ? '建议结合体质与面诊综合判断；异常项持续出现时请线下中医复核。'
          : '舌象未见明显异常，建议定期复测对比。',
        sourceLabel: 'AI 生成 · 云诊舌诊设备结构化数据',
      },
      actions: [],
      followup_suggestions: drillFollowups,
    };
  }

  if (tpl === 'face_observation_card') {
    const indicators = tableToIndicators(face.analysis_table || {
      面色: '淡黄',
      光泽: '少泽',
      眼神: '正常',
      唇色: '淡红',
    });
    const abnormalItems = normalizeAbnormalItems(face.abnormal_items, indicators);
    return {
      template_id: tpl,
      answer_text: `已生成${elderName}面诊详情。`,
      data: {
        ...elderData,
        elderName,
        face_indicators: indicators,
        indicators_count: indicators.length,
        abnormal_count: abnormalItems.length,
        abnormal_items: abnormalItems,
      },
      actions: [],
      followup_suggestions: drillFollowups,
    };
  }

  if (tpl === 'care_advice_card') {
    const recommend = normalizeFoodList(dietary.recommended_foods, ['山药', '薏米', '冬瓜']);
    const avoid = normalizeFoodList(dietary.avoid_foods, ['油腻', '甜腻']);
    return {
      template_id: tpl,
      answer_text: `已生成${elderName}个性化调理方案。`,
      data: {
        ...elderData,
        herbal: herbal.length ? herbal : [{ content: '可咨询医师后选用健脾化湿药膳' }],
        acupoints: acupoints.length ? acupoints : [{ content: '足三里、丰隆、阴陵泉' }],
        dietary: recommend.map((c) => ({ content: c })),
        exercise: (Array.isArray(regimen.exercise) ? regimen.exercise : ['散步', '八段锦'])
          .map((c) => ({ content: typeof c === 'string' ? c : c.name || c.content })),
        contraindications: [
          { type: '饮食忌口', items: avoid.map((c) => ({ content: c })) },
        ],
      },
      actions: [],
      followup_suggestions: drillFollowups,
    };
  }

  if (tpl === 'risk_assessment_card') {
    const score = Number(ha.health_index || 70.9);
    const risks = (ha.risk_overview || []).slice(0, 5).map((r) => ({
      name: r.name,
      score: score,
      level: r.risk_level,
      color_key: /中|高/.test(r.risk_level) ? 'orange' : 'blue',
    }));
    return {
      template_id: tpl,
      answer_text: `已生成${elderName}综合风险评估。`,
      data: {
        ...elderData,
        elderly_name: elderName,
        age: text(structured?.metadata?.age || business_data?.elder_age, ''),
        gender: text(structured?.metadata?.sex || business_data?.elder_sex, ''),
        chronic: text(business_data?.care_level, ''),
        dementia: '未评估',
        disability: text(business_data?.ability_status, ''),
        overall_score: score,
        overall_label: text(ha.risk_status, '中风险'),
        conclusion: text(ha.risk_status, '建议一周后复测'),
        indicators: (ha.abnormal_meridian_overview || []).map((m) => ({ name: m.name, value: m.score, status: '关注' })),
        tongue_summary: text(tongue.summary, '见舌诊详情'),
        pulse_type: '—',
        pulse_rate: '—',
        pulse_interpretation: '报告未含脉诊明细',
        face_complexion: text(face.analysis_table?.面色, '—'),
        face_interpretation: text(face.summary, ''),
        disease_risks: risks,
        primary_constitution: primary,
        constitutions,
        syndrome_name: text((ha.health_state || '').match(/兼有[（(]?([^）)\n]+)/)?.[1], '痰湿'),
        syndrome_desc: text(ha.occurrence_mechanism, '').slice(0, 100),
        care_summary: [
          { label: '穴位', content: acupoints[0]?.content || '足三里' },
          { label: '膳食', content: normalizeFoodList(dietary.recommended_foods, ['山药'])[0] || '山药' },
        ],
        contraindications: [{
          type: '忌口',
          items: normalizeFoodList(dietary.avoid_foods, ['油腻']).map((c) => ({ content: c })),
        }],
        report_code: text(structured?.report_id, ''),
        generate_time: text(structured?.metadata?.report_date, ''),
        data_source: '云诊舌诊结构化报告',
      },
      actions: [],
      followup_suggestions: drillFollowups,
    };
  }

  return null;
}

export function fillElderDuplicateConfirmCard({ name, candidates = [] } = {}) {
  const list = candidates.map((e, i) => ({
    num: i + 1,
    name: e.elder_name || e.name,
    age: e.age || e.elder_age || '—',
    gender: e.gender || e.elder_sex || e.sex || '—',
    area: e.address_label || e.community_name || e.area || '—',
    chronic: e.care_level || e.chronic || e.ability_status || '—',
    elder_id: e.elder_id || e.id || '',
  }));
  return {
    template_id: 'elder_duplicate_confirm_card',
    answer_text: `找到 ${list.length} 位同名「${name}」，请确认是哪一位。`,
    data: {
      name,
      count: list.length,
      candidates: list,
    },
    actions: list.map((c) => ({
      action_key: 'health_risk_warning.select_elder',
      label: `选择${c.num}号 ${c.name}（${c.age}岁·${c.area}）`,
      params: { elder_id: c.elder_id, elder_name: c.name, template_id: 'health_warning_card' },
    })),
    followup_suggestions: [
      { label: '查看使用帮助', user_prompt: '健康风险预警怎么用', action_key: 'health_risk_warning.view_help' },
    ],
  };
}

function healthDrillFollowups(elderParams = {}) {
  return withEntityParams([
    {
      label: '查看完整报告',
      user_prompt: '查看完整健康报告',
      action_key: 'health_risk_warning.view_report',
      params: { template_id: 'health_report_card' },
    },
    {
      label: '查看调理方案',
      user_prompt: '查看个性化调理方案',
      action_key: 'health_risk_warning.view_advice',
      params: { template_id: 'care_advice_card' },
    },
    {
      label: '体质详情',
      user_prompt: '查看中医体质辨识',
      action_key: 'health_risk_warning.view_constitution',
      params: { template_id: 'constitution_card' },
    },
  ], elderParams);
}

function inferDest(message = '') {
  if (/北海/.test(message)) return '北海';
  if (/巴马/.test(message)) return '巴马';
  if (/桂林|阳朔/.test(message)) return '桂林';
  if (/防城港|东兴|嘉路/.test(message)) return '防城港';
  // 泛化文案禁止默认防城港/巴马
  return '';
}

/** 已实现本地确定性填槽的模板集合（其余可放开 LLM） */
export const LOCAL_FILL_TEMPLATE_IDS = new Set([
  'weekly_plan', 'diet_card', 'meal_timeline_card', 'meal_overview_card', 'meal_dashboard_card',
  'sojourn_route', 'sojourn_base', 'travel_itinerary_card', 'travel_availability_card',
  'travel_h5_embed_card', 'travel_weather_risk_card', 'travel_spot_card', 'travel_medical_card',
  'travel_transport_card', 'travel_need_summary_card', 'travel_plan_summary_card', 'travel_budget_card',
  'health_warning_card', 'health_risk_signal_card', 'health_risk_rule_card', 'risk_assessment_card',
  'health_report_card', 'risk_warning_card', 'dietary_regimen_card',
  'constitution_card', 'tongue_diagnosis_card', 'face_observation_card', 'tcm_syndrome_card',
  'care_advice_card', 'risk_level_card', 'help_card', 'elder_duplicate_confirm_card',
  'policy_card', 'policy_list_card', 'policy_apply_guide_card', 'policy_detail_card',
  'service_emergency', 'service_recommend', 'service_detail', 'service_catalog', 'org_profile',
  'worker_profile', 'order_preview', 'order_status',
  'service_order_form', 'service_order_ticket', 'service_expand', 'service_guess_like',
  'service_trace', 'service_review',
  'service_booking_confirm', 'booking_success', 'booking_reschedule', 'contact_confirm',
  'dispatch_list', 'dispatch_detail', 'work_order', 'dispatch_status',
  'dispatch_accept', 'dispatch_reject', 'dispatch_transfer', 'dispatch_supplier_action',
  'institution_quality_report', 'staff_quality_report', 'org_quality_ranking',
  'staff_quality_ranking', 'rectification_suggestion', 'complaint_detail', 'evaluation_standard',
]);
