import { resolveModelApiKey } from './model-registry.js';
import { isVolcengineAkSkMode, signVolcengineRequest } from './volcengine-signer.js';

/** 判断是否为 Anthropic Messages API 兼容 provider（Claude 等） */
function isAnthropicProvider(model = {}) {
  const p = String(model.provider || '').toLowerCase();
  return p === 'anthropic';
}

/**
 * Anthropic Messages API 适配器（LongCat / Claude 兼容代理）。
 * 返回格式与 callOpenAiCompatibleModel 一致，零侵入调用方。
 */
async function callAnthropicMessagesModel(model, messages, options = {}) {
  const apiKey = resolveModelApiKey(model);
  const missing = [];
  if (!model?.api_base) missing.push('api_base');
  if (!model?.model_id) missing.push('model_id');
  if (!apiKey) missing.push('api_key');
  if (missing.length) {
    return { ok: false, status: 'config_error', error: `模型配置不完整：${missing.join('、')}` };
  }

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || process.env.FLATTALK_MODEL_TIMEOUT_MS || 45000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `${String(model.api_base).replace(/\/$/, '')}/v1/messages`;
    // Anthropic system 是顶层参数，从 messages 里分离
    const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const chatMessages = messages.filter((m) => m.role !== 'system');
    const reqBody = {
      model: model.model_id,
      max_tokens: Number(options.maxTokens || model.max_tokens || 4000),
      messages: chatMessages,
    };
    if (systemText) reqBody.system = systemText;
    if (options.temperature != null || model.temperature != null) {
      reqBody.temperature = Number(options.temperature ?? model.temperature ?? 0.3);
    }

    const response = await (options.fetchImpl || globalThis.fetch)(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let bodyObj = {};
    try { bodyObj = bodyText ? JSON.parse(bodyText) : {}; } catch { bodyObj = { raw: bodyText }; }
    if (!response.ok) {
      return { ok: false, status: 'http_error', http_status: response.status, error: bodyObj?.error?.message || bodyObj?.message || response.statusText, raw: bodyObj };
    }
    // Anthropic 响应：content 是数组，提取 type=text 的块（跳过 thinking 等）
    const blocks = Array.isArray(bodyObj?.content) ? bodyObj.content : [];
    const content = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!String(content).trim()) {
      return { ok: false, status: 'empty_reply', error: '模型返回为空', raw: bodyObj };
    }
    return { ok: true, status: 'success', content, raw: bodyObj };
  } catch (error) {
    return {
      ok: false,
      status: error.name === 'AbortError' ? 'timeout' : 'request_error',
      error: error.name === 'AbortError' ? `模型调用超时(${timeoutMs}ms)` : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function callOpenAiCompatibleModel(model, messages, options = {}) {
  // Anthropic Messages API 兼容 provider（LongCat 等）走专用适配器
  if (isAnthropicProvider(model)) {
    return callAnthropicMessagesModel(model, messages, options);
  }

  const apiKey = resolveModelApiKey(model);
  const missing = [];
  if (!model?.api_base) missing.push('api_base');
  if (!model?.model_id) missing.push('model_id');
  // AK/SK 模式下不要求 api_key（火山引擎 V4 签名）
  const useVolcSign = isVolcengineAkSkMode(model);
  if (!useVolcSign && !apiKey) missing.push('api_key');
  if (missing.length) {
    return { ok: false, status: 'config_error', error: `模型配置不完整：${missing.join('、')}` };
  }

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || process.env.FLATTALK_MODEL_TIMEOUT_MS || 45000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `${String(model.api_base).replace(/\/$/, '')}/chat/completions`;
    const body = JSON.stringify({
      model: model.model_id,
      messages,
      max_tokens: Number(options.maxTokens || model.max_tokens || 4000),
      temperature: Number(options.temperature ?? model.temperature ?? 0.3),
      stream: false,
    });

    // 头部分支：火山引擎 AK/SK 走 V4 签名，其余走 Bearer Token
    let headers;
    if (useVolcSign) {
      const signed = signVolcengineRequest({
        accessKeyId: process.env.VOLC_ACCESS_KEY_ID,
        secretAccessKey: process.env.VOLC_SECRET_ACCESS_KEY,
        region: 'cn-beijing',
        service: 'ark',
        method: 'POST',
        url: endpoint,
        body,
      });
      headers = signed.headers;
    } else {
      headers = {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json; charset=utf-8',
      };
    }

    const response = await (options.fetchImpl || globalThis.fetch)(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let bodyObj = {};
    try { bodyObj = bodyText ? JSON.parse(bodyText) : {}; } catch { bodyObj = { raw: bodyText }; }
    if (!response.ok) {
      return { ok: false, status: 'http_error', http_status: response.status, error: bodyObj?.error?.message || bodyObj?.message || response.statusText, raw: bodyObj };
    }
    const content = bodyObj?.choices?.[0]?.message?.content || bodyObj?.choices?.[0]?.delta?.content || '';
    if (!String(content).trim()) {
      return { ok: false, status: 'empty_reply', error: '模型返回为空', raw: bodyObj };
    }
    return { ok: true, status: 'success', content, raw: bodyObj };
  } catch (error) {
    return {
      ok: false,
      status: error.name === 'AbortError' ? 'timeout' : 'request_error',
      error: error.name === 'AbortError' ? `模型调用超时(${timeoutMs}ms)` : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调用 OpenAI 兼容的向量嵌入接口（/embeddings）。
 * @param {object} model - 模型配置，需包含 api_base / model_id
 * @param {string|string[]} input - 需要嵌入的文本（或文本数组）
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, status?: string, embedding?: number[], error?: string, raw?: object}>}
 */
export async function callEmbedding(model, input, options = {}) {
  const apiKey = resolveModelApiKey(model);
  const missing = [];
  if (!model?.api_base) missing.push('api_base');
  if (!apiKey) missing.push('api_key');
  if (!model?.model_id) missing.push('model_id');
  if (missing.length) {
    return { ok: false, status: 'config_error', error: `模型配置不完整：${missing.join('、')}` };
  }

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || process.env.FLATTALK_MODEL_TIMEOUT_MS || 45000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(`${String(model.api_base).replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: model.model_id,
        input,
      }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let body = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText }; }
    if (!response.ok) {
      return { ok: false, status: 'http_error', http_status: response.status, error: body?.error?.message || body?.message || response.statusText, raw: body };
    }
    const embedding = body?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { ok: false, status: 'empty_reply', error: '向量嵌入返回为空', raw: body };
    }
    return { ok: true, status: 'success', embedding, raw: body };
  } catch (error) {
    return {
      ok: false,
      status: error.name === 'AbortError' ? 'timeout' : 'request_error',
      error: error.name === 'AbortError' ? `向量嵌入调用超时(${timeoutMs}ms)` : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}
