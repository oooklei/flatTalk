// src/third/gxy/base-client.js
/**
 * GXY 平台 HTTP 客户端基类。
 * 复用 src/third/lib/hmac-signature.js 的签名能力。
 * 提取自 gxy-order-sdk.js 的 post/get/wrapResult/buildBody 模式。
 */

import { generateSignatureHeaders } from '../lib/hmac-signature.js';

const DEFAULTS = {
  secret:  process.env.GXY_API_SECRET  || 'sign_U9IAnIMAFv',
  apiUrl:  process.env.GXY_API_URL     || 'https://aiyl-m.yunxida.com/backend-api/portal-api',
  timeout: 10000,
  signMethod: 'POST',
  signPath:   null,
};

/**
 * 创建一个 GXY 平台客户端实例。
 * @param {object} [config] - 覆盖默认配置
 * @returns {{ post, get, getUnsigned, config }}
 */
export function createGxyClient(config = {}) {
  const cfg = { ...DEFAULTS, ...config };

  async function post(path, payload) {
    const bodyPayload = buildBody(payload);
    const bodyJson = JSON.stringify(bodyPayload);
    const signInfo = generateSignatureHeaders({
      secret: cfg.secret,
      method: cfg.signMethod,
      path:   cfg.signPath,
      body:   bodyJson,
    });
    const result = await httpRequest(cfg.apiUrl + path, {
      method:  'POST',
      headers: signInfo.headers,
      body:    bodyJson,
      timeout: cfg.timeout,
    });
    return wrapResult(result);
  }

  async function get(path, params) {
    const qs = Object.keys(params || {})
      .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    const fullUrl = cfg.apiUrl + path + (qs ? '?' + qs : '');
    const signInfo = generateSignatureHeaders({
      secret: cfg.secret,
      method: 'GET',
      path:   cfg.signPath,
      body:   null,
    });
    const result = await httpRequest(fullUrl, {
      method:  'GET',
      headers: signInfo.headers,
      body:    null,
      timeout: cfg.timeout,
    });
    return wrapResult(result);
  }

  /**
   * 无签名 GET（用于白名单公开接口如 serviceItem）
   */
  async function getUnsigned(path, params) {
    const qs = Object.keys(params || {})
      .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    const fullUrl = cfg.apiUrl + path + (qs ? '?' + qs : '');
    const result = await httpRequest(fullUrl, {
      method:  'GET',
      headers: { Accept: 'application/json' },
      body:    null,
      timeout: cfg.timeout,
    });
    return wrapResult(result);
  }

  return { post, get, getUnsigned, config: cfg };
}

function buildBody(payload) {
  const result = {};
  Object.keys(payload || {}).forEach(k => {
    const v = payload[k];
    if (v !== null && v !== undefined && v !== '') {
      result[k] = v;
    }
  });
  return result;
}

function wrapResult(result) {
  const isSuccess = result.status === 200
    && result.data
    && (result.data.success === true || result.data.code === 0 || result.data.code === 200);
  return { ok: isSuccess, status: result.status, data: result.data };
}

function httpRequest(url, options) {
  return new Promise((resolve, reject) => {
    import('node:http').then(http => {
      import('node:https').then(https => {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        const reqOptions = {
          hostname: parsedUrl.hostname,
          port:     parsedUrl.port || (isHttps ? 443 : 80),
          path:     parsedUrl.pathname + parsedUrl.search,
          method:   options.method || 'GET',
          headers:  options.headers || {},
          timeout:  options.timeout || 10000,
        };
        const req = httpModule.request(reqOptions, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            let data;
            try { data = JSON.parse(body); } catch { data = body; }
            resolve({ status: res.statusCode, data });
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (options.body) req.write(options.body);
        req.end();
      });
    });
  });
}
