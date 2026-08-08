/**
 * LIS Gatekeeper Ticket hook — feature-flagged pre-scene-router gate.
 *
 * Env:
 *   LIS_GATE_ENABLED — set to '1' to enable (default off)
 *   LIS_BASE_URL     — LIS HTTP base (default http://127.0.0.1:8100)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decideRoute } from './routing-gate.js';
import { projectDialogueView, projectBizHints } from './context-projector.js';
import { matchSupplyToCatalog } from './matcher.js';

/** @type {const} */
export const LIS_GATE_ENABLED = 'LIS_GATE_ENABLED';
/** @type {const} */
export const LIS_BASE_URL = 'LIS_BASE_URL';

const DEFAULT_LIS_BASE_URL = 'http://127.0.0.1:8100';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../../..');
const DEFAULT_CATALOG_PATH = path.join(projectRoot, 'docs', 'LIS-System', 'catalog.sample.json');

let _catalogCache = null;

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
 * Load enabled catalog intent packages (sample file or in-memory fallback).
 * @param {string} [catalogPath]
 * @returns {Array<object>}
 */
export function loadCatalogEntries(catalogPath = DEFAULT_CATALOG_PATH) {
  if (!catalogPath && _catalogCache) return _catalogCache;
  try {
    const raw = fs.readFileSync(catalogPath || DEFAULT_CATALOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const intents = Array.isArray(parsed?.intents) ? parsed.intents : [];
    _catalogCache = intents;
    return intents;
  } catch {
    return _catalogCache || [];
  }
}

/**
 * Gatekeeper Ticket flow before identifyScene.
 *
 * @param {{
 *   request?: object,
 *   session?: object,
 *   catalogEntries?: Array<object>,
 *   lisClient?: { sort: Function, boundary: Function },
 *   snapshot?: object|null,
 * }} [input]
 * @returns {Promise<{
 *   handled: boolean,
 *   skill_key?: string,
 *   template_id?: string,
 *   intent?: object|null,
 *   supply?: object|null,
 *   boundary?: object|null,
 *   mode?: string,
 * }>}
 */
export async function tryLisGate({
  request = {},
  session = null,
  catalogEntries = null,
  lisClient = null,
  snapshot = null,
} = {}) {
  if (!isLisGateEnabled()) {
    return { handled: false };
  }
  if (!lisClient || typeof lisClient.sort !== 'function' || typeof lisClient.boundary !== 'function') {
    return { handled: false };
  }

  const sess = ensureSession(session, request);
  if (!sess.global_context || typeof sess.global_context !== 'object') {
    sess.global_context = {};
  }

  const reenter = Boolean(request.context?.reenter_chat);
  if (reenter) {
    sess.global_context.routing_ticket = null;
  }

  const ticket = reenter ? null : (sess.global_context.routing_ticket || null);
  const utterance = String(request.message || request.text || '').trim();
  const skillKeyHint = String(request.skill_key || request.skillKey || '').trim();
  const entries = Array.isArray(catalogEntries) && catalogEntries.length
    ? catalogEntries
    : loadCatalogEntries();
  const catalogIntentIds = entries
    .filter((pkg) => pkg && pkg.enabled !== false && pkg.intent_id)
    .map((pkg) => String(pkg.intent_id));

  const dialogue = projectDialogueView(sess, { ticket });
  const biz_hints = projectBizHints({
    request,
    snapshot,
    catalogIntentIds,
    semantic: request.semantic || null,
  });

  const gate = decideRoute({
    ticket,
    context: request.context || {},
    skill_key: skillKeyHint,
    utterance,
    dialogueTurnCount: dialogue.turns.length,
    reenter_chat: reenter,
  });

  if (gate.mode === 'SKILL_LOCK') {
    const resolved = resolveSkillFromTicketOrRequest({
      request,
      ticket,
      catalogEntries: entries,
    });
    return {
      handled: Boolean(resolved.skill_key),
      skill_key: resolved.skill_key,
      template_id: resolved.template_id,
      intent: resolved.intent,
      mode: 'SKILL_LOCK',
    };
  }

  let needSort = gate.mode === 'SORT';
  let boundary = null;

  if (gate.mode === 'BOUNDARY') {
    try {
      boundary = await lisClient.boundary({
        utterance,
        routing_ticket: ticket,
        dialogue,
        biz_hints,
        catalog_intent_ids: catalogIntentIds,
      });
    } catch {
      return { handled: false, mode: 'BOUNDARY' };
    }

    const status = String(boundary?.status || '').toUpperCase();
    if (status === 'STAY') {
      if (boundary.routing_ticket) {
        sess.global_context.routing_ticket = boundary.routing_ticket;
      }
      const hit = matchSupplyToCatalog(
        {
          intents: boundary.intents || [],
          decision: {
            status: 'MATCH_OK',
            max_confidence: maxConfidence(boundary.intents),
          },
        },
        entries,
      );
      if (hit.ok && hit.entry) {
        return {
          handled: true,
          skill_key: hit.entry.skill_key,
          template_id: hit.entry.template_id,
          intent: hit.intent,
          supply: boundary,
          boundary,
          mode: 'BOUNDARY',
        };
      }
      return { handled: false, mode: 'BOUNDARY', boundary };
    }

    if (status === 'ESCAPE') {
      sess.global_context.routing_ticket = null;
      needSort = true;
    } else {
      // LLM_FALLBACK or unknown → clear ticket, fall through to scene-router
      sess.global_context.routing_ticket = null;
      return { handled: false, mode: 'BOUNDARY', boundary };
    }
  }

  if (!needSort) {
    return { handled: false, mode: gate.mode };
  }

  let supply = null;
  try {
    supply = await lisClient.sort({
      utterance,
      dialogue,
      biz_hints,
      catalog_intent_ids: catalogIntentIds,
      session_id: request.conversation_id || request.session_id || '',
    });
  } catch {
    return { handled: false, mode: 'SORT' };
  }

  const decisionStatus = String(supply?.decision?.status || '');
  if (decisionStatus === 'MATCH_OK') {
    if (supply.routing_ticket) {
      sess.global_context.routing_ticket = supply.routing_ticket;
    }
    const hit = matchSupplyToCatalog(supply, entries);
    if (hit.ok && hit.entry) {
      return {
        handled: true,
        skill_key: hit.entry.skill_key,
        template_id: hit.entry.template_id,
        intent: hit.intent,
        supply,
        mode: 'SORT',
      };
    }
  }

  if (decisionStatus === 'LLM_FALLBACK_HINT') {
    sess.global_context.routing_ticket = null;
  }

  return { handled: false, mode: 'SORT', supply, boundary };
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

function resolveSkillFromTicketOrRequest({ request, ticket, catalogEntries }) {
  const skill_key = String(
    request.skill_key || request.skillKey || ticket?.domain || '',
  ).trim();
  let template_id = String(request.template_id || request.templateId || '').trim();
  let intent = ticket?.primary_intent_id
    ? { intent_id: ticket.primary_intent_id }
    : null;

  if (!template_id && ticket?.primary_intent_id) {
    const pkg = (catalogEntries || []).find(
      (e) => e && e.enabled !== false && String(e.intent_id) === String(ticket.primary_intent_id),
    );
    if (pkg?.entry?.template_id) template_id = pkg.entry.template_id;
    if (!skill_key && pkg?.entry?.skill_key) {
      return {
        skill_key: pkg.entry.skill_key,
        template_id: pkg.entry.template_id || template_id,
        intent: intent || { intent_id: pkg.intent_id },
      };
    }
  }

  return { skill_key, template_id, intent };
}

function maxConfidence(intents) {
  let max = 0;
  for (const intent of Array.isArray(intents) ? intents : []) {
    const c = Number(intent?.confidence);
    if (Number.isFinite(c) && c > max) max = c;
  }
  return max;
}
