import fs from 'node:fs';
import path from 'node:path';

import { readReg, writeReg, nextId } from './store.js';
import { json, readJsonSafe, maskApiKey } from './util.js';

const REG = 'integrations';

const SEEDS = [
  {
    key: 'nuwax',
    name: '女娲平台 NuwaX',
    category: 'AI平台',
    base_url: 'http://43.138.143.130:9015',
    auth_type: 'none',
    test_path: '/',
    env_keys: ['NUWAX_BASE_URL', 'NUWAX_ACCOUNT', 'NUWAX_PASSWORD', 'NUWAX_SPACE_ID'],
    description: '远程智能体对话、技能和知识库编排。',
  },
  {
    key: 'tavily',
    name: 'Tavily 网页搜索',
    category: '搜索',
    base_url: 'https://api.tavily.com',
    auth_type: 'bearer',
    test_path: '/',
    env_keys: ['TAVILY_API_KEY', 'WEB_SEARCH_API_KEY'],
    description: '网页素材搜索。',
  },
  {
    key: 'tencent_map',
    name: '腾讯位置服务',
    category: '地图',
    base_url: 'https://apis.map.qq.com',
    auth_type: 'query',
    auth_name: 'key',
    test_path: '/ws/geocoder/v1/?address=南宁市',
    env_keys: ['TENCENT_MAP_KEY', 'TENCENT_MAP_SK', 'TENCENT_MAP_KEY_2', 'TENCENT_MAP_SK_2'],
    description: '地理编码、路线规划和 POI 搜索。支持 KEY/KEY_2 主备轮换（配额 121 自动切换）。',
  },
  {
    key: 'tencent_weather',
    name: '腾讯天气',
    category: '天气',
    base_url: 'https://apis.map.qq.com',
    auth_type: 'query',
    auth_name: 'key',
    test_path: '/',
    env_keys: ['TENCENT_WEATHER_BASE_URL', 'TENCENT_MAP_KEY'],
    description: '实时天气查询。',
  },
  {
    key: 'qweather',
    name: '和风天气灾害预警',
    category: '天气',
    base_url: 'https://devapi.qweather.com',
    auth_type: 'header',
    auth_name: 'X-QW-Api-Key',
    test_path: '/v7/warning/now?location=101300101',
    env_keys: ['QWEATHER_KEY', 'QWEATHER_BASE_URL'],
    description: '灾害预警查询。',
  },
  {
    key: 'ocr',
    name: 'OCR 通用识别',
    category: '感知',
    base_url: '',
    auth_type: 'none',
    test_path: '/',
    env_keys: ['OCR_ENDPOINT'],
    description: '图片文字识别。',
  },
  {
    key: 'volc_asr',
    name: '火山引擎 ASR',
    category: '感知',
    base_url: 'https://10.21.202.9:9080',
    auth_type: 'bearer',
    test_path: '/asr/file',
    env_keys: ['ASR_ENDPOINT', 'VOLCENGINE_APP_ID', 'VOLCENGINE_ACCESS_TOKEN', 'VOLCENGINE_RESOURCE_ID'],
    description: '语音转写（文件上传 /asr/file，流式 /asr/stream）。sauc-api 容器，端口 9080(HTTPS)。',
  },
  {
    key: 'tencent_asr',
    name: '腾讯云一句话识别',
    category: '感知',
    base_url: 'http://10.21.202.9:8020',
    auth_type: 'none',
    test_path: '/health',
    env_keys: ['TENCENT_ASR_ENDPOINT', 'TENCENT_ASR_APP_ID', 'TENCENT_ASR_SECRET_ID', 'TENCENT_ASR_SECRET_KEY'],
    description: '一句话语音识别（POST /api/v1/asr/sentence）。tencent-asr 容器，端口 8020。',
  },
  {
    key: 'profile_tags',
    name: '老人画像标签',
    category: '业务数据',
    base_url: '',
    auth_type: 'bearer',
    test_path: '/',
    env_keys: ['PROFILE_TAG_API_BASE_URL', 'PROFILE_TAG_SSO_USERNAME', 'PROFILE_TAG_SSO_PASSWORD', 'PROFILE_TAG_API_TOKEN'],
    description: '老人画像标签拉取。',
  },
  {
    key: 'tag_system',
    name: '统一标签系统',
    category: '业务数据',
    base_url: 'http://10.21.202.9:8010',
    auth_type: 'header',
    auth_name: 'X-Client-Key',
    test_path: '/',
    env_keys: ['TAG_SYSTEM_SSO_TOKEN', 'TAG_SYSTEM_CLIENT_KEY', 'FLATTALK_TAG_SYSTEM_PG_URL'],
    description: '实体标签读取。',
  },
  {
    key: 'jtd',
    name: '金跳动旅居产品',
    category: '交易',
    base_url: '',
    auth_type: 'none',
    test_path: '/',
    env_keys: ['TRAVEL_PRODUCT_API_BASE_URL', 'TRAVEL_ORDER_API_BASE_URL', 'JTD_H5_BASE_URL', 'JTD_MINI_PROGRAM_APPID'],
    description: '旅居产品搜索、详情和下单跳转。',
  },
  {
    key: 'unified_auth',
    name: '统一认证/订单工单',
    category: '交易',
    base_url: '',
    auth_type: 'none',
    test_path: '/',
    env_keys: ['UNIFIED_AUTH_BASE_URL', 'UNIFIED_AUTH_USERNAME', 'UNIFIED_AUTH_PASSWORD', 'ORDER_SYSTEM_BASE_URL'],
    description: '统一认证、订单和工单查询。',
  },
  {
    key: 'business_system',
    name: '业务系统接口',
    category: '业务数据',
    base_url: '',
    auth_type: 'bearer',
    test_path: '/',
    env_keys: ['GXY_BUSINESS_SYSTEM_BASE_URL', 'GXY_BUSINESS_SYSTEM_TOKEN'],
    description: 'current-user、工单动作和消息发布。',
  },
];

