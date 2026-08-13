/**
 * KEEP_WITH_MONITOR 检测操作：主动探测各韧性链路是否健康。
 */
import { createLisClient } from '../core/lis/lis-client.js';
import { getLisBaseUrl, isLisGateEnabled } from '../core/lis/lis-gate-hook.js';
import { lisBreaker } from '../core/lis/lis-breaker.js';
import { listWsKeyPairs, getWsKeyPoolStatus } from '../services/map/tencent-key-pool.js';
import { getDegradeSnapshot } from '../core/observability/degradation-monitor.js';

export const DEGRADE_PROBE_DEFS = Object.freeze([
  { id: 'lis_health', label: 'LIS 健康检查', group: 'lis' },
  { id: 'lis_sort', label: 'LIS SORT 探测', group: 'lis' },
  { id: 'lis_breaker', label: 'LIS 熔断状态', group: 'lis' },
  { id: 'kb_remote', label: '知识库远程探测', group: 'kb' },
  { id: 'tag_pg', label: 'tag-system PG 探测', group: 'tag' },
  { id: 'gxy_order', label: 'gxy 订单页探测', group: 'gxy' },
  { id: 'map_keys', label: '腾讯地图 Key 池', group: 'map' },
  { id: 'env_gates', label: '生产降级闸门', group: 'env' },
  { id: 'jtd_mode', label: '金跳动模式', group: 'jtd' },
  { id: 'all', label: '全部检测', group: 'all' },
]);

async function probeLisHealth() {
  const base = getLisBaseUrl();
  const url = `${base}/health`;
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const body = await res.json().catch(() => ({}));
    const encoder = body?.encoder || body?.metrics?.encoder;
    return {
      id: 'lis_health',
      ok: res.ok && body?.ok !== false,
      latency_ms: Date.now() - t0,
      detail: `status=${res.status} encoder=${encoder || '?'} scorer=${body?.scorer || '?'}`,
      data: { url, gate_enabled: isLisGateEnabled(), encoder, scorer: body?.scorer },
    };
  } catch (e) {
    return {
      id: 'lis_health',
      ok: false,
      latency_ms: Date.now() - t0,
      detail: e.message || String(e),
      data: { url, gate_enabled: isLisGateEnabled() },
    };
  }
}

async function probeLisSort() {
  const base = getLisBaseUrl();
  const t0 = Date.now();
  try {
    const client = createLisClient({ baseUrl: base, timeoutMs: 5000 });
    const out = await client.sort({
      utterance: '附近有什么餐厅',
      session_id: `admin-probe-${Date.now()}`,
    });
    const top = out?.intents?.[0] || out?.decision?.primary || null;
    return {
      id: 'lis_sort',
      ok: Boolean(out),
      latency_ms: Date.now() - t0,
      detail: top
        ? `top=${top.intent_id || top.id || '?'} conf=${top.confidence ?? '?'}`
        : 'sort returned without intents',
      data: { top_intent: top?.intent_id || null, confidence: top?.confidence ?? null },
    };
  } catch (e) {
    return {
      id: 'lis_sort',
      ok: false,
      latency_ms: Date.now() - t0,
      detail: e.message || String(e),
    };
  }
}

function probeLisBreaker() {
  const st = lisBreaker.state();
  const open = Boolean(st.open);
  return {
    id: 'lis_breaker',
    ok: !open,
    latency_ms: 0,
    detail: open
      ? `OPEN failures=${st.consecutive_failures} suppressed=${st.suppressed_calls} cooldown_ms=${st.cooldown_remaining_ms}`
      : `CLOSED failures=${st.consecutive_failures} suppressed=${st.suppressed_calls}`,
    data: st,
  };
}

async function probeKbRemote() {
  const base = String(process.env.FLATTALK_KB_BASE_URL || '').replace(/\/+$/, '');
  if (!base) {
    return { id: 'kb_remote', ok: false, latency_ms: 0, detail: 'FLATTALK_KB_BASE_URL unset' };
  }
  const path = String(process.env.FLATTALK_KB_SEARCH_PATH || '/api/knowledge/query');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '养老补贴', limit: 1 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return {
      id: 'kb_remote',
      ok: res.ok,
      latency_ms: Date.now() - t0,
      detail: `HTTP ${res.status}`,
      data: { url },
    };
  } catch (e) {
    return {
      id: 'kb_remote',
      ok: false,
      latency_ms: Date.now() - t0,
      detail: e.message || String(e),
      data: { url },
    };
  }
}

