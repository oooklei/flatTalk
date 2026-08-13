/**
 * 旅居行程归一化
 * 统一 Excel 多日（day/theme/plan）与防城港小时制（time/content/note）两种知识库形态，
 * 供 route_svg「建议行程」与 travel_itinerary_card「每日日程」共用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalRoutes } from '../../services/travel/local-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_KB = path.join(
  __dirname,
  '../../skills/travel_route/knowledge/dashboard-travel-routes-knowledge.json',
);

let _dashboardCache = null;

function loadDashboardRoutes() {
  if (_dashboardCache !== null) return _dashboardCache;
  try {
    if (!fs.existsSync(DASHBOARD_KB)) {
      _dashboardCache = [];
      return _dashboardCache;
    }
    _dashboardCache = JSON.parse(fs.readFileSync(DASHBOARD_KB, 'utf8'));
    return _dashboardCache;
  } catch {
    _dashboardCache = [];
    return _dashboardCache;
  }
}

function text(v) {
  return String(v ?? '').trim();
}

function isHourlyItem(item = {}) {
  return !!(item.time || item.activity) && !!(item.content || item.activity || item.text);
}

function isHourlyList(list = []) {
  if (!Array.isArray(list) || !list.length) return false;
  const hourly = list.filter(isHourlyItem).length;
  return hourly >= Math.ceil(list.length * 0.6);
}

/** 途经点摘要型日程（plan 极短、无 theme）——优先用知识库完整日程替换 */
function isAbbreviatedWaypointItinerary(list = []) {
  if (!Array.isArray(list) || !list.length) return false;
  if (isHourlyList(list)) return false;
  const withTheme = list.filter((i) => text(i.theme)).length;
  if (withTheme > 0) return false;
  const plans = list.map((i) => text(i.plan || i.content));
  const short = plans.filter((p) => p && p.length <= 18 && !/[→\->|]/.test(p)).length;
  return short >= Math.ceil(list.length * 0.6);
}

function itineraryQuality(list = []) {
  if (!Array.isArray(list) || !list.length) return 0;
  if (isHourlyList(list)) return 100 + list.length;
  if (list.some((i) => text(i.theme) && text(i.plan))) return 80 + list.length;
  if (list.some((i) => text(i.plan) && text(i.plan).length > 20)) return 50 + list.length;
  return 10 + list.length;
}

/**
 * 按 route_id / product_id / 名称从本地知识库取完整 itinerary
 */