export function loadIntegrations() {
  const data = readReg(REG, { items: [] });
  let dirty = false;
  if (!data.items.length) {
    data.items = SEEDS.map((seed, index) => ({ id: index + 1, status: 'active', config: {}, ...seed }));
    dirty = true;
  }
  if (migrateExternalServices(data)) dirty = true;
  if (dirty) writeReg(REG, data);
  return data;
}

function migrateExternalServices(data) {
  const file = path.resolve('data', 'external-services.json');
  if (!fs.existsSync(file)) return false;
  let legacy = [];
  try {
    legacy = JSON.parse(fs.readFileSync(file, 'utf8')).items || [];
  } catch {
    legacy = [];
  }
  let changed = false;
  for (const service of legacy) {
    if (!service || !service.name) continue;
    if (data.items.some((item) => item.name === service.name || (service.base_url && item.base_url === service.base_url))) continue;
    data.items.push({
      id: nextId(data.items),
      key: `ext_svc_${service.id || nextId(data.items)}`,
      name: service.name,
      category: '外部服务',
      base_url: service.base_url || '',
      auth_type: 'none',
      auth_name: '',
      test_path: '/',
      env_keys: [],
      description: [
        '迁自外部服务登记',
        service.type ? `类型:${service.type}` : '',
        service.owner ? `属主:${service.owner}` : '',
        service.openapi_url ? `OpenAPI:${service.openapi_url}` : '',
      ].filter(Boolean).join('；'),
      status: service.status === 'active' ? 'active' : 'draft',
      config: {},
    });
    changed = true;
  }
  try {
    fs.renameSync(file, `${file}.migrated`);
  } catch {
    // best effort migration marker
  }
  return changed;
}

function resolveSecret(integration) {
  if (integration.config?.api_key) return integration.config.api_key;
  for (const key of integration.env_keys || []) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && process.env[key]) return process.env[key];
  }
  return '';
}

function resolveBaseUrl(integration) {
  if (integration.base_url) return integration.base_url;
  for (const key of integration.env_keys || []) {
    if (/BASE_URL|ENDPOINT/i.test(key) && process.env[key]) return process.env[key];
  }
  return '';
}

function publicView(integration) {
  const { masked, has } = maskApiKey(resolveSecret(integration));
  const { config, ...rest } = integration;
  return {
    ...rest,
    base_url_resolved: resolveBaseUrl(integration),
    inbound_path: `/api/ext/${integration.key}`,
    has_secret: has,
    secret_masked: masked,
    env_present: (integration.env_keys || []).filter((key) => Boolean(process.env[key])),
  };
}

function injectAuth(integration, headers, targetUrl) {
  const secret = resolveSecret(integration);
  if (!secret) return targetUrl;
  const type = integration.auth_type || 'none';
  if (type === 'bearer') headers.authorization = `Bearer ${secret}`;
  else if (type === 'header') headers[(integration.auth_name || 'X-API-Key').toLowerCase()] = secret;
  else if (type === 'query') {
    const url = new URL(targetUrl);
    url.searchParams.set(integration.auth_name || 'key', secret);
    return url.toString();
  }
  return targetUrl;
}

