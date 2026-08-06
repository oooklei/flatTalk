// src/core/semantic/schema.js
export const SEMANTIC_SOURCES = {
  LLM: 'llm',
  RULES_FALLBACK: 'rules_fallback',
  SKIPPED_ACTION: 'skipped_action',
};

export function emptySlots() {
  return {
    place_candidates: [],
    scenic_candidates: [],
    concept_words: [],
    category_hint: null,
    entity_name: null,
    service_type: null,
    time: null,
  };
}

export function emptyAdapted() {
  return {
    destination: null,
    route_keyword: null,
    point_name: null,
    category: null,
    entity_name: null,
    service_type: null,
  };
}

export function emptySemantic(source = SEMANTIC_SOURCES.LLM) {
  return {
    core_need: '',
    slots: emptySlots(),
    adapted: emptyAdapted(),
    source: Object.values(SEMANTIC_SOURCES).includes(source) ? source : SEMANTIC_SOURCES.LLM,
    confidence: 0,
    latency_ms: 0,
  };
}

export function normalizeSemantic(raw = {}, sourceFallback = SEMANTIC_SOURCES.LLM) {
  const base = emptySemantic(sourceFallback);
  const slotsIn = raw.slots && typeof raw.slots === 'object' ? raw.slots : {};
  const adaptedIn = raw.adapted && typeof raw.adapted === 'object' ? raw.adapted : {};
  const source = Object.values(SEMANTIC_SOURCES).includes(raw.source) ? raw.source : sourceFallback;
  return {
    ...base,
    core_need: String(raw.core_need || '').trim(),
    slots: {
      ...base.slots,
      place_candidates: asStringArray(slotsIn.place_candidates),
      scenic_candidates: asStringArray(slotsIn.scenic_candidates),
      concept_words: asStringArray(slotsIn.concept_words),
      category_hint: slotsIn.category_hint == null ? null : String(slotsIn.category_hint),
      entity_name: slotsIn.entity_name == null ? null : String(slotsIn.entity_name),
      service_type: slotsIn.service_type == null ? null : String(slotsIn.service_type),
      time: slotsIn.time == null ? null : String(slotsIn.time),
    },
    adapted: { ...base.adapted, ...pickAdapted(adaptedIn) },
    source,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0,
    latency_ms: Number.isFinite(Number(raw.latency_ms)) ? Number(raw.latency_ms) : 0,
  };
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean);
}

function pickAdapted(a) {
  const out = {};
  for (const k of Object.keys(emptyAdapted())) {
    if (a[k] == null || a[k] === '') out[k] = null;
    else out[k] = String(a[k]);
  }
  return out;
}