export function lookupKnowledgeItinerary({ routeId = '', productId = '', routeTitle = '', destination = '' } = {}) {
  const rid = text(routeId || productId);
  const title = text(routeTitle);
  const dest = text(destination).replace(/^广西/, '');

  // 1) 防城港 5 条本地产品（小时制完整日程）
  const localRoutes = loadLocalRoutes();
  const localHit = localRoutes.find((r) => {
    if (rid && (r.product_id === rid || String(r.product_id).includes(rid) || rid.includes(r.product_id))) return true;
    if (title && text(r.product_name) && (title.includes(r.product_name) || r.product_name.includes(title))) return true;
    return false;
  });
  if (localHit?.itinerary?.length) {
    return {
      source: 'fangchenggang_routes',
      route_id: localHit.product_id,
      days: 1,
      itinerary: localHit.itinerary,
      summary: localHit.summary || '',
      suitable_for: localHit.suitable_for || '',
      highlights: localHit.highlights || [],
    };
  }

  // 2) Dashboard 知识库（Excel 10 条 + FCG）
  const dash = loadDashboardRoutes();
  const dashHit = dash.find((r) => {
    const id = text(r.id);
    if (rid) {
      if (id === rid || id.includes(rid) || rid.includes(id)) return true;
      // fcg_route_001 ↔ route_dash_fcg_1
      const m = rid.match(/fcg_route_00?(\d)/i) || rid.match(/fcg[_-]?(\d)/i);
      if (m && id === `route_dash_fcg_${Number(m[1])}`) return true;
      const gx = rid.match(/gx_excel_0?(\d+)/i);
      if (gx && /excel/.test(id) && id.includes(`线路${Number(gx[1])}`)) return true;
    }
    if (title && text(r.name) && (title.includes(r.name) || r.name.includes(title.slice(0, 8)))) return true;
    return false;
  });
  if (dashHit?.itinerary?.length) {
    return {
      source: 'dashboard_travel_routes',
      route_id: dashHit.id,
      days: dashHit.days || dashHit.itinerary.length,
      itinerary: dashHit.itinerary,
      summary: dashHit.summary || dashHit.description || '',
      suitable_for: dashHit.suitable_for || '',
      highlights: dashHit.highlights || [],
    };
  }

  // 3) 弱匹配仅按标题/关键词精确挑线，禁止一律绑第一条（避免银发线串成京族线）
  const blob = `${dest}${title}${rid}`;
  if (/防城港|东兴|京族|嘉路|边境|白浪|十万大山|企沙|金花茶|渔港/.test(blob)) {
    const keywordHit = localRoutes.find((r) => {
      const name = text(r.product_name);
      if (!name) return false;
      if (title && (title.includes(name) || name.includes(title.slice(0, 6)))) return true;
      if (/京族|独弦琴|金滩/.test(blob) && /京族/.test(name)) return true;
      if (/爱情|边境|国门|界碑/.test(blob) && /爱情|边境/.test(name)) return true;
      if (/白浪|金花茶/.test(blob) && /白浪|金花茶/.test(name)) return true;
      if (/十万大山|森林/.test(blob) && /十万|森林/.test(name)) return true;
      if (/企沙|渔港|海鲜/.test(blob) && /企沙|渔港/.test(name)) return true;
      return false;
    });
    if (keywordHit?.itinerary?.length) {
      return {
        source: 'fangchenggang_routes',
        route_id: keywordHit.product_id,
        days: 1,
        itinerary: keywordHit.itinerary,
        summary: keywordHit.summary || '',
        suitable_for: keywordHit.suitable_for || '',
        highlights: keywordHit.highlights || [],
      };
    }
  }

  return null;
}

function splitPlanToSlots(plan = '') {
  const parts = String(plan || '')
    .split(/\s*[→\-–—>|／/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    if (!text(plan)) return [];
    return [
      { time: '上午', text: text(plan) },
      { time: '下午', text: '预留休息与补水，按体力灵活调整。' },
    ];
  }
  const labels = parts.length <= 3
    ? ['上午', '下午', '傍晚']
    : parts.map((_, i) => (i === 0 ? '上午' : i === parts.length - 1 ? '傍晚' : `时段${i + 1}`));
  return parts.map((p, i) => ({ time: labels[i] || `时段${i + 1}`, text: p }));
}

/** 把「07:00-08:00内容一08:00-08:30内容」类长串拆成时段列表 */
function explodeConcatenatedHourlyPlan(plan = '') {
  const raw = text(plan);
  if (!raw) return [];
  // 优先匹配完整区间，避免把 07:00-08:00 中间的 08:00 拆成新起点
  const re = /(\d{1,2}:\d{2}\s*[-–—~至到]\s*\d{1,2}:\d{2})/g;
  const marks = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    marks.push({ index: m.index, time: m[1].replace(/\s+/g, ''), end: m.index + m[1].length });
  }
  if (marks.length < 2) return [];
  const slots = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].end;
    const stop = i + 1 < marks.length ? marks[i + 1].index : raw.length;
    let body = text(raw.slice(start, stop))
      .replace(/^[：:\-–—一|]+/, '')
      .replace(/[一|→\-–—]+$/, '')
      .trim();
    if (!body) continue;
    slots.push({ time: marks[i].time, text: body, note: '', has_note: false });
  }
  return slots.length >= 2 ? slots : [];
}