async function fetchWithTimeout(targetUrl, options = {}, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(targetUrl, { ...options, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testIntegration(integration) {
  const base = resolveBaseUrl(integration);
  if (!base) return { ok: false, error: 'no_base_url', message: '未配置基础地址' };
  const headers = {};
  let target = base.replace(/\/+$/, '') + (integration.test_path || '/');
  target = injectAuth(integration, headers, target);
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(target, { method: 'GET', headers }, 10000);
    const text = (await response.text()).slice(0, 300);
    return { ok: response.status < 500, status: response.status, latency_ms: Date.now() - started, snippet: text };
  } catch (error) {
    return { ok: false, error: 'unreachable', message: error.message, latency_ms: Date.now() - started };
  }
}

export async function handleIntegrationsApi(req, res, method, parts) {
  const data = loadIntegrations();
  const id = parts[0];
  const action = parts[1];

  if (!id && method === 'GET') {
    return json(res, 200, { ok: true, items: data.items.map(publicView) });
  }

  if (!id && method === 'POST') {
    const body = await readJsonSafe(req, res);
    if (body === undefined) return;
    if (!body.key || !body.name) return json(res, 400, { ok: false, error: 'key_and_name_required' });
    if (data.items.some((item) => item.key === body.key)) return json(res, 409, { ok: false, error: 'key_exists' });
    const item = {
      id: nextId(data.items),
      key: String(body.key).trim(),
      name: body.name,
      category: body.category || '其他',
      base_url: body.base_url || '',
      auth_type: body.auth_type || 'none',
      auth_name: body.auth_name || '',
      test_path: body.test_path || '/',
      env_keys: parseEnvKeys(body.env_keys),
      description: body.description || '',
      status: body.status === 'draft' ? 'draft' : 'active',
      config: body.api_key ? { api_key: body.api_key } : {},
    };
    data.items.push(item);
    writeReg(REG, data);
    return json(res, 201, { ok: true, item: publicView(item) });
  }

  const item = data.items.find((entry) => String(entry.id) === id || entry.key === id);
  if (!item) return json(res, 404, { ok: false, error: 'integration_not_found' });

  if (action === 'test' && method === 'POST') {
    const result = await testIntegration(item);
    item.last_test = { at: new Date().toISOString(), ok: result.ok, status: result.status || null };
    writeReg(REG, data);
    return json(res, 200, { ok: true, result });
  }
  if ((action === 'enable' || action === 'disable') && method === 'POST') {
    item.status = action === 'enable' ? 'active' : 'draft';
    writeReg(REG, data);
    return json(res, 200, { ok: true, item: publicView(item) });
  }
  if (method === 'GET') return json(res, 200, { ok: true, item: publicView(item) });
  if (method === 'PUT') {
    const body = await readJsonSafe(req, res);
    if (body === undefined) return;
    for (const field of ['name', 'category', 'base_url', 'auth_type', 'auth_name', 'test_path', 'description', 'status']) {
      if (body[field] !== undefined) item[field] = body[field];
    }
    if (body.env_keys !== undefined) item.env_keys = parseEnvKeys(body.env_keys);
    if (body.api_key) {
      item.config = item.config || {};
      item.config.api_key = body.api_key;
    }
    writeReg(REG, data);
    return json(res, 200, { ok: true, item: publicView(item) });
  }
  if (method === 'DELETE') {
    data.items = data.items.filter((entry) => entry !== item);
    writeReg(REG, data);
    return json(res, 200, { ok: true });
  }
  return json(res, 405, { ok: false, error: 'method_not_allowed' });
}

function parseEnvKeys(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/[,，\s]+/).filter(Boolean);
}

export async function handleExtGateway(req, res, url) {
  const parts = url.pathname.slice('/api/ext/'.length).split('/').filter(Boolean);
  const key = parts[0];
  if (!key) return json(res, 400, { ok: false, error: 'integration_key_required' });
  const data = loadIntegrations();
  const integration = data.items.find((item) => item.key === key);
  if (!integration) return json(res, 404, { ok: false, error: 'integration_not_found', key });
  if (integration.status !== 'active') return json(res, 403, { ok: false, error: 'integration_disabled', key });
  const base = resolveBaseUrl(integration);
  if (!base) return json(res, 502, { ok: false, error: 'no_base_url', message: `集成「${integration.name}」未配置基础地址` });

  const rest = parts.slice(1).join('/');
  let target = base.replace(/\/+$/, '') + '/' + rest + (url.search || '');
  const headers = {};
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers.accept) headers.accept = req.headers.accept;
  target = injectAuth(integration, headers, target);

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(Buffer.alloc(0)));
    });
  }

  try {
    const response = await fetchWithTimeout(target, { method: req.method, headers, body: body?.length ? body : undefined });
    const buf = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8' });
    res.end(buf);
  } catch (error) {
    json(res, 502, { ok: false, error: 'upstream_error', integration: key, message: error.message });
  }
}
