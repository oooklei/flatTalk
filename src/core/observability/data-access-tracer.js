/**
 * Runtime tracer for DB / tag-system / third-party HTTP access.
 * Emits orchestrator stages so session history is no longer a knowledge-only black box.
 */

import { resolveEndpoint } from './data-access-endpoints.js';

/**
 * @param {(stage: string, label: string, detail?: object|string) => void} mark
 */
export function createDataAccessTracer(mark) {
  const spans = [];

  /**
   * @param {{
   *   kind: 'db'|'tag_system'|'http'|'internal',
   *   name: string,
   *   label?: string,
   *   meta?: object,
   *   run: () => Promise<any>|any,
   * }} opts
   */
  async function span(opts) {
    const kind = opts.kind || 'internal';
    const name = String(opts.name || 'unnamed');
    const label = opts.label || describeLabel(kind, name);
    const started = Date.now();
    let status = 'ok';
    let error = null;
    let result;
    let meta = { ...(opts.meta || {}) };
    try {
      result = await opts.run();
      enrichFromResult(meta, result);
      if (result && typeof result === 'object') {
        if (result.skipped) {
          status = 'skipped';
          if (result.skip_reason) meta.skip_reason = result.skip_reason;
        } else if (result.source_status === 'unavailable' || result.source === 'unavailable') {
          status = 'unavailable';
        } else if (result.ok === false || result.source === 'error') {
          status = 'error';
          error = result.error || result.message || 'failed';
        }
      }
    } catch (err) {
      status = 'error';
      error = err?.message || String(err);
      result = null;
    }

    // Catalog fills gaps only — runtime method/url/sql always win when present.
    const endpoint = resolveEndpoint(name, meta);
    for (const [k, v] of Object.entries(pickDefined(endpoint))) {
      if (meta[k] == null) meta[k] = v;
    }
    // Local / simulated fallbacks must not inherit catalog SQL hints.
    if (meta.method === 'LOCAL' || String(meta.source || '').startsWith('simulated') || meta.source === 'local' || meta.source === 'local_empty') {
      if (!meta._sql_from_runtime) meta.sql = undefined;
    }

    const failure_reason = firstNonEmpty(
      error,
      meta.degrade_note,
      Array.isArray(meta.warnings) ? meta.warnings[0] : null,
      status === 'unavailable' ? 'source_unavailable' : null,
      status === 'skipped' ? (meta.skip_reason || 'skipped') : null,
    );

    const elapsed = Date.now() - started;
    const detail = {
      kind,
      name,
      status,
      elapsed_ms: elapsed,
      error: error || undefined,
      failure_reason: failure_reason || undefined,
      method: meta.method || undefined,
      url: meta.url || undefined,
      sql: meta.sql || undefined,
      tables: meta.tables || undefined,
      store: meta.store || undefined,
      row_count: meta.row_count,
      source: meta.source || meta.source_status || undefined,
      provider: meta.provider || undefined,
      skill: meta.skill || undefined,
      http_status: meta.http_status || undefined,
      integration: meta.integration || undefined,
      // keep extra opaque keys for debugging (exclude bulky blobs)
      ...omitHeavy(meta),
    };

    spans.push(detail);
    if (typeof mark === 'function') {
      mark(`data.${kind}`, label, detail);
    }
    return result;
  }

  function summary() {
    const byKind = {};
    for (const s of spans) {
      byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    }
    return {
      span_count: spans.length,
      by_kind: byKind,
      spans: spans.map((s) => ({
        kind: s.kind,
        name: s.name,
        status: s.status,
        elapsed_ms: s.elapsed_ms,
        method: s.method,
        url: s.url,
        sql: s.sql,
        tables: s.tables,
        store: s.store,
        row_count: s.row_count,
        error: s.error,
        failure_reason: s.failure_reason,
        source: s.source,
        http_status: s.http_status,
        provider: s.provider,
        integration: s.integration,
      })),
      ok: spans.every((s) => s.status === 'ok' || s.status === 'skipped' || s.status === 'unavailable'),
      has_error: spans.some((s) => s.status === 'error'),
    };
  }

  return { span, summary, spans };
}

