/**
 * LIS pure-SORT gate — feature-flagged pre-scene-router consumer.
 *
 * Env:
 *   LIS_GATE_ENABLED — set to '1' to enable (default off)
 *   LIS_BASE_URL     — LIS HTTP base (default http://127.0.0.1:8100)
 *   LIS_TIMEOUT_MS   — per-call timeout (default 2000, see lis-client.js)
 *   LIS_SORT_RETRIES — extra sort attempts after first failure (default 2)
 *
 * 主路径一律 POST /v1/sort；不再消费 ticket / boundary / action Skill Lock。
 * 失败：短重试 → reason=lis_unreachable → orchestrator common 兜底卡。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decideRoute } from './routing-gate.js';
import { projectDialogueView, projectBizHints } from './context-projector.js';
import { matchSupplyToCatalog } from './matcher.js';
import { lisBreaker } from './lis-breaker.js';

/** @type {const} */
export const LIS_GATE_ENABLED = 'LIS_GATE_ENABLED';
/** @type {const} */
export const LIS_BASE_URL = 'LIS_BASE_URL';
/** @type {const} */
export const LIS_SORT_RETRIES = 'LIS_SORT_RETRIES';

const DEFAULT_LIS_BASE_URL = 'http://127.0.0.1:8100';
const DEFAULT_SORT_RETRIES = 2;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../../..');
const DEFAULT_CATALOG_PATH = path.join(projectRoot, 'config', 'intent-catalog.json');

