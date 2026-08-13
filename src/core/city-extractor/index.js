// src/core/city-extractor/index.js

import { normalizeCity, matchHotCity } from './normalize.js';
import { pickChatModel } from '../model-runtime/model-registry.js';
import { callOpenAiCompatibleModel } from '../model-runtime/openai-compatible-client.js';

const LLM_TIMEOUT_MS = 3000;

function historyTextOf(conversation_history = []) {
  if (!Array.isArray(conversation_history)) return '';
  return conversation_history
    .slice(-10)
    .map((h) => h.content || h.message || h.text || '')
    .filter(Boolean)
    .join(' | ');
}

function lockedDestination(business_data = {}, message = '') {
  const params = business_data?.action_params || {};
  const jtd = business_data?.jtd || {};
  const product = jtd.selected_product || {};
  const candidates = [
    business_data.primary_city,
    business_data.destination,
    business_data.city,
    params.city,
    params.destination,
    product.destination,
    product.city,
    jtd.route?.destination,
    Array.isArray(business_data.cities) ? business_data.cities[0] : '',
  ];
  for (const c of candidates) {
    const v = String(c || '').trim();
    if (v) return v.replace(/^广西/, '');
  }
  // 消息里能正则命中则直接用
  const hot = matchHotCity(String(message || ''));
  return hot[0] || '';
}

/**
 * 构建 LLM 提取 prompt
 */
function buildExtractionPrompt(message, jtdDestination, historyText) {
  return [
    {
      role: 'system',
      content: `你是一个城市提取助手。从用户的旅居咨询消息中提取涉及的城市。

## 规则
1. 提取所有提到的城市（包括景点/景区对应的所属城市）
2. 景点归一化：涠洲岛→北海，亚龙湾→三亚，阳朔→桂林
3. primary 为主要目的地（消息中首先强调的或产品数据中的目的地）
4. 如果没有明确城市，primary 为 null，cities 为空数组

## 输出（严格 JSON，不要 markdown 代码块）
{"primary": "城市名或null", "cities": ["城市A","城市B"], "confidence": 0.0-1.0}`,
    },
    {
      role: 'user',
      content: `用户消息: "${message || ''}"
业务数据中的目的地: "${jtdDestination || ''}"
对话历史: "${historyText || ''}"`,
    },
  ];
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseCityJson(content) {
  if (!content) return null;
  try {
    const clean = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed.cities)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 从上下文中提取城市
 */
export async function extractCities(ctx = {}, deps = {}) {
  const { message = '', business_data = {}, conversation_history = [] } = ctx;
  const llmCall = deps.llmCall || defaultLlmCall;

  const locked = lockedDestination(business_data, message);
  const historyText = historyTextOf(conversation_history);
  const allText = `${message} ${locked} ${historyText}`;

  // 0. 业务上下文已锁定目的地：直接返回（追问「测算预算」等无地名句子）
  if (locked) {
    const hotFromLock = matchHotCity(locked);
    const primary = hotFromLock[0] || normalizeCity(locked) || locked;
    const hotAll = matchHotCity(allText);
    const cities = Array.from(new Set([primary, ...hotAll].filter(Boolean)));
    return {
      primary,
      cities,
      source: 'business_context',
      confidence: 0.99,
    };
  }

  // 1. 正则预筛（消息 + 历史）
  const hotCities = matchHotCity(allText);
  if (hotCities.length > 0) {
    return {
      primary: hotCities[0],
      cities: hotCities,
      source: 'regex',
      confidence: 0.95,
    };
  }

  // 2. 无锁定城市、消息也无明显旅居地名：跳过 LLM 空跑（闲聊/追问误入 travel 时）
  const msg = String(message || '').trim();
  if (!locked && !matchHotCity(msg).length && msg.length <= 12 && !/旅|游|天气|目的地|路线|预订|预算/.test(msg)) {
    return { primary: null, cities: [], source: 'skipped_no_signal', confidence: 0 };
  }

  // 2. LLM 提取
  try {
    const result = await llmCall(buildExtractionPrompt(message, locked, historyText));
    if (!result || !result.ok) {
      return { primary: null, cities: [], source: 'none', confidence: 0 };
    }
    const parsed = parseCityJson(result.content);
    if (!parsed) {
      return { primary: null, cities: [], source: 'none', confidence: 0 };
    }

    const normalizedCities = (parsed.cities || [])
      .map(normalizeCity)
      .filter((c, i, arr) => c && arr.indexOf(c) === i);
    const primary = parsed.primary ? normalizeCity(parsed.primary) : null;

    return {
      primary,
      cities: normalizedCities,
      source: 'llm',
      confidence: parsed.confidence ?? 0.8,
    };
  } catch {
    return { primary: null, cities: [], source: 'none', confidence: 0 };
  }
}

async function defaultLlmCall(messages) {
  const model = pickChatModel({ purpose: '城市提取' });
  if (!model || !model.api_base) {
    return { ok: false, error: 'model_not_configured' };
  }
  return callOpenAiCompatibleModel(model, messages, {
    timeoutMs: LLM_TIMEOUT_MS,
    maxTokens: 200,
    temperature: 0,
  });
}
