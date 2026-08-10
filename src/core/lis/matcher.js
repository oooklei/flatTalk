/**
 * Match LIS IntentSupply against enabled flatTalk catalog entries.
 * Execution key is intent_id; domain is not used as a hard filter.
 *
 * 阈值来源：优先用 LIS 返回的 `decision.threshold`，缺失时回退本地默认。
 * 原先两侧各自硬编码 0.5 且互不校验——LIS 改阈值后 flatTalk 不会跟随，
 * 会静默漂移（表现为"某些意图突然不执行了"却查不出原因）。
 */

/** LIS 未返回 threshold 时的回退值（须与 LIS 的 INTENT_MATCH_THRESHOLD 一致） */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/**
 * 次意图（secondary）转追问按钮的置信度门槛。
 *
 * LIS 每次都返回全部候选并按分排序，低分项基本是噪音：
 * 实测「给我做个控糖食谱」会带出 travel_route_plan(0.31)、
 * nearby_resource.food(0.07) —— 用户完全没提这些。
 * 而「防城港三日游天气怎么样」的 travel_route_weather_risk(0.75)
 * 是用户真实的第二需求。0.6 能留下真需求、挡掉噪音。
 */
const SECONDARY_SUGGEST_THRESHOLD = 0.6;

/**
 * 把 catalog 的 intent_desc 清洗成用户可读的按钮文案。
 *
 * intent_desc 多数是脚本自动生成的**运维描述**，格式为
 * `skill / intent：锚点1、锚点2`，例如：
 *   "meal_plan / weekly_plan：一周、七天、周计划、本周"
 * 直接当按钮 label 会把内部 id 和锚点表暴露给终端用户
 * （实测线上出现过这两个按钮，用户完全看不懂）。
 *
 * 清洗规则：
 *   1. 有 `skill / intent：` 前缀的 → 判定为自动生成的锚点串，
 *      **不适合做按钮文案**，直接弃用（返回空，调用方会过滤掉该建议）。
 *      理由：锚点是匹配用的碎片词（"一周"、"接"、"催"），拼成按钮既不通顺
 *      也无动作感；截断成"一周、七天、周计划、养老…"更糟。
 *   2. 无前缀的人工描述（如"查看派单列表与工单"）是给人看的，保留。
 *   3. 过长截断，避免撑破卡片底部按钮区。
 *
 * 想让这类意图重新出现在追问区，正确做法是给它的 manifest 补 `name`
 * 或给 catalog 补一条人工 intent_desc，而不是把锚点表塞给用户。
 */
export function humanizeIntentLabel(intentDesc) {
  const raw = String(intentDesc || '').trim();
  if (!raw) return '';

  // `skill / intent：...` 是脚本自动生成的运维描述，不外显
  if (/^[\w.]+\s*\/\s*[\w.]+\s*[:：]/.test(raw)) return '';
  // 纯内部路径同样不外显
  if (/^[\w.]+\s*\/\s*[\w.]+$/.test(raw)) return '';

  return raw.length > 14 ? `${raw.slice(0, 14)}…` : raw;
}

/** 追问建议最多几条，避免卡片底部堆满按钮 */
const MAX_SECONDARY_SUGGESTIONS = 2;

/**
 * 取生效阈值：LIS 下发优先，非法值回退默认。
 * @param {object} decision
 * @returns {number}
 */
export function resolveThreshold(decision = {}) {
  const t = Number(decision?.threshold);
  if (Number.isFinite(t) && t > 0 && t <= 1) return t;
  return DEFAULT_CONFIDENCE_THRESHOLD;
}

/**
 * @param {object} supply - IntentSupply-like { intents, decision }
 * @param {Array<object>} catalogEntries - catalog intent packages
 * @returns {{ ok: boolean, entry: object|null, intent: object|null,
 *            threshold: number, suggestions: Array<object> }}
 */
export function matchSupplyToCatalog(supply = {}, catalogEntries = []) {
  const intents = Array.isArray(supply?.intents) ? supply.intents : [];
  const decision = supply?.decision || {};
  const threshold = resolveThreshold(decision);
  // 始终用 threshold 裁决：即使 LIS 标了 MATCH_OK，置信度不达标也不执行。
  // （原先 `status === MATCH_OK` 短路会让抬高门槛失效。）
  const maxConf = Number(decision.max_confidence);
  const statusOk = Number.isFinite(maxConf)
    ? maxConf >= threshold
    : decision.status === 'MATCH_OK';

  const enabledById = new Map();
  for (const pkg of Array.isArray(catalogEntries) ? catalogEntries : []) {
    if (!pkg || typeof pkg !== 'object') continue;
    if (pkg.enabled === false) continue;
    const id = pkg.intent_id;
    if (!id) continue;
    enabledById.set(String(id), pkg);
  }

  // 先收齐所有在目录内的候选，保留 LIS 给的 role 与顺序
  const matched = [];
  for (const intent of intents) {
    if (!intent || typeof intent !== 'object') continue;
    const id = intent.intent_id;
    if (!id) continue;
    const pkg = enabledById.get(String(id));
    if (!pkg) continue;
    const confidence = Number(intent.confidence);
    const score = Number.isFinite(confidence) ? confidence : 0;
    matched.push({ intent, pkg, score });
  }

  // 显式优先 LIS 标记的 primary，而非"恰好取最高分"。
  // LIS 的域软偏置(+0.05)会重排序，两侧各自取最大值只是巧合一致。
  // 若 primary 不在本地目录内（未启用/未收录），回退取最高分者。
  const best =
    matched.find((m) => m.intent.role === 'primary') ||
    matched.reduce((acc, m) => (!acc || m.score > acc.score ? m : acc), null);

  if (!statusOk || !best) {
    return { ok: false, entry: null, intent: null, threshold, suggestions: [] };
  }

  // 高分次意图转为追问建议：只是建议，用户不点则无副作用
  const suggestions = matched
    .filter((m) => m !== best && m.score >= SECONDARY_SUGGEST_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SECONDARY_SUGGESTIONS)
    .map((m) => ({
      intent_id: m.intent.intent_id,
      confidence: m.score,
      skill_key: m.pkg.entry?.skill_key ?? null,
      template_id: m.pkg.entry?.template_id ?? null,
      label: humanizeIntentLabel(m.pkg.intent_desc),
    }))
    // label 清洗不出人话就不展示：宁可少一个按钮，
    // 也不要把 "meal_plan / weekly_plan：一周、七天" 这种内部描述给用户看
    .filter((s) => s.label);

  return {
    ok: true,
    entry: best.pkg.entry ?? null,
    intent: best.intent,
    threshold,
    suggestions,
  };
}