let _catalogCache = null;
/** 缓存对应的文件路径 + mtime + size，用于判断是否需要重读 */
let _catalogStamp = null;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isLisGateEnabled(env = process.env) {
  return String(env?.[LIS_GATE_ENABLED] ?? '') === '1';
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function getLisBaseUrl(env = process.env) {
  return String(env?.[LIS_BASE_URL] || DEFAULT_LIS_BASE_URL).replace(/\/$/, '');
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function getLisSortRetries(env = process.env) {
  const raw = Number(env?.[LIS_SORT_RETRIES]);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return DEFAULT_SORT_RETRIES;
}

/**
 * Load enabled catalog intent packages (sample file or in-memory fallback).
 *
 * 按 mtime+size 缓存：文件没变就复用解析结果，**保留热加载能力**
 * （改 JSON 立即生效，无需重启），但避免每个 chat 请求都同步读盘 + JSON.parse。
 *
 * @param {string} [catalogPath]
 * @returns {Array<object>}
 */
export function loadCatalogEntries(catalogPath = DEFAULT_CATALOG_PATH) {
  const target = catalogPath || DEFAULT_CATALOG_PATH;
  try {
    const { mtimeMs, size } = fs.statSync(target);
    const stamp = `${target}|${mtimeMs}|${size}`;
    if (_catalogStamp === stamp && _catalogCache) {
      return _catalogCache;
    }
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    const intents = Array.isArray(parsed?.intents) ? parsed.intents : [];
    _catalogCache = intents;
    _catalogStamp = stamp;
    return intents;
  } catch {
    // 读失败（文件缺失/JSON 损坏）沿用上次成功的结果，避免目录突然清空
    return _catalogCache || [];
  }
}

/**
 * Pure SORT gate before skill execution.
 *
 * @param {{
 *   request?: object,
 *   session?: object,
 *   catalogEntries?: Array<object>,
 *   lisClient?: { sort: Function, clarify?: Function },
 *   snapshot?: object|null,
 *   breaker?: { shouldSkip: Function, recordSuccess: Function, recordFailure: Function },
 * }} [input]
 * @returns {Promise<{
 *   handled: boolean,
 *   skill_key?: string,
 *   template_id?: string,
 *   intent?: object|null,
 *   supply?: object|null,
 *   mode?: string,
 *   reason?: string,
 *   need_clarify?: boolean,
 *   clarify?: object|null,
 *   ambiguity_options?: Array<object>,
 * }>}
 */
export async function tryLisGate({
  request = {},
  session = null,
  catalogEntries = null,
  lisClient = null,
  snapshot = null,
  breaker = lisBreaker,
} = {}) {
  if (!isLisGateEnabled()) {
    return { handled: false };
  }
  if (!lisClient || typeof lisClient.sort !== 'function') {
    return { handled: false, mode: 'SORT', reason: 'lis_client_missing' };
  }

  const sess = ensureSession(session, request);
  if (!sess.global_context || typeof sess.global_context !== 'object') {
    sess.global_context = {};
  }

  const reenter = Boolean(request.context?.reenter_chat);
  if (reenter) {
    sess.global_context.routing_ticket = null;
    sess.global_context.pending_clarify_supply = null;
  }

  const entries = Array.isArray(catalogEntries) && catalogEntries.length
    ? catalogEntries
    : loadCatalogEntries();
  const catalogIntentIds = entries
    .filter((pkg) => pkg && pkg.enabled !== false && pkg.intent_id)
    .map((pkg) => String(pkg.intent_id));

  // 澄清续轮：上一轮 NEED_CLARIFY 后点选 / 自由文本 → /v1/clarify resolve
  const pendingSupply = sess.global_context.pending_clarify_supply || null;
  const selectedIntentId = String(
    request.context?.lis_clarify_intent_id
    || request.context?.selected_intent_id
    || request.selected_intent_id
    || '',
  ).trim();
  if (pendingSupply && typeof lisClient.clarify === 'function' && !reenter) {
    if (breaker.shouldSkip()) {
      sess.global_context.pending_clarify_supply = null;
    } else {
      try {
        const clarified = await lisClient.clarify({
          mode: 'resolve',
          previous_supply: pendingSupply,
          user_reply: String(request.message || request.text || '').trim() || undefined,
          selected_intent_id: selectedIntentId || undefined,
          catalog_intent_ids: catalogIntentIds,
          session_id: request.conversation_id || request.session_id || '',
        });
        breaker.recordSuccess();
        return consumeClarifyResolve({ clarified, sess, entries });
      } catch (err) {
        breaker.recordFailure('clarify', err);
        sess.global_context.pending_clarify_supply = null;
        // fall through to normal sort
      }
    }
  }

  const utterance = String(request.message || request.text || '').trim();
  const dialogue = projectDialogueView(sess, { ticket: null });
  const biz_hints = projectBizHints({
    request,
    snapshot,
    catalogIntentIds,
    semantic: request.semantic || null,
  });

  const gate = decideRoute({ reenter_chat: reenter });

  console.info('[LIS-GATE]', {
    mode: gate.mode,
    reason: gate.reason,
    utterance: utterance.slice(0, 80),
    dialogue_turns: dialogue.turns.length,
    action_key: request.context?.action_key || null,
  });

  if (breaker.shouldSkip()) {
    return { handled: false, mode: 'SORT', reason: 'lis_unavailable' };
  }

  let supply = null;
  const maxAttempts = 1 + getLisSortRetries();
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1 && breaker.shouldSkip()) {
      return { handled: false, mode: 'SORT', reason: 'lis_unavailable' };
    }
    try {
      supply = await lisClient.sort({
        utterance,
        dialogue,
        biz_hints,
        catalog_intent_ids: catalogIntentIds,
        session_id: request.conversation_id || request.session_id || '',
      });
      breaker.recordSuccess();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      breaker.recordFailure('sort', err);
      console.warn('[LIS-GATE] sort failed', {
        attempt,
        maxAttempts,
        error: err?.message || String(err),
      });
    }
  }

  if (lastErr || !supply) {
    return { handled: false, mode: 'SORT', reason: 'lis_unreachable' };
  }

  // FT 主路径不再存取 routing_ticket
  sess.global_context.routing_ticket = null;

  const decisionStatus = String(supply?.decision?.status || '');
  if (decisionStatus === 'MATCH_OK') {
    sess.global_context.pending_clarify_supply = null;
    const hit = matchSupplyToCatalog(supply, entries);
    if (hit.ok && hit.entry) {
      // Persist last LIS-locked scene for next-turn BizHints soft bias
      sess.global_context.lis_locked_scene = hit.entry.skill_key || '';
      sess.global_context.lis_locked_intent = hit.intent?.intent_id || '';
      sess.global_context.lis_locked_template = hit.entry.template_id || '';
      return {
        handled: true,
        skill_key: hit.entry.skill_key,
        template_id: hit.entry.template_id,
        intent: hit.intent,
        intent_suggestions: hit.suggestions || [],
        supply,
        mode: 'SORT',
      };
    }
  }

  const clarifyOptions = Array.isArray(supply?.clarify?.options) ? supply.clarify.options : [];
  if (decisionStatus === 'NEED_CLARIFY' && supply?.clarify && clarifyOptions.length > 0) {
    sess.global_context.pending_clarify_supply = supply;
    return {
      handled: true,
      mode: 'CLARIFY',
      reason: 'need_clarify',
      need_clarify: true,
      clarify: supply.clarify,
      supply,
      ambiguity_options: mapClarifyToAmbiguityOptions(supply.clarify, entries),
    };
  }

  if (decisionStatus === 'NEED_CLARIFY') {
    sess.global_context.pending_clarify_supply = null;
  }

  if (decisionStatus === 'LLM_FALLBACK_HINT') {
    sess.global_context.pending_clarify_supply = null;
  }

  return { handled: false, mode: 'SORT', supply, reason: decisionStatus || 'unmatched' };
}

