/**
 * 桂小养第三方消息 SDK (ES Module)
 *
 * 供第三方系统导入，一行代码发送消息到桂小养。
 *
 * 签名方式: 与 Java HmacSignatureUtils 逐行对齐
 *   1. body做SHA-256摘要 → 十六进制小写
 *   2. 拼接: method + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + bodySha256
 *   3. HMAC-SHA256(密钥, 签名串) → Base64
 *
 * 使用方式:
 *   import GxyMessage from './gxy-message-sdk.js';
 *
 *   GxyMessage.init({
 *     secret:  'sign_U9IAnIMAFv',
 *     apiUrl:  'https://smart-auth.yunxida.com',
 *   });
 *
 *   const result = await GxyMessage.send({
 *     userId:   '8BA383479A1D41E0A74EBB41E6AD0111',
 *     message:  '您有新的待办任务需要处理',
 *     category: '待办',
 *     url:      'https://xxx/detail?id=123',
 *   });
 */

import { generateSignatureHeaders, sha256, hmacSha256, checkTimestamp, generateNonce, verify, sign } from './lib/hmac-signature.js';

// ─── 默认配置 ──────────────────────────────────────────────────

const DEFAULTS = {
  secret:  'sign_U9IAnIMAFv',
  apiUrl:  'https://smart-auth.yunxida.com',
  apiPath: '/api-ent-app/open/thirdPartySendMessage',
  method:  'POST',
  path:    null,  // 对齐Java: path=null → 拼接产生字面量 "null"
  timeout: 10000, // 请求超时 ms
};

// ─── 内部状态 ──────────────────────────────────────────────────

let _config = { ...DEFAULTS };

// ─── 公开方法 ──────────────────────────────────────────────────

/**
 * 初始化 SDK（整个应用只需调用一次）
 *
 * @param {Object} config
 * @param {string} config.secret   - HMAC-SHA256 签名密钥
 * @param {string} config.apiUrl   - API 服务基础地址
 * @param {string} [config.apiPath] - 接口路径（默认 /api-ent-app/open/thirdPartySendMessage）
 * @param {number} [config.timeout] - 请求超时 ms（默认 10000）
 */
export function init(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('init() 参数必须是对象: { secret, apiUrl }');
  }
  if (!config.secret) throw new Error('缺少 secret 参数');
  if (!config.apiUrl) throw new Error('缺少 apiUrl 参数');
  _config = { ...DEFAULTS, ...config };
}

/**
 * 发送第三方消息
 *
 * 自动完成：构建 body → 签名 → 发送请求 → 返回结果
 *
 * @param {Object} payload
 * @param {string} payload.userId   - 统一认证用户ID（必填）
 * @param {string} payload.message  - 消息内容（必填）
 * @param {string} [payload.category] - 消息分类（可选）
 * @param {string} [payload.url]      - 跳转URL（可选）
 * @param {string} [payload.tenantId] - 租户ID（可选，不填自动生成）
 * @returns {Promise<{ok: boolean, status: number, data: object, signature: string, timestamp: string, nonce: string}>}
 */
export async function send(payload) {
  if (!payload || !payload.userId || !payload.message) {
    throw new Error('send() 缺少必填字段: userId, message');
  }

  // 构建 body（对齐Java FastJSON: 移除 null/undefined 字段）
  const bodyPayload = buildBody(payload);
  const bodyJson = JSON.stringify(bodyPayload);

  // 签名
  const signInfo = generateSignatureHeaders({
    secret: _config.secret,
    method: _config.method,
    path:   _config.path,
    body:   bodyJson,
  });

  // 发送请求
  const fullUrl = _config.apiUrl + _config.apiPath;
  const result = await httpRequest(fullUrl, {
    method:  _config.method,
    headers: signInfo.headers,
    body:    bodyJson,
    timeout: _config.timeout,
  });

  const isSuccess = result.status === 200
    && result.data
    && (result.data.success === true || result.data.code === '0000');

  return {
    ok:        isSuccess,
    status:    result.status,
    data:      result.data,
    signature: signInfo.signature,
    signContent: signInfo.signContent,
    bodySha256:  signInfo.bodySha256,
    timestamp: signInfo.timestamp,
    nonce:     signInfo.nonce,
    bodyJson:  bodyJson,
  };
}

/**
 * 仅签名不发请求（调试用）
 *
 * @param {Object} payload - 同 send() 的 payload
 * @returns {{ signature: string, signContent: string, bodySha256: string, timestamp: string, nonce: string, headers: Object, bodyJson: string }}
 */
export function signOnly(payload) {
  const bodyPayload = buildBody(payload || {});
  const bodyJson = JSON.stringify(bodyPayload);

  return {
    ...generateSignatureHeaders({
      secret: _config.secret,
      method: _config.method,
      path:   _config.path,
      body:   bodyJson,
    }),
    bodyJson,
  };
}

/**
 * 获取当前配置（只读副本）
 *
 * @returns {Object} 当前配置
 */
export function getConfig() {
  return { ..._config };
}

// ─── 内部方法 ──────────────────────────────────────────────────

/**
 * 构建 body，移除 null/undefined 字段（对齐 Java FastJSON 默认行为）
 */
function buildBody(payload) {
  const result = {};
  Object.keys(payload).forEach(k => {
    const v = payload[k];
    if (v !== null && v !== undefined && v !== '') {
      result[k] = v;
    }
  });
  return result;
}

/**
 * HTTP 请求封装
 */
function httpRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port || (isHttps ? 443 : 80),
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   options.method || 'POST',
      headers:  options.headers || {},
      timeout:  options.timeout || 10000,
    };

    const req = httpModule.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, data: parsed, raw: data });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时 (' + reqOptions.timeout + 'ms)'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── 导出 ──────────────────────────────────────────────────────

export default {
  init,
  send,
  signOnly,
  getConfig,
  // 低级 API（直接暴露签名工具，供高级场景使用）
  sign,
  verify,
  sha256,
  hmacSha256,
  checkTimestamp,
  generateNonce,
  generateSignatureHeaders,
};