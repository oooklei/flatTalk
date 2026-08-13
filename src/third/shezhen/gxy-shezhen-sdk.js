/**
 * 桂小养舌诊报告 SDK (Node.js)
 *
 * 供第三方系统 require 引入，查询云诊科技检测报告。
 *
 * 认证方式: 与 gxy-message-sdk 一致，HMAC-SHA256 签名
 *   1. GET请求无body，SHA-256(body) = 空串""
 *   2. 拼接: method + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + bodySha256
 *   3. HMAC-SHA256(密钥, 签名串) → Base64
 *
 * 使用方式:
 *   const GxyShezhen = require('./gxy-shezhen-sdk');
 *
 *   GxyShezhen.init({
 *     secret:  'sign_U9IAnIMAFv',
 *   });
 *
 *   // 分页查询检测报告
 *   const result = await GxyShezhen.getReports({ userId: 'user001' });
 *
 *   // 查询第2页
 *   const page2 = await GxyShezhen.getReports({ userId: 'user001', pageNo: 2, pageSize: 20 });
 */

const http = require('http');
const https = require('https');
const {
  sign,
  verify,
  sha256,
  hmacSha256,
  checkTimestamp,
  generateNonce,
  generateSignatureHeaders,
} = require('./lib/hmac-signature');

// ─── 默认配置 ──────────────────────────────────────────────────

const DEFAULTS = {
  secret:  'sign_U9IAnIMAFv',
  apiUrl:  'https://aiyl-m.yunxida.com/backend-api/portal-api',
  timeout: 10000,
  // 签名参数（对齐Java: path=null → 拼接产生字面量 "null"）
  signMethod: 'GET',
  signPath:   null,
};

// ─── 枚举常量 ──────────────────────────────────────────────────

/** 响应类型（returnType） */
const RETURN_TYPE = {
  SUCCESS:     1,  // 检测成功
  FAILED:      2,  // 检测失败
  PDF_GENERATED: 3, // PDF已生成
};

/** 性别（sex） */
const SEX = {
  MALE:   1,  // 男
  FEMALE: 2,  // 女
};

/** 检测是否完成（checkCompleted） */
const CHECK_COMPLETED = {
  NO:  0,  // 未完成
  YES: 1,  // 已完成
};

/** 检测状态（checkState） */
const CHECK_STATE = {
  NORMAL: 1,  // 正常
};

/** 逻辑删除标识（deleted） */
const DELETED = {
  NOT_DELETED: 0,  // 未删除
  DELETED:     1,  // 已删除
};

// ─── 内部状态 ──────────────────────────────────────────────────

let _config = { ...DEFAULTS };

// ─── 公开方法 ──────────────────────────────────────────────────

/**
 * 初始化 SDK（整个应用只需调用一次）
 *
 * @param {Object} config
 * @param {string} config.secret   - HMAC-SHA256 签名密钥
 * @param {string} [config.apiUrl] - API 服务基础地址（有默认值）
 * @param {number} [config.timeout] - 请求超时 ms（默认 10000）
 */
function init(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('init() 参数必须是对象: { secret, apiUrl }');
  }
  if (!config.secret) throw new Error('缺少 secret 参数');
  _config = { ...DEFAULTS, ...config };
}

/**
 * 分页查询用户的检测报告列表
 *
 * 接口: GET /openapi/shezhen/reports
 * 响应类型 returnType：1-检测成功 2-检测失败 3-PDF已生成
 *
 * @param {Object} params
 * @param {string} params.userId   - 第三方用户唯一标识（必填）
 * @param {number} [params.pageNo] - 页码（默认1）
 * @param {number} [params.pageSize] - 每页条数（默认10）
 * @returns {Promise<{ok:boolean, status:number, data:object}>}
 *   data.result 包含:
 *     records[]  - 报告列表（YunzhenCheckReport）
 *     total      - 总记录数
 *     size       - 每页条数
 *     current    - 当前页码
 *     pages      - 总页数
 */
async function getReports(params) {
  if (!params || !params.userId) {
    throw new Error('getReports() 缺少必填字段: userId');
  }
  return get('/openapi/shezhen/reports', {
    userId:   params.userId,
    pageNo:   params.pageNo   || 1,
    pageSize: params.pageSize || 10,
  });
}

/**
 * 获取当前配置（只读副本）
 */
function getConfig() {
  return { ..._config };
}

// ─── 内部方法 ──────────────────────────────────────────────────

/**
 * GET 请求（自动签名，无 body）
 */
async function get(path, params) {
  // 拼接 query string
  const qs = Object.keys(params || {})
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const fullUrl = _config.apiUrl + path + (qs ? '?' + qs : '');

  // GET 请求无 body，签名时 body=null
  const signInfo = generateSignatureHeaders({
    secret: _config.secret,
    method: _config.signMethod,
    path:   _config.signPath,
    body:   null,
  });

  const result = await httpRequest(fullUrl, {
    method:  'GET',
    headers: signInfo.headers,
    body:    null,
    timeout: _config.timeout,
  });

  return wrapResult(result);
}

/**
 * 统一包装返回结果
 */
function wrapResult(result) {
  const isSuccess = result.status === 200
    && result.data
    && (result.data.success === true || result.data.code === 200);

  return {
    ok:     isSuccess,
    status: result.status,
    data:   result.data,
  };
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
      method:   options.method || 'GET',
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

    req.on('error', (err) => reject(new Error('请求失败: ' + (err.message || err.code || err.toString()))));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时 (' + reqOptions.timeout + 'ms): ' + url));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── 导出 ──────────────────────────────────────────────────────

module.exports = {
  init,
  getReports,
  getConfig,
  // 枚举常量
  RETURN_TYPE,
  SEX,
  CHECK_COMPLETED,
  CHECK_STATE,
  DELETED,
  // 低级 API
  sign,
  verify,
  sha256,
  hmacSha256,
  checkTimestamp,
  generateNonce,
  generateSignatureHeaders,
};
