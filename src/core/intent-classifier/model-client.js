import { normalizeIntentContext } from './schema.js';

export function createIntentModelClient(options = {}) {
  const endpoints = {
    bertIntentUrl: options.bertIntentUrl || process.env.FLATTALK_BERT_INTENT_URL || '',
    textCnnIntentUrl: options.textCnnIntentUrl || process.env.FLATTALK_TEXTCNN_INTENT_URL || '',
    bertCrfExtractUrl: options.bertCrfExtractUrl || process.env.FLATTALK_BERT_CRF_EXTRACT_URL || '',
    toneAnalysisUrl: options.toneAnalysisUrl || process.env.FLATTALK_TONE_ANALYSIS_URL || '',
  };
  const apiKey = options.apiKey || process.env.FLATTALK_INTENT_MODEL_API_KEY || process.env.FLATTALK_MODEL_API_KEY || '';
  const timeoutMs = Number(options.timeoutMs || process.env.FLATTALK_INTENT_MODEL_TIMEOUT_MS || 5000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  return {
    isConfigured() {
      return Boolean(endpoints.bertIntentUrl || endpoints.textCnnIntentUrl || endpoints.bertCrfExtractUrl || endpoints.toneAnalysisUrl);
    },

    async classifyWithBert(input) {
      if (!endpoints.bertIntentUrl) return null;
      const result = await postJson(fetchImpl, endpoints.bertIntentUrl, {
        text: input.text,
        context: input.elder_history || input.elderHistory || {},
      }, { apiKey, timeoutMs });
      return normalizeIntentContext({ ...result, model_used: result.model_used || 'BERT-base' });
    },

    async classifyWithTextCnn(input) {
      if (!endpoints.textCnnIntentUrl) return null;
      const result = await postJson(fetchImpl, endpoints.textCnnIntentUrl, {
        text: input.text,
      }, { apiKey, timeoutMs: Math.min(timeoutMs, Number(process.env.FLATTALK_TEXTCNN_TIMEOUT_MS || 500)) });
      return normalizeIntentContext({ ...result, model_used: result.model_used || 'TextCNN' });
    },

    async extractEntities(input) {
      if (!endpoints.bertCrfExtractUrl) return null;
      const result = await postJson(fetchImpl, endpoints.bertCrfExtractUrl, {
        text: input.text,
        entity_types: ['service_type', 'time', 'location', 'symptom', 'medication'],
      }, { apiKey, timeoutMs: Math.min(timeoutMs, Number(process.env.FLATTALK_BERT_CRF_TIMEOUT_MS || 500)) });
      return normalizeExtractedEntities(result);
    },

    async analyzeTone(input) {
      if (!endpoints.toneAnalysisUrl) return null;
      return postJson(fetchImpl, endpoints.toneAnalysisUrl, {
        text: input.text,
        voice_features: input.asr_context || input.asrContext || {},
      }, { apiKey, timeoutMs: Math.min(timeoutMs, Number(process.env.FLATTALK_TONE_TIMEOUT_MS || 300)) });
    },
  };
}

async function postJson(fetchImpl, url, body, { apiKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `model_http_${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeExtractedEntities(result = {}) {
  if (!Array.isArray(result.entities)) return result.entities || null;
  const entities = {
    service_type: null,
    time: null,
    location: null,
    symptom: null,
    medication: null,
  };
  for (const entity of result.entities) {
    if (Number(entity.confidence ?? 1) < 0.7) continue;
    if (Object.hasOwn(entities, entity.type)) {
      entities[entity.type] = entity.normalized || entity.text || null;
    }
  }
  return entities;
}
