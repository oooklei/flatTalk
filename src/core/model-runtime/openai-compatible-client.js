import { resolveModelApiKey } from './model-registry.js';

export async function callOpenAiCompatibleModel(model, messages, options = {}) {
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
    const response = await (options.fetchImpl || globalThis.fetch)(`${String(model.api_base).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: model.model_id,
        messages,
        max_tokens: Number(options.maxTokens || model.max_tokens || 4000),
        temperature: Number(options.temperature ?? model.temperature ?? 0.3),
        stream: false,
      }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let body = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText }; }
    if (!response.ok) {
      return { ok: false, status: 'http_error', http_status: response.status, error: body?.error?.message || body?.message || response.statusText, raw: body };
    }
    const content = body?.choices?.[0]?.message?.content || body?.choices?.[0]?.delta?.content || '';
    if (!String(content).trim()) {
      return { ok: false, status: 'empty_reply', error: '模型返回为空', raw: body };
    }
    return { ok: true, status: 'success', content, raw: body };
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
