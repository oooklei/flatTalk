// 共享工具：文本消毒、HTML 安全键、地图静态图 URL、老人姓名提取
// 这些工具被 dispatch / health-cards / nearby-cards / travel-cards 等多个子模块复用。

const HTML_TAG_PATTERN = /<[^>]*>/g;
const EVENT_HANDLER_PATTERN = /\bon[a-z]+\s*=/gi;
const SCRIPT_PROTOCOL_PATTERN = /javascript\s*:/gi;

// 腾讯地图 JS API Key。留空或占位符时卡片自动降级为 SVG 方位图。
const NEARBY_TENCENT_JS_KEY = 'KI4BZ-5GGLT-POOXY-LQK77-6XA62-YVFPH';

// 这些 key 的字符串值内嵌 HTML / JSON，不能被 sanitizeText 清洗
const HTML_SAFE_KEYS = new Set([
  'static_svg',
  'compact_followups',
  'rendered_html',
  'waypoint_spots_json',
  'markers_json',
  'center_json',
  'static_map_url',
  'static_map_url_json',
  'static_map_img',
  'wellnessItems_json',
  'picks_json',
  'routeStops_json',
  'walkItems_json',
]);

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

/**
 * 构建静态图 URL（周边降级用）
 * 走同源 /api/map/static 缓存代理：腾讯成功则落盘；配额 121 时回落磁盘缓存/占位图。
 * （不再把带 Key 的腾讯 URL 直接塞进卡片，避免前端直连撞配额后得到 JSON 空白图）
 */
function buildStaticMapUrl(center, markers = [], options = {}) {
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) return '';
  const zoom = options.zoom || 11;
  const size = options.size || '600*420';
  const points = (markers || []).slice(0, 30)
    .filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))
    .map((m) => `${Number(m.lat)},${Number(m.lng)}`);
  const markerParam = points.length
    ? ['color:blue', 'size:mid', ...points].join('|')
    : '';
  const qs = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
    zoom: String(zoom),
    size: String(size),
    label: String(center.name || '周边地图'),
  });
  if (markerParam) qs.set('markers', markerParam);
  return `/api/map/static?${qs.toString()}`;
}

/**
 * 从消息文本中提取老人姓名：先匹配"X老人/X奶奶"等称谓，再回退到 mock 档案姓名。
 * 被 dispatch（同名确认卡）与 health-cards（健康预警卡）共用。
 */
function extractElderName(message, mockElders = []) {
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

export {
  HTML_TAG_PATTERN,
  EVENT_HANDLER_PATTERN,
  SCRIPT_PROTOCOL_PATTERN,
  HTML_SAFE_KEYS,
  NEARBY_TENCENT_JS_KEY,
  sanitizeModelResult,
  sanitizeText,
  decodeTextEntities,
  buildStaticMapUrl,
  extractElderName,
};
