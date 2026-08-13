/**
 * Report low-confidence meaningful utterances to LIS corpus for human labeling.
 * Fire-and-forget; never blocks the chat path.
 */

import fs from 'node:fs';
import { isWeakOrChitchatUtterance } from './utterance-guards.js';
import { getLisBaseUrl } from './lis-gate-hook.js';

function resolveAdminToken(opts = {}) {
  if (opts.adminToken) return String(opts.adminToken);
  if (process.env.LIS_ADMIN_TOKEN) return String(process.env.LIS_ADMIN_TOKEN);
  if (process.env.FLATTALK_LIS_ADMIN_TOKEN) return String(process.env.FLATTALK_LIS_ADMIN_TOKEN);
  const candidates = [
    process.env.LIS_ADMIN_TOKEN_FILE,
    '/app/data/lis-admin-token',
    '/app/config/lis-admin-token',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return v;
    } catch {
      /* optional */
    }
  }
  return '';
}

/**
 * @param {{
 *   utterance?: string,
 *   predicted_intent_id?: string|null,
 *   predicted_confidence?: number,
 *   decision_status?: string,
 *   trace_id?: string|null,
 *   reason?: string,
 * }} payload
 * @param {{ fetchImpl?: typeof fetch, baseUrl?: string, adminToken?: string }} [opts]
 */
export function reportLowConfidenceToCorpus(payload = {}, opts = {}) {
  const text = String(payload.utterance || '').trim();
  if (!text || isWeakOrChitchatUtterance(text)) return;

  const baseUrl = String(opts.baseUrl || getLisBaseUrl() || '').replace(/\/$/, '');
  if (!baseUrl) return;

  const body = {
    utterance: text.slice(0, 500),
    predicted_intent_id: payload.predicted_intent_id || null,
    predicted_confidence: Number(payload.predicted_confidence) || 0,
    decision_status: payload.decision_status
      || payload.reason
      || 'EXTERNAL_LOW_CONFIDENCE',
    scorer: 'flattalk',
    trace_id: payload.trace_id || null,
  };

  const headers = { 'Content-Type': 'application/json' };
  const token = resolveAdminToken(opts);
  if (token) headers['X-Admin-Token'] = token;

  const fetchImpl = opts.fetchImpl || fetch;
  // 旁路：不 await，超时忽略
  Promise.resolve(
    fetchImpl(`${baseUrl}/admin/corpus/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.LIS_CORPUS_INGEST_TIMEOUT_MS || 2000))
        : undefined,
    }),
  ).catch(() => { /* corpus ingest best-effort */ });
}
