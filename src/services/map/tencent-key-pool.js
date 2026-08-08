/**
 * 腾讯地图 WebService Key 池（主备轮换）
 *
 * 环境变量：
 *   TENCENT_MAP_KEY / TENCENT_MAP_SK           — 主 Key
 *   TENCENT_MAP_KEY_2 / TENCENT_MAP_SK_2       — 备用 Key（可选）
 *
 * 行为：
 * - 主 Key 因日配额（status 120/121）失败时，自动切备用 Key
 * - 被标记耗尽的 Key 在当日剩余时间内跳过（进程内记忆）
 * - 与 TENCENT_MAP_JS_KEY（前端 JS API）无关，禁止混用
 */
import crypto from 'node:crypto';

/** @typedef {{ id: string, key: string, sk: string }} WsKeyPair */

const QUOTA_STATUSES = new Set([120, 121]);

/** @type {Map<string, number>} keyId -> exhaustedUntilMs */
const exhaustedUntil = new Map();

function nowMs() {
  return Date.now();
}

/** 默认耗尽到本地次日 00:05（腾讯日配额按日重置） */
export function defaultQuotaCooldownMs(from = new Date()) {
  const next = new Date(from);
  next.setHours(24, 5, 0, 0);
  return Math.max(60_000, next.getTime() - from.getTime());
}

/**
 * @returns {WsKeyPair[]}
 */
export function listWsKeyPairs() {
  /** @type {WsKeyPair[]} */
  const pairs = [];
  const k1 = String(process.env.TENCENT_MAP_KEY || '').trim();
  const s1 = String(process.env.TENCENT_MAP_SK || '').trim();
  if (k1) pairs.push({ id: 'primary', key: k1, sk: s1 });

  const k2 = String(process.env.TENCENT_MAP_KEY_2 || '').trim();
  const s2 = String(process.env.TENCENT_MAP_SK_2 || '').trim();
  if (k2 && k2 !== k1) pairs.push({ id: 'secondary', key: k2, sk: s2 });

  return pairs;
}

export function isWsQuotaStatus(status) {
  return QUOTA_STATUSES.has(Number(status));
}

export function markWsKeyExhausted(pairOrId, { reason = 'quota', ttlMs } = {}) {
  const id = typeof pairOrId === 'string' ? pairOrId : pairOrId?.id;
  if (!id) return;
  const ttl = Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : defaultQuotaCooldownMs();
  exhaustedUntil.set(id, nowMs() + ttl);
  try {
    console.warn(`[tencent-key-pool] mark exhausted id=${id} reason=${reason} ttlMs=${ttl}`);
  } catch {
    /* ignore */
  }
}

export function clearWsKeyExhaustion(pairOrId) {
  const id = typeof pairOrId === 'string' ? pairOrId : pairOrId?.id;
  if (!id) return;
  exhaustedUntil.delete(id);
}

function isExhausted(id) {
  const until = exhaustedUntil.get(id);
  if (!until) return false;
  if (until <= nowMs()) {
    exhaustedUntil.delete(id);
    return false;
  }
  return true;
}

/**
 * 按可用性排序：未耗尽优先；同优先级保持 primary → secondary
 * @returns {WsKeyPair[]}
 */
export function getOrderedWsKeyPairs() {
  const pairs = listWsKeyPairs();
  const available = pairs.filter((p) => !isExhausted(p.id));
  if (available.length) return available;
  // 全部标记耗尽时仍按原序尝试（配额可能已重置）
  return pairs;
}

/** 当前首选可用 Key（无则 null） */
export function getActiveWsPair() {
  return getOrderedWsKeyPairs()[0] || null;
}

export function getWsKeyPoolStatus() {
  return {
    pairs: listWsKeyPairs().map((p) => ({
      id: p.id,
      keyPrefix: p.key.slice(0, 6),
      keyLen: p.key.length,
      hasSk: Boolean(p.sk),
      exhausted: isExhausted(p.id),
      exhaustedUntil: exhaustedUntil.get(p.id) || null,
    })),
    activeId: getActiveWsPair()?.id || null,
  };
}

/**
 * 腾讯 WS 签名：path?sortedParams + SK → md5
 * @param {string} wsPath 如 /ws/staticmap/v2 或 /ws/geocoder/v1/
 * @param {Record<string, string|number>} params 不含 sig
 * @param {WsKeyPair} pair
 */
export function signWsRequest(wsPath, params, pair) {
  if (!pair?.sk) return '';
  const signParams = { ...params, key: pair.key };
  delete signParams.sig;
  const sortedQuery = Object.keys(signParams)
    .sort()
    .map((k) => `${k}=${signParams[k]}`)
    .join('&');
  const raw = `${wsPath}?${sortedQuery}${pair.sk}`;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
}

/**
 * 对多个 Key 依次执行；fn 返回 { failover?: boolean, quota?: boolean, ... }
 * 若 failover/quota 为真则标记耗尽并试下一个。
 *
 * @template T
 * @param {(pair: WsKeyPair, index: number) => Promise<T & { failover?: boolean, quota?: boolean, status?: number }>} fn
 * @returns {Promise<T>}
 */
export async function withWsKeyFailover(fn) {
  const pairs = getOrderedWsKeyPairs();
  if (!pairs.length) {
    const err = new Error('no_TENCENT_MAP_KEY');
    err.code = 'no_TENCENT_MAP_KEY';
    throw err;
  }

  let lastResult = null;
  let lastError = null;
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    try {
      const result = await fn(pair, i);
      lastResult = result;
      const status = result?.status;
      const needFailover = Boolean(
        result?.failover
        || result?.quota
        || isWsQuotaStatus(status),
      );
      if (needFailover && i < pairs.length - 1) {
        markWsKeyExhausted(pair, {
          reason: result?.reason || `status_${status || 'failover'}`,
        });
        continue;
      }
      return result;
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e);
      const quotaLike = /status\s*=\s*12[01]|每日调用量|quota/i.test(msg);
      if (quotaLike && i < pairs.length - 1) {
        markWsKeyExhausted(pair, { reason: msg.slice(0, 80) });
        continue;
      }
      throw e;
    }
  }
  if (lastResult) return lastResult;
  throw lastError || new Error('tencent_key_pool_exhausted');
}

/** 测试用：清空耗尽状态 */
export function _resetWsKeyPoolForTests() {
  exhaustedUntil.clear();
}

export default {
  listWsKeyPairs,
  getOrderedWsKeyPairs,
  getActiveWsPair,
  getWsKeyPoolStatus,
  isWsQuotaStatus,
  markWsKeyExhausted,
  clearWsKeyExhaustion,
  signWsRequest,
  withWsKeyFailover,
  defaultQuotaCooldownMs,
  _resetWsKeyPoolForTests,
};
