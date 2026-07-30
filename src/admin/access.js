// 认证接入 + 第三方嵌入 管理
// - 认证接入：SSO（业务系统单点登录）配置与连通测试、Open API 强制鉴权开关（data/auth-access.json）
// - 第三方嵌入：嵌入点（token）管理，iframe/script 嵌入 flatTalk 对话组件（data/embeds.json）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readReg, writeReg, nextId } from './store.js';
import { json, readJsonSafe, maskApiKey } from './util.js';

const ACCESS_FILE = path.resolve('data', 'auth-access.json');
const EMBED_REG = 'embeds';

const DEFAULT_ACCESS = {
  sso: {
    enabled: false,
    provider: 'business', // business=业务系统SSO
    login_url: '',
    token_check_url: '',
    client_id: '',
    client_secret: '',
  },
  api_auth: { require_key: false },
};

export function readAccess() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8'));
    return { ...DEFAULT_ACCESS, ...raw, sso: { ...DEFAULT_ACCESS.sso, ...raw.sso }, api_auth: { ...DEFAULT_ACCESS.api_auth, ...raw.api_auth } };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_ACCESS));
  }
}

function writeAccess(cfg) {
  fs.mkdirSync(path.dirname(ACCESS_FILE), { recursive: true });
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function accessPublic(cfg) {
  const { masked, has } = maskApiKey(cfg.sso.client_secret || '');
  return { ...cfg, sso: { ...cfg.sso, client_secret: undefined, client_secret_masked: masked, has_client_secret: has } };
}

export function getEmbedByToken(token) {
  if (!token) return null;
  const data = readReg(EMBED_REG, { items: [] });
  const it = data.items.find((e) => e.token === token && e.enabled !== false);
  if (!it) return null;
  return { name: it.name, role: it.default_role || 'elder', skill_key: it.skill_key || '', theme: it.theme || 'light', welcome: it.welcome || '' };
}

// /api/admin/access/... 与 /api/admin/embeds/...
export async function handleAccessApi(req, res, method, parts) {
  const root = parts[0];

  if (root === 'access') {
    const seg = parts[1];
    if (seg === 'sso' && method === 'GET') return json(res, 200, { ok: true, config: accessPublic(readAccess()) });
    if (seg === 'sso' && method === 'PUT') {
      const b = await readJsonSafe(req, res);
      if (b === undefined) return;
      const cfg = readAccess();
      const sso = b.sso || {};
      for (const f of ['enabled', 'provider', 'login_url', 'token_check_url', 'client_id']) {
        if (sso[f] !== undefined) cfg.sso[f] = sso[f];
      }
      if (sso.client_secret) cfg.sso.client_secret = sso.client_secret; // 留空不改
      if (b.api_auth?.require_key !== undefined) cfg.api_auth.require_key = Boolean(b.api_auth.require_key);
      writeAccess(cfg);
      return json(res, 200, { ok: true, config: accessPublic(cfg) });
    }
    if (seg === 'sso' && parts[2] === 'test' && method === 'POST') {
      const cfg = readAccess();
      const report = { dev_login: null, remote: null };
      // 1) 本机 dev-login 自检
      const base = 'http://127.0.0.1:' + (process.env.FLATTALK_PORT || process.env.PORT || '5298');
      try {
        const r = await fetch(base + '/api/sso/dev-login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ presetKey: 'c_elder' }),
        });
        report.dev_login = { status: r.status, ok: r.ok };
      } catch (e) {
        report.dev_login = { ok: false, error: e.message };
      }
      // 2) 远端 SSO 连通
      if (cfg.sso.token_check_url) {
        const started = Date.now();
        try {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), 10000);
          const r = await fetch(cfg.sso.token_check_url, { method: 'GET', signal: ac.signal });
          clearTimeout(timer);
          report.remote = { status: r.status, ok: r.status < 500, latency_ms: Date.now() - started };
        } catch (e) {
          report.remote = { ok: false, error: e.message, latency_ms: Date.now() - started };
        }
      } else {
        report.remote = { skipped: true, message: '未配置 token_check_url' };
      }
      return json(res, 200, { ok: true, report });
    }
    return json(res, 404, { ok: false, error: 'not_found' });
  }

  if (root === 'embeds') {
    const data = readReg(EMBED_REG, { items: [] });
    const id = parts[1];
    const action = parts[2];
    if (!id && method === 'GET') return json(res, 200, { ok: true, items: data.items });
    if (!id && method === 'POST') {
      const b = await readJsonSafe(req, res);
      if (b === undefined) return;
      const item = {
        id: nextId(data.items),
        name: b.name || `嵌入点-${Date.now()}`,
        token: 'emb_' + crypto.randomBytes(16).toString('hex'),
        allowed_origins: b.allowed_origins || '*',
        default_role: b.default_role || 'elder',
        skill_key: b.skill_key || '',
        theme: b.theme || 'light',
        welcome: b.welcome || '',
        enabled: true,
        created_at: new Date().toISOString(),
      };
      data.items.push(item);
      writeReg(EMBED_REG, data);
      return json(res, 201, { ok: true, item });
    }
    const it = data.items.find((e) => String(e.id) === id);
    if (!it) return json(res, 404, { ok: false, error: 'embed_not_found' });
    if ((action === 'enable' || action === 'disable') && method === 'POST') {
      it.enabled = action === 'enable';
      writeReg(EMBED_REG, data);
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      const b = await readJsonSafe(req, res);
      if (b === undefined) return;
      for (const f of ['name', 'allowed_origins', 'default_role', 'skill_key', 'theme', 'welcome']) {
        if (b[f] !== undefined) it[f] = b[f];
      }
      writeReg(EMBED_REG, data);
      return json(res, 200, { ok: true, item: it });
    }
    if (method === 'DELETE') {
      data.items = data.items.filter((e) => e !== it);
      writeReg(EMBED_REG, data);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  return json(res, 404, { ok: false, error: 'not_found' });
}
