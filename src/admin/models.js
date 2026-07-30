import fs from 'node:fs';
import path from 'node:path';
import { json, readJsonSafe, maskApiKey } from './util.js';

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
// 支持 FLATTALK_MODEL_<PROVIDER>_API_KEY（如 FLATTALK_MODEL_ZHIPU_API_KEY）
// 与通用兜底 FLATTALK_MODEL_API_KEY，避免把真实密钥明文写进 JSON 注册表
function resolveApiKey(model) {
  if (model.api_key && String(model.api_key).trim()) return String(model.api_key);
  const provider = String(model.provider || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (provider && process.env[`FLATTALK_MODEL_${provider}_API_KEY`]) {
    return process.env[`FLATTALK_MODEL_${provider}_API_KEY`];
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
      'model_id', 'max_tokens', 'temperature', 'is_active', 'is_default', 'owner', 'sort_order'];
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

  if (method === 'POST' && action === 'test') return json(res, 200, await testModel(model));
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

// 复用：向指定模型发一条消息，返回回复文本（供「对话运行」复用）
export async function callModelChat(model, prompt, opts = {}) {
  const apiKey = resolveApiKey(model);
  const missing = [];
  if (!model.api_base || !String(model.api_base).trim()) missing.push('api_base');
  if (!apiKey) missing.push('api_key');
  if (!model.model_id || !String(model.model_id).trim()) missing.push('model_id');
  if (missing.length) {
    const hint = missing.includes('api_key')
      ? '（可在「编辑模型」填写，或用 .env 的 FLATTALK_MODEL_<供应商>_API_KEY 提供）'
      : '';
    return { ok: false, status: 'error', message: `模型配置不完整，缺少：${missing.join('、')}${hint}` };
  }
  const url = `${model.api_base.replace(/\/$/, '')}/chat/completions`;
  const payload = {
    model: model.model_id,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts.max_tokens || 512,
    temperature: opts.temperature ?? 0.7,
    stream: false,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (resp.ok) {
      const data = await resp.json();
      const reply = data?.choices?.[0]?.message?.content || '';
      if (!String(reply).trim()) return { ok: false, status: 'error', message: '模型返回为空', detail: JSON.stringify(data).slice(0, 500) };
      return { ok: true, status: 'success', message: '调用成功', reply };
    }
    return { ok: false, status: 'error', message: `模型返回 HTTP ${resp.status}`, detail: (await resp.text()).slice(0, 500) };
  } catch (e) {
    return { ok: false, status: 'error', message: `调用失败：${e.name === 'AbortError' ? '超时(30s)' : e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function testModel(model) {
  const r = await callModelChat(model, 'Hi, this is a connectivity test. Reply with OK.', { max_tokens: 10, temperature: 0.1 });
  if (!r.ok) return { ok: true, status: 'error', message: r.message };
  return { ok: true, status: 'success', message: '连通性测试通过', reply: r.reply };
}