async function probeTagPg() {
  const t0 = Date.now();
  try {
    const { getTagSystemBiz } = await import('../services/interface-data/tag-system-biz.js');
    const biz = getTagSystemBiz();
    if (typeof biz.ping === 'function') {
      const r = await biz.ping();
      return {
        id: 'tag_pg',
        ok: Boolean(r?.ok),
        latency_ms: Date.now() - t0,
        detail: r?.ok ? 'ping ok' : (r?.error || 'ping failed'),
        data: r,
      };
    }
    // fallback: list mobile items with tiny limit
    if (typeof biz.listMobileServiceItems === 'function') {
      const r = await biz.listMobileServiceItems({ limit: 1 });
      return {
        id: 'tag_pg',
        ok: Boolean(r?.ok),
        latency_ms: Date.now() - t0,
        detail: r?.ok ? `ok rows=${r?.catalog?.length ?? r?.rowCount ?? '?'}` : (r?.error || r?.source_status || 'failed'),
        data: { source: r?.source, source_status: r?.source_status },
      };
    }
    return { id: 'tag_pg', ok: false, latency_ms: Date.now() - t0, detail: 'no ping/list API' };
  } catch (e) {
    return { id: 'tag_pg', ok: false, latency_ms: Date.now() - t0, detail: e.message || String(e) };
  }
}

async function probeGxyOrder() {
  const t0 = Date.now();
  try {
    const { getOrderPage } = await import('../services/gxy-platform/order-service.js');
    const r = await getOrderPage({ pageNo: 1, pageSize: 1 });
    const ok = r?.code === 'OK' || r?.ok === true;
    return {
      id: 'gxy_order',
      ok,
      latency_ms: Date.now() - t0,
      detail: ok ? 'page OK' : `${r?.code || 'ERR'}: ${r?.message || r?.error || 'soft_err'}`,
      data: { code: r?.code, message: r?.message },
    };
  } catch (e) {
    return { id: 'gxy_order', ok: false, latency_ms: Date.now() - t0, detail: e.message || String(e) };
  }
}

function probeMapKeys() {
  const pairs = listWsKeyPairs();
  const status = typeof getWsKeyPoolStatus === 'function' ? getWsKeyPoolStatus() : null;
  const exhausted = (status?.pairs || pairs).filter((p) => p.exhausted).length;
  const allDead = pairs.length > 0 && exhausted >= pairs.length;
  return {
    id: 'map_keys',
    ok: pairs.length > 0 && !allDead,
    latency_ms: 0,
    detail: pairs.length
      ? `keys=${pairs.length} exhausted=${exhausted}${allDead ? ' POOL_EXHAUSTED' : ''}`
      : 'TENCENT_MAP_KEY unset',
    data: { key_count: pairs.length, exhausted, status },
  };
}

function probeEnvGates() {
  const snap = getDegradeSnapshot({ includeEvents: false });
  const g = snap.env_gates;
  const issues = [];
  if (g.JTD_API_MODE !== 'real') issues.push(`JTD_API_MODE=${g.JTD_API_MODE}`);
  if (!['production', 'prod'].includes(String(g.FLATTALK_RUNTIME_MODE))) {
    issues.push(`FLATTALK_RUNTIME_MODE=${g.FLATTALK_RUNTIME_MODE}`);
  }
  if (g.FLATTALK_ALLOW_SIM_FALLBACK === '1' && g.FLATTALK_DISABLE_SIM_FALLBACK !== '1') {
    issues.push('ALLOW_SIM_FALLBACK=1');
  }
  if (g.LIS_GATE_ENABLED === '0' || g.LIS_GATE_ENABLED === 'false') {
    issues.push('LIS_GATE off');
  }
  return {
    id: 'env_gates',
    ok: issues.length === 0,
    latency_ms: 0,
    detail: issues.length ? issues.join('; ') : 'production gates look aligned',
    data: g,
  };
}

function probeJtdMode() {
  const mode = String(process.env.JTD_API_MODE || 'real');
  const allowMock = process.env.FLATTALK_ALLOW_JTD_MOCK === '1';
  const ok = mode === 'real' || (mode === 'mock' && allowMock);
  return {
    id: 'jtd_mode',
    ok,
    latency_ms: 0,
    detail: `JTD_API_MODE=${mode} ALLOW_JTD_MOCK=${allowMock ? '1' : '0'}`,
    data: { mode, allow_mock: allowMock },
  };
}

const PROBES = {
  lis_health: probeLisHealth,
  lis_sort: probeLisSort,
  lis_breaker: probeLisBreaker,
  kb_remote: probeKbRemote,
  tag_pg: probeTagPg,
  gxy_order: probeGxyOrder,
  map_keys: probeMapKeys,
  env_gates: probeEnvGates,
  jtd_mode: probeJtdMode,
};

/**
 * @param {string} probeId
 */
export async function runDegradeProbe(probeId = 'all') {
  const id = String(probeId || 'all');
  if (id === 'all') {
    const results = [];
    for (const key of Object.keys(PROBES)) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await PROBES[key]());
    }
    const failed = results.filter((r) => !r.ok).length;
    return {
      ok: failed === 0,
      probe: 'all',
      failed,
      passed: results.length - failed,
      results,
      at: new Date().toISOString(),
    };
  }
  const fn = PROBES[id];
  if (!fn) {
    return { ok: false, probe: id, error: 'unknown_probe', probes: Object.keys(PROBES) };
  }
  const result = await fn();
  return { ok: result.ok, probe: id, results: [result], at: new Date().toISOString() };
}
