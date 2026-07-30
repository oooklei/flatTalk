// Open API 管理：接口目录、API 密钥管理、在线测试、入站鉴权
// 密钥存 data/api-keys.json；生成任一启用密钥后，/api/open/* 即要求携带
// Authorization: Bearer <key> 或 X-API-Key: <key>（嵌入 token 亦可通过校验）。
import crypto from 'node:crypto';
import { readReg, writeReg, nextId } from './store.js';
import { json, readJsonSafe, maskApiKey } from './util.js';
import { readAccess } from './access.js';

const REG = 'api-keys';

// 对外开放接口目录（flatTalk 入站 Open API）
export const OPENAPI_CATALOG = [
  {
    id: 'open_chat', method: 'POST', path: '/api/open/v1/chat/completions',
    name: 'OpenAI 兼容对话', auth: 'API Key（生成密钥后强制）',
    description: '对外统一对话入口，OpenAI chat/completions 兼容格式',
    sample: { model: 'flattalk', messages: [{ role: 'user', content: '你好，介绍一下你的能力' }], stream: false },
  },
  {
    id: 'chat_message', method: 'POST', path: '/api/chat/message',
    name: '会话消息', auth: '同 Open API 鉴权',
    description: '原生会话接口，支持 role/skill_key/session_id',
    sample: { message: '推荐一条南宁周边的旅居路线', role: 'elder', session_id: 'openapi-test' },
  },
  {
    id: 'intent_classify', method: 'POST', path: '/api/intent/classify',
    name: '意图识别', auth: '同 Open API 鉴权',
    description: '文本 → 意图/技能路由结果',
    sample: { text: '帮我预约一次上门助浴服务' },
  },
  {
    id: 'skills_list', method: 'GET', path: '/api/skills',
    name: '技能列表', auth: '公开', description: '当前已注册技能清单', sample: null,
  },
  {
    id: 'knowledge_search', method: 'POST', path: '/api/data/knowledge/search',
    name: '知识检索', auth: '同 Open API 鉴权',
    description: '知识库全文/向量检索', sample: { query: '长者助餐补贴政策', top_k: 5 },
  },
  {
    id: 'ext_gateway', method: 'ANY', path: '/api/ext/<integration_key>/<path>',
    name: '第三方API入站网关', auth: '内部',
    description: '第三方集成统一代理入口，见「第三方API」页面', sample: null,
  },
  {
    id: 'health', method: 'GET', path: '/api/health',
    name: '健康检查', auth: '公开', description: '服务存活探针', sample: null,
  },
];

function genKey() {
  return 'ftk_' + crypto.randomBytes(24).toString('hex');
}

function maskKey(k) {
  return maskApiKey(k).masked;
}

export function verifyOpenApiKey(req) {
  const access = readAccess();
  const required = access.api_auth?.require_key === true;
  const keys = readReg(REG, { items: [] }).items.filter((k) => k.enabled !== false);
  if (!required && keys.length === 0) return { ok: true, mode: 'open' };

  const auth = String(req.headers.authorization || '');
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.headers['x-api-key'] || '').trim();
  if (!provided) return { ok: false, message: '缺少 API Key（Authorization: Bearer <key> 或 X-API-Key）' };
  const hit = keys.find((k) => k.key === provided);
  if (hit) {
    try {
      const data = readReg(REG, { items: [] });
      const row = data.items.find((k) => k.id === hit.id);
      if (row) { row.last_used_at = new Date().toISOString(); row.call_count = (row.call_count || 0) + 1; writeReg(REG, data); }
    } catch {}
    return { ok: true, mode: 'api_key', key_id: hit.id };
  }
  const embeds = readReg('embeds', { items: [] }).items.filter((e) => e.enabled !== false);
  if (embeds.some((e) => e.token === provided)) return { ok: true, mode: 'embed' };
  return { ok: false, message: 'API Key 无效或已停用' };
}

// /api/admin/openapi/catalog | keys[...] | test
export async function handleOpenApiAdmin(req, res, method, parts) {
  const seg = parts[0];

  if (seg === 'catalog' && method === 'GET') {
    const keys = readReg(REG, { items: [] }).items.filter((k) => k.enabled !== false);
    const required = readAccess().api_auth?.require_key === true || keys.length > 0;
    return json(res, 200, { ok: true, items: OPENAPI_CATALOG, auth_required: required });
  }

  if (seg === 'keys') {
    const data = readReg(REG, { items: [] });
    const id = parts[1];
    const action = parts[2];
    if (!id && method === 'GET') {
      return json(res, 200, {
        ok: true,
        items: data.items.map((k) => ({ ...k, key: undefined, key_masked: maskKey(k.key) })),
      });
    }
    if (!id && method === 'POST') {
      const b = await readJsonSafe(req, res);
      if (b === undefined) return;
      const item = {
        id: nextId(data.items),
        name: b.name || `密钥-${Date.now()}`,
        key: genKey(),
        enabled: true,
        scopes: b.scopes || ['open'],
        created_at: new Date().toISOString(),
        call_count: 0,
      };
      data.items.push(item);
      writeReg(REG, data);
      return json(res, 201, { ok: true, item }); // 创建时返回完整密钥
    }
    const it = data.items.find((k) => String(k.id) === id);
    if (!it) return json(res, 404, { ok: false, error: 'key_not_found' });
    if (action === 'reveal' && method === 'GET') return json(res, 200, { ok: true, key: it.key });
    if ((action === 'enable' || action === 'disable') && method === 'POST') {
      it.enabled = action === 'enable';
      writeReg(REG, data);
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      data.items = data.items.filter((k) => k !== it);
      writeReg(REG, data);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  // 在线测试：服务端自调用，避免浏览器跨域/密钥泄漏到前端日志
  if (seg === 'test' && method === 'POST') {
    const b = await readJsonSafe(req, res);
    if (b === undefined) return;
    const path = String(b.path || '');
    if (!path.startsWith('/api/')) return json(res, 400, { ok: false, error: 'invalid_path' });
    const base = 'http://127.0.0.1:' + (process.env.FLATTALK_PORT || process.env.PORT || '5298');
    const headers = { 'content-type': 'application/json' };
    if (b.api_key) headers['x-api-key'] = b.api_key;
    const started = Date.now();
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 60000);
      const r = await fetch(base + path, {
        method: b.method || 'GET',
        headers,
        body: b.method && b.method !== 'GET' && b.body ? (typeof b.body === 'string' ? b.body : JSON.stringify(b.body)) : undefined,
        signal: ac.signal,
      });
      clearTimeout(timer);
      const text = await r.text();
      return json(res, 200, {
        ok: true,
        result: { status: r.status, latency_ms: Date.now() - started, body: text.slice(0, 4000) },
      });
    } catch (e) {
      return json(res, 200, { ok: true, result: { status: 0, latency_ms: Date.now() - started, error: e.message } });
    }
  }

  return json(res, 404, { ok: false, error: 'not_found' });
}