/** 主卡预览：最多保留 N 个关键时段，避免把整日小时制塞进一行 */
function buildSlotsPreview(slots = [], limit = 4) {
  const list = Array.isArray(slots) ? slots.filter((s) => text(s.text)) : [];
  if (!list.length) return { preview: [], more: 0, has_more: false };
  if (list.length <= limit) {
    return { preview: list, more: 0, has_more: false };
  }
  // 优先保留首尾 + 中段代表性节点
  const mid = list.slice(1, -1);
  const pickMid = mid.length <= limit - 2
    ? mid
    : [mid[Math.floor(mid.length / 3)], mid[Math.floor((mid.length * 2) / 3)]].filter(Boolean);
  const preview = [list[0], ...pickMid, list[list.length - 1]].slice(0, limit);
  return {
    preview,
    more: Math.max(0, list.length - preview.length),
    has_more: list.length > preview.length,
  };
}

function summarizePlan(slots = [], fallback = '') {
  const texts = (Array.isArray(slots) ? slots : [])
    .map((s) => text(s.text).replace(/（[^）]*）/g, '').trim())
    .filter(Boolean);
  if (texts.length >= 2) {
    const head = texts.slice(0, 3).map((t) => (t.length > 14 ? `${t.slice(0, 14)}…` : t));
    const suffix = texts.length > 3 ? `等 ${texts.length} 个时段` : '';
    return `${head.join(' → ')}${suffix ? `（${suffix}）` : ''}`;
  }
  const fb = text(fallback);
  if (fb.length > 72) return `${fb.slice(0, 70)}…`;
  return fb;
}

/**
 * 归一为路线主卡「建议行程」列表：{ day, theme, wp_name, plan, accommodation, slots? }
 */
export function normalizeItineraryForRouteCard(raw = []) {
  const list = Array.isArray(raw) ? raw.filter(Boolean) : [];
  if (!list.length) return [];

  // 已是主卡归一形态（含 slots），避免二次把 plan 拆坏
  if (list.every((i) => Array.isArray(i?.slots) || text(i?.day))) {
    const looksNormalized = list.some((i) => Array.isArray(i?.slots) && (i.has_theme != null || i.has_slots_preview != null));
    if (looksNormalized) {
      return list.map((item, i) => {
        const slots = Array.isArray(item.slots)
          ? item.slots.map((s) => ({
            time: text(s.time),
            text: text(s.text || s.content),
            note: text(s.note),
            has_note: !!text(s.note),
          }))
          : [];
        const isHourly = !!item.is_hourly || slots.some((s) => /^\d{1,2}:\d{2}/.test(s.time));
        const accommodation = text(item.accommodation);
        const plan = isHourly ? '' : (text(item.plan_summary || item.plan) || summarizePlan(slots, ''));
        return {
          day: text(item.day) || `D${i + 1}`,
          theme: text(item.theme),
          wp_name: text(item.wp_name || item.name),
          plan,
          plan_summary: plan || summarizePlan(slots, ''),
          accommodation: accommodation && accommodation !== '无' ? accommodation : '',
          slots,
          slots_preview: slots,
          slots_more: 0,
          is_hourly: isHourly,
          has_theme: !!text(item.theme),
          has_accommodation: !!(accommodation && accommodation !== '无'),
          has_slots: slots.length > 0,
          has_slots_preview: slots.length > 0,
          has_slots_more: false,
        };
      });
    }
  }

  if (isHourlyList(list)) {
    const slots = list.map((item) => ({
      time: text(item.time) || '时段',
      text: text(item.content || item.activity || item.text),
      note: text(item.note),
      has_note: !!text(item.note),
    }));
    const plan = summarizePlan(slots, list.map((i) => text(i.content || i.activity)).filter(Boolean).join(' → '));
    return [{
      day: 'D1',
      theme: '一日康养（大本营 + 半日外出）',
      wp_name: '',
      plan: '', // 小时制禁止输出长串，一律走 slots 结构化
      plan_summary: plan,
      accommodation: '',
      slots,
      slots_preview: slots,
      slots_more: 0,
      is_hourly: true,
      has_theme: true,
      has_accommodation: false,
      has_slots: true,
      has_slots_preview: true,
      has_slots_more: false,
    }];
  }

  return list.map((item, i) => {
    const day = text(item.day) || `D${i + 1}`;
    const theme = text(item.theme);
    const fullPlan = text(item.plan || item.content || item.text);
    const accommodation = text(item.accommodation);
    // 若 plan 被串成「07:00-08:00xxx一08:00-08:30yyy」长串，拆回时段
    const exploded = explodeConcatenatedHourlyPlan(fullPlan);
    const slots = Array.isArray(item.slots) && item.slots.length
      ? item.slots.map((s) => ({
        time: text(s.time),
        text: text(s.text || s.content),
        note: text(s.note),
        has_note: !!text(s.note),
      }))
      : (exploded.length
        ? exploded
        : splitPlanToSlots(fullPlan).map((s) => ({ ...s, note: '', has_note: false })));
    const isHourly = exploded.length > 0 || slots.some((s) => /^\d{1,2}:\d{2}/.test(s.time));
    const multiDay = list.length > 1 && !isHourly;
    const plan = isHourly ? '' : summarizePlan(slots, fullPlan);
    return {
      day,
      theme,
      wp_name: text(item.wp_name || item.name),
      plan,
      plan_summary: plan,
      full_plan: fullPlan,
      accommodation: accommodation && accommodation !== '无' ? accommodation : '',
      slots,
      slots_preview: multiDay ? [] : slots,
      slots_more: 0,
      is_hourly: isHourly,
      has_theme: !!theme,
      has_accommodation: !!(accommodation && accommodation !== '无'),
      has_slots: !multiDay && slots.length > 0,
      has_slots_preview: !multiDay && slots.length > 0,
      has_slots_more: false,
    };
  });
}

