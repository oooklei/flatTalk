// src/core/city-extractor/index.js

import { normalizeCity, matchHotCity } from './normalize.js';
import { pickChatModel } from '../model-runtime/model-registry.js';
import { callOpenAiCompatibleModel } from '../model-runtime/openai-compatible-client.js';

const LLM_TIMEOUT_MS = 3000;

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
    // 去除可能的 markdown 代码块标记
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
 * @param {object} ctx - 提取上下文
 * @param {string} ctx.message - 用户消息
 * @param {object} ctx.business_data - 业务数据（含 jtd 产品/路线）
 * @param {Array} ctx.conversation_history - 对话历史
 * @param {object} [deps] - 依赖注入（测试用）
 * @param {Function} [deps.llmCall] - 自定义 LLM 调用函数
 * @returns {Promise<{primary: string|null, cities: string[], source: string, confidence: number}>}
 */
export async function extractCities(ctx = {}, deps = {}) {
  const { message = '', business_data = {}, conversation_history = [] } = ctx;
  const llmCall = deps.llmCall || defaultLlmCall;

  // 合并所有文本用于正则匹配
  const jtdDest = business_data?.jtd?.selected_product?.destination
    || business_data?.jtd?.route?.destination
    || '';
  const allText = `${message} ${jtdDest}`;

  // 1. 正则预筛
  const hotCities = matchHotCity(allText);
  if (hotCities.length > 0) {
    return {
      primary: hotCities[0],
      cities: hotCities,
      source: 'regex',
      confidence: 0.95,
    };
  }

  // 2. LLM 提取
  const historyText = Array.isArray(conversation_history)
    ? conversation_history.slice(-3).map((h) => h.message || h.text || '').join(' | ')
    : '';

  try {
    const result = await llmCall(buildExtractionPrompt(message, jtdDest, historyText));
    if (!result || !result.ok) {
      // LLM 失败，降级
      return { primary: null, cities: [], source: 'none', confidence: 0 };
    }
    const parsed = parseCityJson(result.content);
    if (!parsed) {
      return { primary: null, cities: [], source: 'none', confidence: 0 };
    }

    // 归一化 + 去重
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

/**
 * 默认 LLM 调用（复用项目已有的 model-registry + openai-compatible-client）
 */
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
