import { adaptParams } from './adapter.js';
import { rulesFallback } from './fallback.js';
import { emptySemantic, normalizeSemantic, SEMANTIC_SOURCES } from './schema.js';
import { loadPrompt } from '../model-runtime/prompt-loader.js';
import { pickChatModel } from '../model-runtime/model-registry.js';
import { callOpenAiCompatibleModel } from '../model-runtime/openai-compatible-client.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.FLATTALK_SEMANTIC_TIMEOUT_MS || 1200);

export function shouldSkipEnrichment(request = {}) {
  if (request.action) return true;
  if (request.context?.action_key && request.context?.reenter_chat !== true) return true;
  if (request.context?.followup_source && request.context?.reenter_chat !== true) return true;
  const text = String(request.message || request.text || '').trim();
  if (!text) return true;
  return false;
}

function requestText(request = {}) {
  return String(request.message || request.text || '').trim();
}

function parseUnderstandJson(content) {
  if (!content) return null;
  try {
    const clean = String(content).replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildUnderstandPrompt(text) {
  return [
    { role: 'system', content: loadPrompt('semantic/understand.md') },
    { role: 'user', content: `用户消息: "${text}"` },
  ];
}

async function defaultLlmCall(messages, timeoutMs) {
  const model = pickChatModel({ purpose: '语义理解' });
  if (!model || !model.api_base) {
    return { ok: false, error: 'model_not_configured' };
  }
  return callOpenAiCompatibleModel(model, messages, {
    timeoutMs,
    maxTokens: 300,
    temperature: 0,
  });
}

function withLatency(semantic, latencyMs) {
  return { ...semantic, latency_ms: latencyMs };
}

export async function understandAndAdapt(request = {}, options = {}) {
  if (shouldSkipEnrichment(request)) {
    return emptySemantic(SEMANTIC_SOURCES.SKIPPED_ACTION);
  }

  const text = requestText(request);
  const t0 = Date.now();
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const llmCall = options.llmCall || ((messages) => defaultLlmCall(messages, timeoutMs));

  try {
    const result = await llmCall(buildUnderstandPrompt(text));
    const latencyMs = Date.now() - t0;

    if (!result || !result.ok) {
      return withLatency(rulesFallback(text), latencyMs);
    }

    const parsed = parseUnderstandJson(result.content);
    if (!parsed) {
      return withLatency(rulesFallback(text), latencyMs);
    }

    const slots = {
      place_candidates: parsed.place_candidates,
      scenic_candidates: parsed.scenic_candidates,
      concept_words: parsed.concept_words,
      category_hint: parsed.category_hint,
      entity_name: parsed.entity_name,
      service_type: parsed.service_type,
      time: parsed.time,
    };
    const adapted = adaptParams(slots);

    return normalizeSemantic({
      core_need: parsed.core_need || '',
      slots,
      adapted,
      source: SEMANTIC_SOURCES.LLM,
      confidence: 0.85,
      latency_ms: latencyMs,
    }, SEMANTIC_SOURCES.LLM);
  } catch {
    const latencyMs = Date.now() - t0;
    return withLatency(rulesFallback(text), latencyMs);
  }
}
