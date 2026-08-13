/**
 * HMAC-SHA256 签名工具类 (Node.js 版本)
 *
 * 与 Java 版本 HmacSignatureUtils 逐行对齐：
 *
 *   签名流程（3步）：
 *     1. body做SHA-256摘要 → 十六进制小写字符串（body为null/空时返回空串""）
 *     2. 拼接签名串: method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + bodySha256
 *     3. HMAC-SHA256(密钥, 签名串) → Base64编码
 *
 *   请求头：
 *     X-Timestamp : 毫秒级时间戳
 *     X-Nonce     : 随机字符串，防重放
 *     X-Signature : 签名值
 *
 *   密钥: sign_U9IAnIMAFv
 *   时间戳容差: 5分钟
 */

const crypto = require('crypto');

// ─── 常量（对齐 Java HmacSignatureUtils） ──────────────────────────────────────

const HEADER_TIMESTAMP = 'X-Timestamp';
const HEADER_NONCE = 'X-Nonce';
const HEADER_SIGNATURE = 'X-Signature';
const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

// ─── 核心签名方法（与Java逐行对齐） ──────────────────────────────────────────────

/**
 * SHA-256摘要，返回十六进制小写字符串。
 * 【对齐Java第186-201行】
 *   - data为null或空 → 返回 ""（空串，不是hash("")）
 *   - 非空 → 返回64位十六进制小写
 */
function sha256(data) {
  // 对齐 Java: if (data == null || data.isEmpty()) { return ""; }
  if (!data || data.length === 0) return '';
  // 对齐 Java: MessageDigest.getInstance("SHA-256") → hex lowercase
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * HMAC-SHA256签名，返回Base64编码。
 * 【对齐Java第168-178行】
 */
function hmacSha256(secret, data) {
  // 对齐 Java: Mac.getInstance("HmacSHA256") → Base64
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('base64');
}

/**
 * 生成签名（与Java HmacSignatureUtils.sign() 逐行对齐）
 *
 * @param {string}      secret    - 签名密钥 "sign_U9IAnIMAFv"
 * @param {string}      method    - HTTP方法 "POST"
 * @param {string|null} path      - null（Java拼接产生字面量"null"）
 * @param {string}      timestamp - 毫秒时间戳
 * @param {string}      nonce     - 随机字符串
 * @param {string|null} body      - 请求体JSON字符串
 * @returns {string} Base64签名
 */
function sign(secret, method, path, timestamp, nonce, body) {
  // 对齐 Java第82行: String bodySha256 = sha256(body == null ? "" : body);
  const bodySha256 = sha256(body === null ? '' : body);
  // 对齐 Java第83行: String signContent = method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + bodySha256;
  const signContent = method + '\n' + path + '\n' + timestamp + '\n' + nonce + '\n' + bodySha256;
  // 对齐 Java第84行: return hmacSha256(secret, signContent);
  return hmacSha256(secret, signContent);
}

/**
 * 验证签名（与Java HmacSignatureUtils.verify() 对齐）
 */
function verify(secret, method, path, timestamp, nonce, body, signature) {
  const expected = sign(secret, method, path, timestamp, nonce, body);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * 检查时间戳是否在有效期内（与Java checkTimestamp对齐）
 */
function checkTimestamp(timestamp, toleranceMs = DEFAULT_TOLERANCE_MS) {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  return Math.abs(Date.now() - ts) <= toleranceMs;
}

/**
 * 生成随机nonce（对齐Java IdUtil.simpleUUID()：32位十六进制）
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 一站式生成签名请求头
 *
 * @param {Object} params
 * @param {string} params.secret    - 签名密钥
 * @param {string} params.method    - HTTP方法
 * @param {string|null} params.path - 请求路径（传null，与Java对齐）
 * @param {string|null} params.body - 请求体JSON字符串
 * @returns {{ signature: string, signContent: string, bodySha256: string, timestamp: string, nonce: string, headers: Object }}
 */
function generateSignatureHeaders({ secret, method = 'POST', path = null, body = null }) {
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  const bodySha256 = sha256(body === null ? '' : body);
  const signContent = method + '\n' + path + '\n' + timestamp + '\n' + nonce + '\n' + bodySha256;
  const signature = hmacSha256(secret, signContent);

  return {
    signature,
    signContent,
    bodySha256,
    timestamp,
    nonce,
    headers: {
      'Content-Type': 'application/json',
      [HEADER_TIMESTAMP]: timestamp,
      [HEADER_NONCE]: nonce,
      [HEADER_SIGNATURE]: signature,
    },
  };
}

module.exports = {
  sign,
  verify,
  sha256,
  hmacSha256,
  checkTimestamp,
  generateNonce,
  generateSignatureHeaders,
  HEADER_TIMESTAMP,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  DEFAULT_TOLERANCE_MS,
};
