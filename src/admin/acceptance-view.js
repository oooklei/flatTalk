/**
 * 从 chat envelope / stages 抽出「验收视图」字段，供 Admin 验收对话页使用。
 */
export function buildAcceptanceView(envelope = {}) {
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const route = envelope.route || {};
  const debug = envelope.debug || {};
  const stages = Array.isArray(envelope.stages) ? envelope.stages : [];

  const dataSpans = [];
  for (const s of stages) {
    const stage = String(s.stage || '');
    if (!stage.startsWith('data.')) continue;
    const d = parseDetail(s.detail);
    dataSpans.push({
      stage,
      label: s.label,
      ms: s.ms,
      kind: d.kind || stage.replace(/^data\./, ''),
      name: d.name || s.label,
      status: d.status || 'ok',
      method: d.method,
      url: d.url,
      sql: d.sql,
      tables: d.tables,
      row_count: d.row_count,
      source: d.source,
      failure_reason: d.failure_reason || d.error,
      elapsed_ms: d.elapsed_ms,
    });
  }
  if (!dataSpans.length) {
    const bd = stages.find((s) => s.stage === 'business_data');
    const bdDetail = parseDetail(bd?.detail);
    for (const d of (bdDetail?.access?.spans || [])) {
      dataSpans.push({
        stage: `data.${d.kind}`,
        label: d.name,
        kind: d.kind,
        name: d.name,
        status: d.status || 'ok',
        method: d.method,
        url: d.url,
        sql: d.sql,
        tables: d.tables,
        row_count: d.row_count,
        source: d.source,
        failure_reason: d.failure_reason || d.error,
        elapsed_ms: d.elapsed_ms,
      });
    }
  }

  const emptyReasons = [];
  const degradeNotes = [];
  const collectNotes = (obj, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.degradeNote === 'string' && obj.degradeNote) {
      degradeNotes.push({ path, note: obj.degradeNote });
    }
    if (typeof obj.degrade_note === 'string' && obj.degrade_note) {
      degradeNotes.push({ path, note: obj.degrade_note });
    }
    if (Array.isArray(obj.warnings)) {
      for (const w of obj.warnings) {
        if (w) emptyReasons.push({ path, reason: String(w), kind: 'warning' });
      }
    }
    if (obj.skipped === true) {
      emptyReasons.push({
        path,
        reason: obj.skip_reason || obj.source_status || 'skipped',
        kind: 'skipped',
      });
    }
    if (obj.source_status && ['unavailable', 'empty', 'error', 'pg_error', 'unconfigured', 'stale_cache'].includes(String(obj.source_status))) {
      emptyReasons.push({ path, reason: String(obj.source_status), kind: 'source_status' });
    }
    if (obj.ok === false && (obj.error || obj.source_status)) {
      emptyReasons.push({
        path,
        reason: String(obj.error || obj.source_status),
        kind: 'error',
      });
    }
    // shallow walk common nests
    for (const key of ['jtd', 'orders_meta', 'quality', 'weather', 'nearby', 'remote_health', 'orders']) {
      if (obj[key] && typeof obj[key] === 'object') collectNotes(obj[key], path ? `${path}.${key}` : key);
    }
  };
  collectNotes(data);

  if (Array.isArray(data.products) && data.products.length === 0) {
    emptyReasons.push({ path: 'products', reason: 'empty_products', kind: 'empty' });
  }
  if (Array.isArray(data.orders) && data.orders.length === 0) {
    emptyReasons.push({ path: 'orders', reason: 'empty_orders', kind: 'empty' });
  }

  const answer = String(envelope.answer_text || envelope.answer || '').trim();
  const trustFlags = {
    has_simulated: JSON.stringify(data).includes('simulated_fallback')
      || JSON.stringify(data).includes('mock_vendor_data'),
    has_data_error: dataSpans.some((s) => s.status === 'error' || s.failure_reason),
    has_empty: emptyReasons.some((e) => e.kind === 'empty' || e.kind === 'skipped'),
    render_error: route.render_status === 'error' || debug.render_status === 'error',
  };

  return {
    conversation_id: envelope.conversation_id || '',
    turn_id: envelope.turn_id || '',
    request_id: envelope.request_id || '',
    skill_key: envelope.skill_key || route.scene_key || '',
    template_id: envelope.template_id || '',
    answer_preview: answer.slice(0, 400),
    route: {
      scene_key: route.scene_key,
      decision: route.decision,
      confidence: route.confidence,
      routed: route.routed,
      template_reason: route.template_reason,
      knowledge_status: route.knowledge_status,
      knowledge_source: route.knowledge_source,
      model_used: route.model_used || debug.model_used,
      model_status: debug.model_status,
      model_error: route.model_error || debug.model_error,
      render_status: route.render_status || debug.render_status,
    },
    data_spans: dataSpans,
    empty_reasons: dedupeReasons(emptyReasons),
    degrade_notes: dedupeNotes(degradeNotes),
    trust_flags: trustFlags,
    stage_count: stages.length,
  };
}

function parseDetail(detail) {
  if (detail == null || detail === '') return {};
  if (typeof detail === 'object') return detail;
  if (typeof detail === 'string') {
    try {
      const parsed = JSON.parse(detail);
      return parsed && typeof parsed === 'object' ? parsed : { raw: detail };
    } catch {
      return { raw: detail };
    }
  }
  return {};
}

function dedupeReasons(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = `${item.path}|${item.reason}|${item.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function dedupeNotes(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = `${item.path}|${item.note}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