function describeLabel(kind, name) {
  if (kind === 'db') return `数据表 ${name}`;
  if (kind === 'tag_system') return `tag-system ${name}`;
  if (kind === 'http') return `第三方 ${name}`;
  return name;
}

function enrichFromResult(meta, result) {
  if (result == null) return;
  if (Array.isArray(result)) {
    meta.row_count = result.length;
    return;
  }
  if (typeof result !== 'object') return;

  if (typeof result.rowCount === 'number') meta.row_count = result.rowCount;
  else if (typeof result.row_count === 'number') meta.row_count = result.row_count;
  else if (Array.isArray(result.rows)) meta.row_count = result.rows.length;
  else if (Array.isArray(result.routes)) meta.row_count = result.routes.length;
  else if (Array.isArray(result.products)) meta.row_count = result.products.length;
  else if (Array.isArray(result.orders)) meta.row_count = result.orders.length;
  else if (Array.isArray(result.facilities)) meta.row_count = result.facilities.length;
  else if (Array.isArray(result.samples)) meta.row_count = result.samples.length;
  else if (Array.isArray(result.metrics)) meta.row_count = result.metrics.length;
  else if (Array.isArray(result.business_scenes)) meta.row_count = result.business_scenes.length;
  else if (Array.isArray(result.meal_rules) || Array.isArray(result.diet_contraindications)) {
    meta.row_count = (Array.isArray(result.meal_rules) ? result.meal_rules.length : 0)
      + (Array.isArray(result.diet_contraindications) ? result.diet_contraindications.length : 0)
      + (result.elder_profile ? 1 : 0);
  }
  else if (Array.isArray(result.data)) meta.row_count = result.data.length;
  else if (result.data && typeof result.data === 'object') {
    if (Array.isArray(result.data.list)) meta.row_count = result.data.list.length;
    else if (Array.isArray(result.data.records)) meta.row_count = result.data.records.length;
    else if (Array.isArray(result.data.items)) meta.row_count = result.data.items.length;
    else if (typeof result.data.total === 'number') meta.row_count = result.data.total;
  }

  if (result.source) meta.source = result.source;
  if (result.source_status) meta.source_status = result.source_status;
  if (result.provider) meta.provider = result.provider;
  if (result.degradeNote) meta.degrade_note = result.degradeNote;
  if (Array.isArray(result.warnings) && result.warnings.length) meta.warnings = result.warnings;
  if (result.http_status != null) meta.http_status = result.http_status;
  else if (result.status != null && typeof result.status === 'number') meta.http_status = result.status;
  if (result.url) meta.url = result.url;
  if (result.method) meta.method = result.method;
  if ('sql' in result) {
    meta.sql = result.sql ? String(result.sql).slice(0, 240) : undefined;
    meta._sql_from_runtime = true;
  }
  if (result.error && !meta.error) meta.error = result.error;
  if (result.skip_reason) meta.skip_reason = result.skip_reason;
}

function omitHeavy(meta) {
  const out = {};
  const skip = new Set([
    'method', 'url', 'sql', 'tables', 'store', 'row_count', 'source', 'source_status',
    'provider', 'skill', 'http_status', 'integration', 'degrade_note', 'warnings',
    'endpoint_key', 'skip_reason', 'via', 'elderId', 'orderId', 'city',
  ]);
  for (const [k, v] of Object.entries(meta)) {
    if (skip.has(k)) continue;
    if (v == null) continue;
    if (typeof v === 'object') continue;
    out[k] = v;
  }
  // keep a few useful filter dims
  if (meta.via) out.via = meta.via;
  if (meta.elderId) out.elderId = meta.elderId;
  if (meta.orderId) out.orderId = meta.orderId;
  if (meta.city) out.city = meta.city;
  return out;
}

function pickDefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return null;
}
