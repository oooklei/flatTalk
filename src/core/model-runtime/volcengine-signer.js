// 火山引擎 V4 签名器（HMAC-SHA256）
// 参考火山引擎官方签名规范：https://www.volcengine.com/docs/6369/67269
// 用于通过 AK/SK 直接调用 Ark API（豆包模型），无需创建 Ark API Key。
import crypto from 'node:crypto';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key, msg, asHex = false) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest(asHex ? 'hex' : undefined);
}

// 派生签名密钥：SecretKey → Date → Region → Service → 'request'
// 火山引擎 V4 规范：kDate=HMAC(SecretKey, Date), kRegion=HMAC(kDate, Region)...
function deriveSigningKey(secretKey, dateShort, region, service) {
  const kDate = hmacSha256(secretKey, dateShort);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'request');
}

/**
 * 为火山引擎 Ark API 生成 V4 签名请求头。
 * 用法：与 fetch 配合，传入 host/path/body 自动生成 Authorization 等头。
 * @param {Object} params
 * @param {string} params.accessKeyId - VOLC_ACCESS_KEY_ID
 * @param {string} params.secretAccessKey - VOLC_SECRET_ACCESS_KEY
 * @param {string} [params.region='cn-beijing'] - 区域
 * @param {string} [params.service='ark'] - 服务名（Ark 用 'ark'）
 * @param {string} params.method - HTTP 方法（POST/GET）
 * @param {string} params.url - 完整 URL（含 https:// + host + path + query）
 * @param {string} [params.body=''] - 请求体
 * @param {string} [params.contentType='application/json; charset=utf-8'] - Content-Type
 * @returns {{headers: Object, datetime: string}} 含 Authorization/X-Date/X-Content-Sha256 的请求头
 */
export function signVolcengineRequest({
  accessKeyId,
  secretAccessKey,
  region = 'cn-beijing',
  service = 'ark',
  method = 'POST',
  url,
  body = '',
  contentType = 'application/json; charset=utf-8',
  extraHeaders = {},
}) {
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('VOLC_AK_SK_MISSING: 缺少火山引擎 AK 或 SK');
  }

  const u = new URL(url);
  const host = u.host;
  const path = u.pathname || '/';
  const query = u.search.replace(/^\?/, ''); // 去掉前导 ?

  // 时间戳格式：yyyyMMddTHHmmssZ
  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateShort = datetime.slice(0, 8);

  const hashedBody = sha256Hex(body);

  // Canonical headers（必须按字典序）
  const headers = {
    'content-type': contentType,
    'host': host,
    'x-content-sha256': hashedBody,
    'x-date': datetime,
    ...extraHeaders,
  };
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');

  // 规范请求
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    hashedBody,
  ].join('\n');

  // 待签名字符串
  const credentialScope = `${dateShort}/${region}/${service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    datetime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // 计算签名
  const signingKey = deriveSigningKey(secretAccessKey, dateShort, region, service);
  const signature = hmacSha256(signingKey, stringToSign, true);

  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    datetime,
    headers: {
      'Content-Type': contentType,
      Host: host,
      'X-Date': datetime,
      'X-Content-Sha256': hashedBody,
      Authorization: authorization,
      // 额外头（如 X-Api-Key 等）
      ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k, v])),
    },
  };
}

/**
 * 判断当前模型是否使用火山引擎 AK/SK 签名认证。
 * - provider=volcengine 且未配置 api_key（即 Bearer Token）时启用签名
 * - 环境变量 VOLC_ACCESS_KEY_ID 和 VOLC_SECRET_ACCESS_KEY 都存在才生效
 */
export function isVolcengineAkSkMode(model = {}) {
  if (String(model.provider || '').toLowerCase() !== 'volcengine') return false;
  // 仅当显式声明 auth_mode=volcengine_ak_sk 且 AK/SK 就绪时走 V4 签名；其余走 Bearer
  if (String(model.auth_mode || '').toLowerCase() !== 'volcengine_ak_sk') return false;
  return Boolean(process.env.VOLC_ACCESS_KEY_ID && process.env.VOLC_SECRET_ACCESS_KEY);
}
