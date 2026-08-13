/**
 * KEEP_WITH_MONITOR：降级路径进程内计数 + 近期事件环 + 探测入口。
 * Admin「降级监控」页读取快照并触发 detect。
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_EVENTS = 200;
const startedAt = Date.now();

/** @type {Map<string, { count: number, last_at: number|null, last_detail: string }>} */
const counters = new Map();

/** @type {Array<{ ts: number, id: string, detail?: string, meta?: object }>} */
const events = [];

export const DEGRADE_METRIC_DEFS = Object.freeze([
  { id: 'lis_unreachable', label: 'LIS 不可达', group: 'lis', severity: 'warn' },
  { id: 'lis_breaker_open', label: 'LIS 熔断打开', group: 'lis', severity: 'error' },
  { id: 'lis_breaker_suppress', label: 'LIS 熔断抑制', group: 'lis', severity: 'warn' },
  { id: 'match_ok_marginal', label: '弱置信 MATCH_OK_MARGINAL', group: 'lis', severity: 'info' },
  { id: 'kb_remote_failed', label: 'KB 远程失败', group: 'kb', severity: 'warn' },
  { id: 'kb_local_hit', label: 'KB 本地命中兜底', group: 'kb', severity: 'info' },
  { id: 'llm_fallback_mock', label: 'LLM fallback_mock', group: 'llm', severity: 'warn' },
  { id: 'gxy_soft_err', label: 'gxy 订单/工单 soft_err', group: 'gxy', severity: 'warn' },
  { id: 'tag_pg_error', label: 'tag-system pg_error', group: 'tag', severity: 'error' },
  { id: 'map_key_exhausted', label: '地图 Key 配额耗尽', group: 'map', severity: 'warn' },
  { id: 'map_pool_exhausted', label: '地图 Key 池全耗尽', group: 'map', severity: 'error' },
  { id: 'map_unconfigured', label: '地图未配置', group: 'map', severity: 'error' },
]);

/** KEEP_OK：合法产品兜底，默认保留；只读盘点 + 命中计数（不提供关闭开关） */
export const KEEP_OK_DEFS = Object.freeze([
  {
    id: 'chitchat_llm_fallback',
    label: '闲聊不锁技能',
    how: '弱闲聊预检跳过 LIS 锁技能，走 LLM 通用答',
    where: 'src/core/lis/lis-gate-hook.js',
    view: '降级监控命中计数 / 会话 reason=chitchat_llm_fallback',
  },
  {
    id: 'conversation_busy',
    label: '同会话互斥 / 队列引导',
    how: '并发同会话返回 busy，引导排队',
    where: 'src/app.js',
    view: '接口 error=conversation_busy；移动端 toast',
  },
  {
    id: 'asr_fallback_chain',
    label: 'ASR 浏览器→腾讯→服务端',
    how: '语音识别逐级降级，失败有 toast',
    where: 'src/public/mobile.js + ASR 集成',
    view: '移动端 toast（无服务端统一计数）',
  },
  {
    id: 'ocr_soft_fail',
    label: 'OCR soft fail',
    how: 'HTTP 200 + ocrOk:false，不编造文字',
    where: 'src/app.js OCR 处理',
    view: '响应 input.ocrOk / warning；本页命中计数',
  },
  {
    id: 'template_fallback_error',
    label: '模板渲染 fallback_error',
    how: '渲染失败落到降级模板，带标记',
    where: 'src/core/render/template-card-renderer.js',
    view: '运行日志 / 本页命中计数',
  },
  {
    id: 'jtd_skipped',
    label: 'JTD 未注入诚实 skip',
    how: '服务未配置时 skipped，不出假产品卡',
    where: 'src/core/orchestrator/chat-orchestrator.js',
    view: 'data access / 本页命中计数',
  },
  {
    id: 'smart_fallback',
    label: 'smart-fallback-handler',
    how: '技能失败转自然语言兜底',
    where: 'src/core/fallback/smart-fallback-handler.js',
    view: '回答文案；本页命中计数',
  },
  {
    id: 'match_ok_marginal',
    label: 'MATCH_OK_MARGINAL 入语料',
    how: '弱命中写入语料供标注，不锁假业务',
    where: 'src/core/lis/lis-gate-hook.js + LIS corpus',
    view: '监控指标 match_ok_marginal；LIS admin 语料',
  },
  {
    id: 'need_clarify_empty_to_llm',
    label: 'NEED_CLARIFY 空选项→LLM',
    how: '澄清选项为空时不画空按钮，改走 LLM',
    where: 'src/core/lis/lis-gate-hook.js',
    view: '本页命中计数 / 会话路径',
  },
]);

function ensure(id) {
  if (!counters.has(id)) {
    counters.set(id, { count: 0, last_at: null, last_detail: '' });
  }
  return counters.get(id);
}

for (const d of DEGRADE_METRIC_DEFS) ensure(d.id);
for (const d of KEEP_OK_DEFS) ensure(`keep_ok:${d.id}`);

/**
 * KEEP_OK 命中计数（与监控指标共用环，前缀 keep_ok:）
 */