function consumeClarifyResolve({ clarified, sess, entries }) {
  sess.global_context.routing_ticket = null;
  const status = String(clarified?.decision?.status || '').toUpperCase();
  if (status === 'MATCH_OK' || status === 'CLARIFY_FOLLOWUP') {
    sess.global_context.pending_clarify_supply = null;
    const hit = matchSupplyToCatalog(clarified, entries);
    if (hit.ok && hit.entry) {
      sess.global_context.lis_locked_scene = hit.entry.skill_key || '';
      sess.global_context.lis_locked_intent = hit.intent?.intent_id || '';
      sess.global_context.lis_locked_template = hit.entry.template_id || '';
      return {
        handled: true,
        skill_key: hit.entry.skill_key,
        template_id: hit.entry.template_id,
        intent: hit.intent,
        supply: clarified,
        mode: 'CLARIFY',
        reason: 'clarify_resolve_ok',
      };
    }
  }
  if (status === 'LLM_FALLBACK_HINT' || status === 'NEED_CLARIFY') {
    sess.global_context.pending_clarify_supply = null;
    return { handled: false, mode: 'CLARIFY', reason: 'clarify_fallback', supply: clarified };
  }
  sess.global_context.pending_clarify_supply = null;
  return { handled: false, mode: 'CLARIFY', reason: 'clarify_unmatched', supply: clarified };
}

/** Map LIS clarify.options → mobile ambiguity_options (with lis_clarify_intent_id). */
export function mapClarifyToAmbiguityOptions(clarify, catalogEntries = []) {
  const opts = Array.isArray(clarify?.options) ? clarify.options : [];
  const byId = new Map(
    (Array.isArray(catalogEntries) ? catalogEntries : [])
      .filter((p) => p?.intent_id)
      .map((p) => [String(p.intent_id), p]),
  );
  return opts.map((opt) => {
    const intentId = String(opt?.intent_id || '');
    const pkg = byId.get(intentId);
    const skill = pkg?.entry?.skill_key || 'common';
    return {
      scene_key: skill,
      skill_key: skill,
      label: opt?.label || intentId,
      desc: intentId,
      icon: '🧭',
      intent_id: intentId,
      lis_clarify_intent_id: intentId,
      confidence: Number(opt?.confidence) || 0,
    };
  });
}

function ensureSession(session, request) {
  if (session && typeof session === 'object') {
    if (!session.conversation_id && request.conversation_id) {
      session.conversation_id = request.conversation_id;
    }
    if (!Array.isArray(session.turns)) session.turns = [];
    return session;
  }
  return {
    conversation_id: request.conversation_id || '',
    turns: [],
    global_context: {},
    active_agent: request.context?.active_agent || '',
  };
}
