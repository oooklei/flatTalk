/**
 * Utterance guards for chitchat / weak / low-signal inputs.
 * Used by LIS gate + orchestrator + smartFallback to force LLM+answer
 * instead of locking a business skill on noise.
 */

const CHITCHAT_RE = /^(你好|您好|嗨|在吗|谢谢|多谢|好的|哈哈+|嗯+|哦+|喔+|拜拜|再见|早上好|晚安|中午好|下午好|你是谁|你叫什么|干什么的|你会什么|介绍一下自己|谁啊|在不在|忙吗)[吗嘛呀啊呢吧~～。.!！？?\s]*$/i;

const PUNCT_ONLY_RE = /^[\s？?！!。．.…·、，,；;：:\-—_=~～]+$/;

const TRAVEL_SIGNAL_RE = /旅|游|景点|路线|天气|高铁|机票|民宿|巴马|桂林|北海|防城港|东兴|阳朔|涠洲|目的地|预订|预算|行程|康养线|旅居|几日游|出行/;

const SKILL_ANCHORS = {
  travel_route: TRAVEL_SIGNAL_RE,
  meal_plan: /吃|餐|食|饭|忌口|控糖|减肥|膳食|食谱|晚餐|早餐|营养/,
  health_risk_warning: /血压|血糖|健康|报告|舌|面诊|慢病|药|住院|体检|脂肪肝|三高|病/,
  find_service: /护工|上门|养老院|服务|护理|预约|下单|目录|机构/,
  nearby_resource: /附近|周边|地图|配套|多少公里/,
  dispatch_manage: /派单|工单|催单|接单/,
};

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isWeakOrChitchatUtterance(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.length <= 1) return true;
  if (PUNCT_ONLY_RE.test(t)) return true;
  if (CHITCHAT_RE.test(t)) return true;
  // very short non-business tokens
  if (t.length <= 3 && !hasAnySkillAnchor(t)) return true;
  return false;
}

/**
 * @param {string} text
 * @param {string} [skillKey]
 * @returns {boolean}
 */
export function hasSkillAnchor(text, skillKey) {
  const re = SKILL_ANCHORS[String(skillKey || '')];
  if (!re) return hasAnySkillAnchor(text);
  return re.test(String(text || ''));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasAnySkillAnchor(text) {
  const t = String(text || '');
  return Object.values(SKILL_ANCHORS).some((re) => re.test(t));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasTravelSignal(text) {
  return TRAVEL_SIGNAL_RE.test(String(text || ''));
}

/**
 * Light name mention from utterance (我叫X / 我是X).
 * @param {string} text
 * @returns {string}
 */
export function extractMentionedName(text) {
  const t = String(text || '');
  const m = t.match(/我叫\s*([A-Za-z\u4e00-\u9fff·]{2,8})/)
    || t.match(/我是\s*([A-Za-z\u4e00-\u9fff·]{2,8})(?=，|,|。|$|今年|岁)/)
    || t.match(/他叫\s*([A-Za-z\u4e00-\u9fff·]{2,8})/)
    || t.match(/她叫\s*([A-Za-z\u4e00-\u9fff·]{2,8})/);
  if (!m) return '';
  const name = String(m[1] || '').replace(/(老人|奶奶|爷爷|阿姨|叔叔)$/, '');
  return name.length >= 2 ? name : '';
}

/** Strong accept floor — barely-above-threshold MATCH_OK must not lock skills. */
export function strongAcceptThreshold(env = process.env) {
  const raw = Number(env.LIS_STRONG_ACCEPT_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) return raw;
  return 0.7;
}