/**
 * 归一为行程详情卡 days：{ day, theme, slots[], tip, accommodation }
 */
export function normalizeItineraryForDetailCard(raw = [], { destination = '', tip } = {}) {
  const routeItems = normalizeItineraryForRouteCard(raw);
  const defaultTip = tip || '贴心提示：如老人血压、血糖波动或天气不适合外出，当天行程可改为基地内休整。';
  return routeItems.map((item, index) => {
    let slots = item.slots || [];
    if (!slots.length && (item.full_plan || item.plan)) {
      slots = splitPlanToSlots(item.full_plan || item.plan);
    }
    if (!slots.length) {
      slots = [
        { time: '上午', text: `抵达${destination || '目的地'}，按低强度节奏安排活动。`, note: '', has_note: false },
        { time: '下午', text: '预留休息时间，避免赶路。', note: '', has_note: false },
      ];
    }
    slots = slots.map((s) => ({
      time: text(s.time),
      text: text(s.text || s.content),
      note: text(s.note),
      has_note: !!text(s.note),
    }));
    return {
      day: item.day || `D${index + 1}`,
      theme: item.theme || (index === 0 ? `抵达${destination || '目的地'}` : `第${index + 1}天康养体验`),
      slots,
      tip: defaultTip,
      accommodation: item.accommodation || '',
      has_accommodation: !!item.accommodation,
      is_hourly: !!item.is_hourly || slots.some((s) => /^\d{1,2}:\d{2}/.test(text(s.time))),
    };
  });
}

/**
 * 从多源候选中挑选质量最高的原始 itinerary，并归一化给主卡
 */
export function resolveAndNormalizeItinerary({
  candidates = [],
  routeId = '',
  productId = '',
  routeTitle = '',
  destination = '',
} = {}) {
  const kb = lookupKnowledgeItinerary({ routeId, productId, routeTitle, destination });
  const pool = [];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) pool.push(c);
  }
  if (kb?.itinerary?.length) pool.push(kb.itinerary);

  // 若当前候选全是途经点摘要，强制优先知识库完整日程
  const bestCand = pool.slice().sort((a, b) => itineraryQuality(b) - itineraryQuality(a))[0] || [];
  let chosen = bestCand;
  if (isAbbreviatedWaypointItinerary(bestCand) && kb?.itinerary?.length) {
    chosen = kb.itinerary;
  }

  const normalized = normalizeItineraryForRouteCard(chosen);
  return {
    raw: chosen,
    itinerary: normalized,
    knowledge: kb,
    daysLabel: kb?.days
      ? (String(kb.days).includes('天') ? String(kb.days) : `${kb.days}天`)
      : (normalized.length ? `${normalized.length}天` : ''),
  };
}
