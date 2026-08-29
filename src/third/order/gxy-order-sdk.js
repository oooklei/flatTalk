/**
 * 桂小养订单管理 SDK (ES Module)
 *
 * 覆盖订单全生命周期：同步/查询/分页/取消/评价/时间轴
 */

import { generateSignatureHeaders } from '../lib/hmac-signature.js';

// ─── 默认配置 ──────────────────────────────────────────────────

const DEFAULTS = {
  secret:  'sign_U9IAnIMAFv',
  apiUrl:  'https://aiyl-m.yunxida.com/backend-api/portal-api',
  timeout: 10000,
  signMethod: 'POST',
  signPath:   null,
};

// ─── 枚举常量 ──────────────────────────────────────────────────

/** 业务分类 */
export const CATEGORY = {
  INPATIENT_NURSE:  'inpatient_nurse',
  DOORSTEP_NURSE:   'doorstep_nurse',
  PATROL_TASK:      'patrol_task',
  MEDICINE_DELIVERY:'medicine_delivery',
  CHRONIC_FOLLOWUP: 'chronic_followup',
  HEALTH_ASSESSMENT:'health_assessment',
  FOLLOWUP:         'followup',
  DEVICE_ALARM:     'device_alarm',
  SOS:              'sos',
};

/** 紧急级别 */
export const URGENCY_LEVEL = {
  RED:    'red',
  YELLOW: 'yellow',
  GREEN:  'green',
};

/** 派单模式 */
export const DISPATCH_MODE = {
  SMART:    'smart',
  MANUAL:   'manual',
  TRANSFER: 'transfer',
};

/** 订单来源 */
export const ORDER_SOURCE = {
  ORG_BOOKING:   '机构代预约',
  CLIENT_BOOKING:'客户端预约',
  CLIENT_ALARM:  '客户端预警',
  IOT_ALARM:     'IOT设备预警',
  GOV_BOOKING:   '监管代预约',
};

// ─── 内部状态 ──────────────────────────────────────────────────

let _config = { ...DEFAULTS };

// ─── 公开方法 ──────────────────────────────────────────────────

export function init(config) {
  if (!config || !config.secret) throw new Error('缺少 secret 参数');
  _config = { ...DEFAULTS, ...config };
}

export async function sync(payload) {
  if (!payload?.category) throw new Error('sync() 缺少必填字段: category');
  return post('/openapi/order/sync', payload);
}

export async function getDetail(orderId) {
  if (!orderId) throw new Error('getDetail() 缺少 orderId');
  return get('/openapi/order/detail', { orderId });
}

export async function page(payload) {
  if (!payload?.elderId) throw new Error('page() 缺少必填字段: elderId');
  return post('/openapi/order/page', payload);
}

export async function cancel(payload) {
  if (!payload?.orderId) throw new Error('cancel() 缺少必填字段: orderId');
  return post('/openapi/order/cancel', payload);
}

export async function evaluate(payload) {
  if (!payload?.orderId || !payload?.rating) throw new Error('evaluate() 缺少必填字段: orderId, rating');
  return post('/openapi/order/evaluate', payload);
}

export async function getTimeline(orderId) {
  if (!orderId) throw new Error('getTimeline() 缺少 orderId');
  return get('/openapi/order/timeline', { orderId });
}

export function getConfig() {
  return { ..._config };
}

// ─── 内部方法 ──────────────────────────────────────────────────

async function post(path, payload) {
  const bodyPayload = buildBody(payload);
  const bodyJson = JSON.stringify(bodyPayload);

  const signInfo = generateSignatureHeaders({
    secret: _config.secret,
    method: _config.signMethod,
    path:   _config.signPath,
    body:   bodyJson,
  });

  const result = await httpRequest(_config.apiUrl + path, {
    method:  'POST',
    headers: signInfo.headers,
    body:    bodyJson,
    timeout: _config.timeout,
  });

  return wrapResult(result);
}

async function get(path, params) {
  const qs = Object.keys(params || {})
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const fullUrl = _config.apiUrl + path + (qs ? '?' + qs : '');

  const signInfo = generateSignatureHeaders({
    secret: _config.secret,
    method: 'GET',
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

function wrapResult(result) {
  const isSuccess = result.status === 200
    && result.data
    && (result.data.success === true || result.data.code === 0 || result.data.code === 200);

  return { ok: isSuccess, status: result.status, data: result.data };
}

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
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            let parsed;
            try { parsed = JSON.parse(data); } catch { parsed = data; }
            resolve({ status: res.statusCode, data: parsed, raw: data });
          });
        });

        req.on('error', (err) => reject(new Error('请求失败: ' + err.message)));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('请求超时 (' + reqOptions.timeout + 'ms): ' + url));
        });

        if (options.body) req.write(options.body);
        req.end();
      });
    });
  });
}

// ─── 导出 ──────────────────────────────────────────────────────

export default {
  init,
  sync,
  getDetail,
  page,
  cancel,
  evaluate,
  getTimeline,
  getConfig,
  CATEGORY,
  URGENCY_LEVEL,
  DISPATCH_MODE,
  ORDER_SOURCE,
};