export function recordKeepOk(id, detailOrMeta = '', meta = undefined) {
  recordDegrade(`keep_ok:${id}`, detailOrMeta, meta);
}

export function getKeepOkCatalog() {
  return KEEP_OK_DEFS.map((d) => {
    const c = ensure(`keep_ok:${d.id}`);
    // MATCH_OK_MARGINAL 同时记在监控指标里，展示时合并
    const linked = d.id === 'match_ok_marginal' ? ensure('match_ok_marginal') : null;
    const count = c.count + (linked?.count || 0);
    const last_at = Math.max(c.last_at || 0, linked?.last_at || 0) || null;
    const last_detail = (c.last_at || 0) >= (linked?.last_at || 0)
      ? c.last_detail
      : (linked?.last_detail || c.last_detail);
    return {
      ...d,
      policy: 'KEEP_OK',
      switchable: false,
      count,
      last_at,
      last_detail,
    };
  });
}

/**
 * @param {string} id
 * @param {string|object} [detailOrMeta]
 * @param {object} [meta]
 */
export function recordDegrade(id, detailOrMeta = '', meta = undefined) {
  const row = ensure(id);
  row.count += 1;
  row.last_at = Date.now();
  let detail = '';
  let m = meta;
  if (typeof detailOrMeta === 'string') {
    detail = detailOrMeta;
  } else if (detailOrMeta && typeof detailOrMeta === 'object') {
    m = detailOrMeta;
    detail = String(m.detail || m.error || m.reason || '');
  }
  row.last_detail = detail.slice(0, 240);
  events.push({
    ts: row.last_at,
    id,
    detail: row.last_detail,
    meta: m && typeof m === 'object' ? sanitizeMeta(m) : undefined,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

function sanitizeMeta(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'detail' || k === 'error' || k === 'reason') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = typeof v === 'string' ? v.slice(0, 120) : v;
    }
  }
  return out;
}

export function resetDegradeCounters() {
  for (const d of DEGRADE_METRIC_DEFS) {
    counters.set(d.id, { count: 0, last_at: null, last_detail: '' });
  }
  for (const d of KEEP_OK_DEFS) {
    counters.set(`keep_ok:${d.id}`, { count: 0, last_at: null, last_detail: '' });
  }
  events.length = 0;
}

export function getDegradeSnapshot({ includeEvents = true, limit = 50 } = {}) {
  const metrics = DEGRADE_METRIC_DEFS.map((d) => {
    const c = ensure(d.id);
    return {
      ...d,
      count: c.count,
      last_at: c.last_at,
      last_detail: c.last_detail,
    };
  });
  const total = metrics.reduce((s, m) => s + m.count, 0);
  const hot = metrics.filter((m) => m.count > 0).sort((a, b) => b.count - a.count);
  return {
    ok: true,
    service: 'flatTalk',
    kind: 'keep_with_monitor',
    started_at: startedAt,
    uptime_ms: Date.now() - startedAt,
    total_events: total,
    metrics,
    hot,
    recent: includeEvents ? events.slice(-Math.max(1, Number(limit) || 50)).reverse() : [],
    env_gates: readEnvGates(),
    keep_ok: getKeepOkCatalog(),
  };
}

function readEnvGates() {
  const g = (k) => (process.env[k] == null || process.env[k] === '' ? '(unset)' : String(process.env[k]));
  return {
    JTD_API_MODE: g('JTD_API_MODE'),
    FLATTALK_RUNTIME_MODE: g('FLATTALK_RUNTIME_MODE'),
    FLATTALK_DISABLE_SIM_FALLBACK: g('FLATTALK_DISABLE_SIM_FALLBACK'),
    FLATTALK_ALLOW_SIM_FALLBACK: g('FLATTALK_ALLOW_SIM_FALLBACK'),
    FLATTALK_ALLOW_JTD_MOCK: g('FLATTALK_ALLOW_JTD_MOCK'),
    FLATTALK_ALLOW_MOCK_ELDERS: g('FLATTALK_ALLOW_MOCK_ELDERS'),
    FLATTALK_ALLOW_MODEL_MOCK: g('FLATTALK_ALLOW_MODEL_MOCK'),
    FLATTALK_ALLOW_CATALOG_SEED: g('FLATTALK_ALLOW_CATALOG_SEED'),
    FLATTALK_ALLOW_LOCAL_QUALITY_CACHE: g('FLATTALK_ALLOW_LOCAL_QUALITY_CACHE'),
    FLATTALK_ALLOW_DEFAULT_LOCATION: g('FLATTALK_ALLOW_DEFAULT_LOCATION'),
    LIS_GATE_ENABLED: g('LIS_GATE_ENABLED'),
    FLATTALK_MODEL_MODE: g('FLATTALK_MODEL_MODE'),
  };
}

export const degradeMonitor = {
  record: recordDegrade,
  recordKeepOk,
  reset: resetDegradeCounters,
  snapshot: getDegradeSnapshot,
  defs: DEGRADE_METRIC_DEFS,
  keepOkDefs: KEEP_OK_DEFS,
};

export default degradeMonitor;
