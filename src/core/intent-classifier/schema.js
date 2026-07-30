export const INTENT_TYPES = Object.freeze({
  SERVICE: 'SERVICE',
  SOS: 'SOS',
  HEALTH: 'HEALTH',
  CHAT: 'CHAT',
  AMBIGUOUS: 'AMBIGUOUS',
  ERROR: 'ERROR',
});

export const URGENCY_LEVELS = Object.freeze({
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
});

export function normalizeIntentContext(value = {}) {
  return {
    intent_type: validIntentType(value.intent_type) ? value.intent_type : INTENT_TYPES.CHAT,
    confidence: clampScore(value.confidence),
    model_used: value.model_used || 'rules',
    model_path: Array.isArray(value.model_path) ? value.model_path : value.model_used ? [value.model_used] : ['rules'],
    entities: {
      service_type: value.entities?.service_type || null,
      time: value.entities?.time || null,
      location: value.entities?.location || null,
      symptom: value.entities?.symptom || null,
      medication: value.entities?.medication || null,
    },
    urgency_level: validUrgencyLevel(value.urgency_level) ? value.urgency_level : URGENCY_LEVELS.P2,
    urgency_reason: value.urgency_reason || '',
    keyword_match: Array.isArray(value.keyword_match) ? value.keyword_match : [],
    keyword_match_detail: value.keyword_match_detail || null,
    tone_analysis: {
      speed: value.tone_analysis?.speed ?? null,
      volume: value.tone_analysis?.volume ?? null,
      duration: value.tone_analysis?.duration ?? null,
      urgency_score: clampScore(value.tone_analysis?.urgency_score),
      tone_features: Array.isArray(value.tone_analysis?.tone_features) ? value.tone_analysis.tone_features : [],
      urgent_words: Array.isArray(value.tone_analysis?.urgent_words) ? value.tone_analysis.urgent_words : [],
    },
    classification_path: value.classification_path || 'normal',
    warning_level: value.warning_level || warningLevelFor(value.intent_type, value.urgency_level),
    needs_clarification: value.needs_clarification === true,
    processing_time: Number.isFinite(Number(value.processing_time)) ? Number(value.processing_time) : undefined,
    error: value.error || undefined,
  };
}

export function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function validIntentType(value) {
  return Object.values(INTENT_TYPES).includes(value);
}

function validUrgencyLevel(value) {
  return Object.values(URGENCY_LEVELS).includes(value);
}

function warningLevelFor(intentType, urgencyLevel) {
  if (intentType === INTENT_TYPES.SOS || urgencyLevel === URGENCY_LEVELS.P0) return 'red';
  if (intentType === INTENT_TYPES.HEALTH || urgencyLevel === URGENCY_LEVELS.P1) return 'yellow';
  return 'green';
}
