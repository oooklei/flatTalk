/**
 * HMAC-SHA256 签名验证中间件
 *
 * 用于验证外部系统的 API 请求签名
 *
 * 使用方式:
 *   import { hmacAuthMiddleware } from './middleware/hmac-auth.js';
 *
 *   // 应用到特定路由
 *   app.use('/api/open', hmacAuthMiddleware({ secret: process.env.GXY_HMAC_SECRET }));
 */

import { verify, checkTimestamp } from '../third/lib/hmac-signature.js';

/**
 * HMAC 签名验证中间件
 *
 * @param {Object} options
 * @param {string} options.secret - HMAC-SHA256 签名密钥
 * @param {number} [options.toleranceMs] - 时间戳容差（默认 5 分钟）
 * @param {string[]} [options.skipPaths] - 跳过验证的路径
 * @returns {Function} Express 风格中间件
 */
export function hmacAuthMiddleware(options = {}) {
  const {
    secret = process.env.GXY_HMAC_SECRET || 'sign_U9IAnIMAFv',
    toleranceMs = 5 * 60 * 1000,
    skipPaths = [],
  } = options;

  return async (req, res, next) => {
    const path = req.url?.pathname || req.url || '/';

    // 跳过指定路径
    if (skipPaths.some(p => path.startsWith(p))) {
      return next();
    }

    // 获取签名头
    const timestamp = req.headers['x-timestamp'];
    const nonce = req.headers['x-nonce'];
    const signature = req.headers['x-signature'];

    if (!timestamp || !nonce || !signature) {
      return res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: false,
        error: 'missing_signature_headers',
        message: '缺少签名头: X-Timestamp, X-Nonce, X-Signature',
      }));
    }

    // 检查时间戳
    if (!checkTimestamp(timestamp, toleranceMs)) {
      return res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: false,
        error: 'expired_timestamp',
        message: '时间戳已过期',
      }));
    }

    // 读取请求体
    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', () => resolve(null));
      });
    }

    // 验证签名
    const method = req.method || 'POST';
    const signPath = null; // 对齐 Java: path = null

    const isValid = verify(secret, method, signPath, timestamp, nonce, body, signature);

    if (!isValid) {
      return res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: false,
        error: 'invalid_signature',
        message: '签名验证失败',
      }));
    }

    // 签名验证通过，继续处理请求
    next();
  };
}

/**
 * 生成签名响应头（用于发起请求）
 *
 * @param {Object} options
 * @param {string} options.secret - HMAC-SHA256 签名密钥
 * @param {string} options.method - HTTP 方法
 * @param {string|null} options.body - 请求体 JSON 字符串
 * @returns {Object} 签名头 { 'X-Timestamp': ..., 'X-Nonce': ..., 'X-Signature': ... }
 */
export function generateAuthHeaders(options = {}) {
  const { secret = process.env.GXY_HMAC_SECRET || 'sign_U9IAnIMAFv', method = 'POST', body = null } = options;
  const { generateSignatureHeaders } = await import('../third/lib/hmac-signature.js');
  return generateSignatureHeaders({ secret, method, path: null, body }).headers;
}

export default { hmacAuthMiddleware, generateAuthHeaders };