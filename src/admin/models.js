import fs from 'node:fs';
import path from 'node:path';
import { json, readJsonSafe, maskApiKey } from './util.js';
import { signVolcengineRequest } from '../core/model-runtime/volcengine-signer.js';

const REG_PATH = path.join(process.cwd(), 'data', 'model-registry.json');

function readRegistry() {
  if (!fs.existsSync(REG_PATH)) {
    const init = { version: 'flatTalk.model-registry.v1', models: [] };
    fs.mkdirSync(path.dirname(REG_PATH), { recursive: true });
    fs.writeFileSync(REG_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
}

function writeRegistry(reg) {
  fs.mkdirSync(path.dirname(REG_PATH), { recursive: true });
  fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2));
}

function nextId(reg) {
  const ids = reg.models.map((m) => m.id).filter((n) => typeof n === 'number');
  return ids.length ? Math.max(...ids) + 1 : 1;
}

// 解析模型密钥：优先用注册表里的 api_key，缺失时回退到环境变量
// longcat provider 兼容旧的 ANTHROPIC 环境变量名
function resolveApiKey(model) {
  if (model.api_key && String(model.api_key).trim()) return String(model.api_key);
  const provider = String(model.provider || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (provider && process.env[`FLATTALK_MODEL_${provider}_API_KEY`]) {
    return process.env[`FLATTALK_MODEL_${provider}_API_KEY`];
  }
  // longcat 回退：兼容旧变量名 FLATTALK_MODEL_ANTHROPIC_API_KEY
  if (provider === 'LONGCAT' && process.env.FLATTALK_MODEL_ANTHROPIC_API_KEY) {
    return process.env.FLATTALK_MODEL_ANTHROPIC_API_KEY;
  }
  return process.env.FLATTALK_MODEL_API_KEY || '';
}

function toPublic(m) {
  const key = resolveApiKey(m);
  const masked = key ? maskApiKey(key).masked : '';
  return { ...m, api_key: masked, has_api_key: Boolean(key) };
}

function nowIso() { return new Date().toISOString(); }

export async function handleModelsApi(req, res, url, parts) {
  const reg = readRegistry();
  const method = req.method;

  // 列表 / 新建
  if (parts.length === 0) {
    if (method === 'GET') {
      const items = reg.models
        .slice()
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)
        .map(toPublic);
      return json(res, 200, { ok: true, items, total: items.length });
    }
    if (method === 'POST') {
      const b = await readJsonSafe(req, res);
      if (b === undefined) return;
      if (!b.name) return json(res, 400, { ok: false, error: 'name_required' });
      if (reg.models.some((m) => m.name === b.name))
        return json(res, 409, { ok: false, error: 'name_exists' });
      const isDefault = b.is_default === true;
      if (isDefault) reg.models.forEach((m) => (m.is_default = false));
      const rec = {
        id: nextId(reg),
        name: b.name,
        display_name: b.display_name || b.name,
        provider: b.provider || 'unknown',
        api_base: b.api_base || '',
        model_type: b.model_type || 'llm_text',
        purpose: b.purpose || '',
        api_key: b.api_key || '',
        model_id: b.model_id || b.name,
        max_tokens: Number(b.max_tokens) || 4096,
        temperature: b.temperature == null ? 0.7 : Number(b.temperature),
        is_active: b.is_active !== false,
        is_default: isDefault,
        owner: b.owner || 'system',
        description: b.description || '',
        sort_order: Number(b.sort_order) || reg.models.length + 1,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      reg.models.push(rec);
      writeRegistry(reg);
      return json(res, 201, { ok: true, model: toPublic(rec) });
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const id = Number(parts[0]);
  const model = reg.models.find((m) => m.id === id);
  if (!model) return json(res, 404, { ok: false, error: 'model_not_found' });
  const action = parts[1];

  if (method === 'PUT' && !action) {
    const b = await readJsonSafe(req, res);
    if (b === undefined) return;
    const updatable = ['display_name', 'provider', 'api_base', 'model_type', 'purpose',
      'model_id', 'max_tokens', 'temperature', 'is_active', 'is_default', 'owner', 'description', 'sort_order'];
    for (const k of updatable) if (k in b) model[k] = b[k];
    if (typeof b.api_key === 'string' && b.api_key !== '') model.api_key = b.api_key;
    if (b.is_default === true) reg.models.forEach((m) => { if (m.id !== id) m.is_default = false; });
    model.updated_at = nowIso();
    writeRegistry(reg);
    return json(res, 200, { ok: true, model: toPublic(model) });
  }

  if (method === 'DELETE' && !action) {
    reg.models = reg.models.filter((m) => m.id !== id);
    writeRegistry(reg);
    return json(res, 200, { ok: true, message: 'deleted' });
  }

  if (method === 'POST' && action === 'test') {
    const t0 = Date.now();
    const result = await testModel(model);
    const duration = Date.now() - t0;
    // 记录测试结果到 registry
    model.test_status = result.status; // 'success' | 'error'
    model.test_duration_ms = duration;
    model.tested_at = nowIso();
    writeRegistry(reg);
    return json(res, 200, { ...result, duration_ms: duration });
  }
  if (method === 'POST' && action === 'set-default') {
    reg.models.forEach((m) => (m.is_default = m.id === id));
    writeRegistry(reg);
    return json(res, 200, { ok: true, model: toPublic(model) });
  }
  if (method === 'POST' && action === 'enable') {
    model.is_active = true; model.updated_at = nowIso(); writeRegistry(reg);
    return json(res, 200, { ok: true, model: toPublic(model) });
  }
  if (method === 'POST' && action === 'disable') {
    model.is_active = false; model.updated_at = nowIso(); writeRegistry(reg);
    return json(res, 200, { ok: true, model: toPublic(model) });
  }

  return json(res, 404, { ok: false, error: 'route_not_found' });
}

/**
 * 通用模型调用：向指定模型发一条消息，返回回复文本
 * 参考 geniePPT/llm_service.py 的 OpenAI 兼容协议实现
 * 火山引擎 AK/SK 模式走 V4 签名（与运行时 openai-compatible-client.js 一致）
 */
export async function callModelChat(model, prompt, opts = {}) {
  const apiKey = resolveApiKey(model);
  const missing = [];
  if (!model.api_base || !String(model.api_base).trim()) missing.push('api_base');
  if (!model.model_id || !String(model.model_id).trim()) missing.push('model_id');

  const provider = String(model.provider || '').toLowerCase();
  const authMode = String(model.auth_mode || '').toLowerCase();

  // 火山引擎 AK/SK 鉴权
  const volcAk = process.env.VOLC_ACCESS_KEY_ID || process.env.VOLCENGINE_AK || process.env.ARK_AK || '';
  const volcSk = process.env.VOLC_SECRET_ACCESS_KEY || process.env.VOLCENGINE_SK || process.env.ARK_SK || '';

  // 仅当 auth_mode 显式为 volcengine_ak_sk 时才走 V4 签名；bearer 模式走标准 Bearer Token
  const needsVolcAkSk = authMode === 'volcengine_ak_sk';
  if (needsVolcAkSk) {
    if (!volcAk) missing.push('VOLC_ACCESS_KEY_ID');
    if (!volcSk) missing.push('VOLC_SECRET_ACCESS_KEY');
  } else {
    if (!apiKey) missing.push('api_key');
  }
  if (missing.length) {
    const hint = missing.some(m => m.includes('api_key') || m.includes('KEY_ID') || m.includes('ACCESS_KEY'))
      ? `（可在「编辑模型」填写，或用 .env 提供：${needsVolcAkSk ? 'VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY' : 'FLATTALK_MODEL_<供应商>_API_KEY'}）`
      : '';
    return { ok: false, status: 'error', message: `模型配置不完整，缺少：${missing.join('、')}${hint}` };
  }

  const url = `${model.api_base.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: model.model_id,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts.max_tokens || 512,
    temperature: opts.temperature ?? 0.7,
    stream: false,
  });

  // 构建鉴权头：火山引擎走 V4 签名，其余走 Bearer
  let headers;
  if (needsVolcAkSk) {
    const signed = signVolcengineRequest({
      accessKeyId: volcAk,
      secretAccessKey: volcSk,
      region: model.region || 'cn-beijing',
      service: 'ark',
      method: 'POST',
      url,
      body,
    });
    headers = signed.headers;
    // 不覆盖 Content-Type：签名器已设 application/json; charset=utf-8，覆盖会导致签名校验失败
  } else {
    headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: ctrl.signal,
    });
    if (resp.ok) {
      const data = await resp.json();
      const choice = data?.choices?.[0] || {};
      let reply = choice?.message?.content || '';
      const reasoning = choice?.message?.reasoning_content || '';
      if (!String(reply).trim() && reasoning) {
        reply = `[思考模型] ${String(reasoning).slice(0, 200)}`;
      }
      if (!String(reply).trim()) {
        return { ok: false, status: 'error', message: '模型返回为空（content 和 reasoning_content 均为空）', detail: JSON.stringify(data).slice(0, 500) };
      }
      return { ok: true, status: 'success', message: '调用成功', reply };
    }
    const errText = await resp.text();
    return { ok: false, status: 'error', message: `模型返回 HTTP ${resp.status}`, detail: errText.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: 'error', message: `调用失败：${e.name === 'AbortError' ? '超时(30s)' : e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 向量嵌入模型测试：调用 /embeddings 端点
 */
async function testEmbeddingModel(model) {
  const apiKey = resolveApiKey(model);
  if (!apiKey) return { ok: true, status: 'error', message: '缺少 api_key（可在「编辑模型」填写）' };

  const url = `${model.api_base.replace(/\/$/, '')}/embeddings`;
  const payload = {
    model: model.model_id,
    input: '连通性测试',
  };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (resp.ok) {
      const data = await resp.json();
      const dim = data?.data?.[0]?.embedding?.length || 0;
      return { ok: true, status: 'success', message: `连通性测试通过（向量维度 ${dim}）` };
    }
    const errText = await resp.text();
    return { ok: true, status: 'error', message: `模型返回 HTTP ${resp.status}`, detail: errText.slice(0, 300) };
  } catch (e) {
    return { ok: true, status: 'error', message: `调用失败：${e.name === 'AbortError' ? '超时(15s)' : e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 测试图像/视频生成模型连通性
 * 这类模型不走 /chat/completions，改用方舟的模型列表端点验证鉴权
 * 能拿到模型列表说明 API Key + endpoint 有效
 */
async function testMediaModel(model) {
  const apiKey = resolveApiKey(model);
  if (!apiKey) return { ok: true, status: 'error', message: '缺少 api_key' };

  const base = model.api_base.replace(/\/$/, '');
  // 方舟通过接入点列表验证鉴权
  const url = `${base}/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (resp.ok) {
      return { ok: true, status: 'success', message: `连通性测试通过（${model.model_type === 'video_generation' ? '视频' : '图像'}生成模型，鉴权有效）` };
    }
    const errText = await resp.text().catch(() => '');
    return { ok: true, status: 'error', message: `模型返回 HTTP ${resp.status}`, detail: errText.slice(0, 300) };
  } catch (e) {
    return { ok: true, status: 'error', message: `调用失败：${e.name === 'AbortError' ? '超时(10s)' : e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 模型连通性测试
 * 参考 geniePPT models_config.py test_model 端点：
 * - 文本模型：发简单 chat 请求，max_tokens=100（思考模型需要更多 token）
 * - 向量模型：调 /embeddings 端点
 * - 图像/视频模型：验证鉴权有效性（不走 chat 端点）
 */
async function testModel(model) {
  // 向量嵌入模型走 /embeddings 端点
  if (model.model_type === 'embedding') {
    return testEmbeddingModel(model);
  }

  // 图像/视频生成模型：验证鉴权而非真正生成
  if (model.model_type === 'image_generation' || model.model_type === 'video_generation') {
    return testMediaModel(model);
  }

  // 文本/视觉模型：发 chat 请求
  // max_tokens 设为 100：思考模型（如 GLM-5.2）会先用 token 做推理，10 不够
  const r = await callModelChat(model, 'Hi, this is a connectivity test. Reply with OK.', {
    max_tokens: 100,
    temperature: 0.1,
  });
  if (!r.ok) return { ok: true, status: 'error', message: r.message, detail: r.detail || '' };
  return { ok: true, status: 'success', message: '连通性测试通过', reply: r.reply };
}
