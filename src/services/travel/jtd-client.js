import crypto from 'node:crypto';

const DEFAULT_CONFIG = Object.freeze({
  provider: 'jintiaodong',
  baseUrl: 'https://lvjutest.jtdcn.cn',
  pathPrefix: '/jtd-applet/ai/sojourn',
  appId: 'ai_test_app',
  appSecret: '',
  timeoutMs: 15000,
  retry: { maxAttempts: 2, backoffMs: [500, 1500] },
  endpoints: {
    searchProducts: { method: 'POST', path: '/searchProducts' },
    productDetail: { method: 'POST', path: '/productDetail' },
    checkAvailability: { method: 'POST', path: '/checkAvailability' },
  },
});

export function createJtdClient(options = {}) {
  const config = buildConfig(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  return {
    config,
    isConfigured() {
      return Boolean(config.baseUrl && config.appId && config.appSecret);
    },
    buildSignedRequest(endpointName, payload = {}, fixed = {}) {
      return buildSignedRequest(config, endpointName, payload, fixed);
    },
    searchProducts(query = {}) {
      return requestWithRetry({ config, fetchImpl, endpointName: 'searchProducts', payload: query });
    },
    productDetail(productId, skuId = '') {
      return requestWithRetry({
        config,
        fetchImpl,
        endpointName: 'productDetail',
        payload: { productId, ...(skuId ? { skuId } : {}) },
      });
    },
    checkAvailability({ productId, skuId = '', checkIn, checkOut, quantity = 1 } = {}) {
      return requestWithRetry({
        config,
        fetchImpl,
        endpointName: 'checkAvailability',
        payload: { productId, skuId, checkIn, checkOut, quantity },
      });
    },
  };
}

export function compactJson(payload = {}) {
  return JSON.stringify(payload || {});
}

export function sha256Hex(text = '') {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function hmacSha256Hex(secret, text) {
  return crypto.createHmac('sha256', String(secret)).update(String(text), 'utf8').digest('hex');
}

export function buildSigningText({ method, pathWithQuery, timestamp, nonce, bodySha256 }) {
  return [method, pathWithQuery, timestamp, nonce, bodySha256].join('\n');
}

function buildConfig(options = {}) {
  const env = options.env || process.env;
  return {
    ...DEFAULT_CONFIG,
    ...options,
    baseUrl: options.baseUrl
      || env.JTD_BASE_URL
      || env.TRAVEL_PRODUCT_API_BASE_URL
      || DEFAULT_CONFIG.baseUrl,
    pathPrefix: options.pathPrefix || env.JTD_PATH_PREFIX || DEFAULT_CONFIG.pathPrefix,
    appId: options.appId
      || env.JTD_AI_APP_ID
      || env.JTD_APP_ID
      || env.TRAVEL_PRODUCT_API_APP_ID
      || DEFAULT_CONFIG.appId,
    appSecret: options.appSecret
      || env.JTD_AI_APP_SECRET
      || env.JTD_APP_SECRET
      || env.TRAVEL_PRODUCT_API_APP_SECRET
      || env.TRAVEL_PRODUCT_API_SECRET
      || DEFAULT_CONFIG.appSecret,
    timeoutMs: Number(options.timeoutMs || env.JTD_TIMEOUT_MS || DEFAULT_CONFIG.timeoutMs),
    retry: {
      ...DEFAULT_CONFIG.retry,
      ...(options.retry || {}),
    },
    endpoints: {
      ...DEFAULT_CONFIG.endpoints,
      ...(options.endpoints || {}),
    },
  };
}

function buildSignedRequest(config, endpointName, payload = {}, fixed = {}) {
  const endpoint = config.endpoints?.[endpointName];
  if (!endpoint) throw new Error(`unknown_jtd_endpoint:${endpointName}`);

  const method = String(endpoint.method || 'POST').toUpperCase();
  const path = `${config.pathPrefix || ''}${endpoint.path || ''}`;
  const bodyText = method === 'GET' ? '' : compactJson(payload);
  const pathWithQuery = method === 'GET' ? appendQuery(path, payload) : path;
  const timestamp = String(fixed.timestamp || Date.now());
  const nonce = String(fixed.nonce || crypto.randomUUID());
  const bodySha256 = sha256Hex(bodyText);
  const signingText = buildSigningText({ method, pathWithQuery, timestamp, nonce, bodySha256 });
  const sign = hmacSha256Hex(config.appSecret || '', signingText);
  const url = `${String(config.baseUrl || '').replace(/\/+$/, '')}${pathWithQuery}`;

  return {
    method,
    url,
    pathWithQuery,
    bodyText,
    bodySha256,
    signingText,
    headers: {
      'X-AI-App-Id': config.appId,
      'X-AI-Timestamp': timestamp,
      'X-AI-Nonce': nonce,
      'X-AI-Sign': sign,
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
    },
  };
}

async function requestWithRetry({ config, fetchImpl, endpointName, payload }) {
  const configErrors = validateConfig(config);
  if (configErrors.length) {
    return buildUnavailable(endpointName, 'config_invalid', configErrors.join('; '), { payload });
  }

  const maxAttempts = Number(config.retry?.maxAttempts || 1);
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await requestOnce({ config, fetchImpl, endpointName, payload, attempt });
    if (last.ok || !isRetryable(last) || attempt === maxAttempts) return last;
    await sleep(Number(config.retry?.backoffMs?.[attempt - 1] || 0));
  }
  return last;
}

async function requestOnce({ config, fetchImpl, endpointName, payload, attempt }) {
  const started = Date.now();
  const requestId = `jtd_${endpointName}_${started}_${crypto.randomBytes(4).toString('hex')}`;
  const signed = buildSignedRequest(config, endpointName, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs || 15000));

  try {
    const response = await fetchImpl(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.method === 'GET' ? undefined : signed.bodyText,
      signal: controller.signal,
    });
    const text = await response.text();
    const data = parseJson(text);
    const result = {
      ok: response.ok && isBusinessSuccess(data),
      packageKey: 'travel_route',
      adapter: 'jintiaodong',
      request_id: requestId,
      source_status: response.ok && isBusinessSuccess(data) ? 'real_data' : 'error',
      fallback_used: false,
      endpoint: endpointName,
      httpStatus: response.status,
      business_code: data?.code ?? data?.status ?? null,
      error: response.ok ? businessError(data) : `http_${response.status}`,
      message: data?.msg || data?.message || '',
      request: safeRequestSnapshot(signed, payload),
      response: data,
      warnings: [],
      attempts: attempt,
      timing_ms: Date.now() - started,
    };
    if (isSignError(result)) result.sign_self_check = signSelfCheck(config, endpointName, payload, signed);
    return result;
  } catch (error) {
    return {
      ok: false,
      packageKey: 'travel_route',
      adapter: 'jintiaodong',
      request_id: requestId,
      source_status: 'unavailable',
      fallback_used: false,
      endpoint: endpointName,
      httpStatus: null,
      business_code: null,
      error: error.name === 'AbortError' ? 'network_timeout' : 'network_error',
      message: error.message,
      request: safeRequestSnapshot(signed, payload),
      response: null,
      warnings: [],
      attempts: attempt,
      timing_ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function validateConfig(config) {
  const errors = [];
  if (!config.baseUrl) errors.push('missing baseUrl');
  if (!/^https?:\/\//.test(String(config.baseUrl || ''))) errors.push('baseUrl must start with http(s)://');
  if (!config.pathPrefix) errors.push('missing pathPrefix');
  if (!config.appId) errors.push('missing appId');
  if (!config.appSecret) errors.push('missing appSecret');
  for (const endpointName of ['searchProducts', 'productDetail', 'checkAvailability']) {
    const endpoint = config.endpoints?.[endpointName];
    if (!endpoint?.path || !endpoint?.method) errors.push(`endpoint ${endpointName} missing path or method`);
  }
  return errors;
}

function buildUnavailable(endpoint, error, message, extra = {}) {
  return {
    ok: false,
    packageKey: 'travel_route',
    adapter: 'jintiaodong',
    request_id: `jtd_${endpoint}_${Date.now()}`,
    source_status: 'unavailable',
    fallback_used: false,
    endpoint,
    httpStatus: null,
    business_code: null,
    error,
    message,
    request: extra.payload ? { body: extra.payload } : {},
    response: null,
    warnings: [],
    attempts: 0,
    timing_ms: 0,
  };
}

function safeRequestSnapshot(signed, payload) {
  return {
    url: signed.url,
    method: signed.method,
    body: payload,
    timestamp: signed.headers['X-AI-Timestamp'],
    nonce: signed.headers['X-AI-Nonce'],
    body_sha256: signed.bodySha256,
  };
}

function signSelfCheck(config, endpointName, payload, signed) {
  const rebuilt = buildSignedRequest(config, endpointName, payload, {
    timestamp: signed.headers['X-AI-Timestamp'],
    nonce: signed.headers['X-AI-Nonce'],
  });
  return {
    self_check: true,
    method: rebuilt.method,
    path_with_query: rebuilt.pathWithQuery,
    timestamp: rebuilt.headers['X-AI-Timestamp'],
    nonce: rebuilt.headers['X-AI-Nonce'],
    body_sha256: rebuilt.bodySha256,
    signing_text: process.env.JTD_DEBUG_SIGN === 'true' ? rebuilt.signingText : '<set JTD_DEBUG_SIGN=true>',
    sign: rebuilt.headers['X-AI-Sign'],
    app_id: config.appId,
    app_secret_masked: maskSecret(config.appSecret),
  };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function isBusinessSuccess(data) {
  const code = data?.code ?? data?.status;
  if (code === undefined || code === null) return true;
  return code === 0 || code === 200 || code === '0' || code === '200' || code === 'success';
}

function businessError(data) {
  return isBusinessSuccess(data) ? null : `business_${data?.code ?? data?.status ?? 'error'}`;
}

function isSignError(result) {
  return result.httpStatus === 401
    || result.httpStatus === 403
    || result.business_code === 40002
    || result.business_code === '40002';
}

function isRetryable(result) {
  if (['network_timeout', 'network_error'].includes(result.error)) return true;
  return result.httpStatus === 408 || result.httpStatus === 429 || (result.httpStatus >= 500 && result.httpStatus < 600);
}

function appendQuery(path, payload) {
  const params = new URLSearchParams();
  Object.entries(payload || {})
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function maskSecret(secret = '') {
  const value = String(secret);
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
