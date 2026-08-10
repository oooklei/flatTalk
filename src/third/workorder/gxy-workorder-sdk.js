/**
 * 桂小养工单管理 SDK (ES Module)
 *
 * 覆盖工单全生命周期：同步/查询/分页/取消/执行进度/时间轴
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

/** 工单状态 */
export const WORK_ORDER_STATUS = {
  PENDING:    'pending',
  ACCEPTED:   'accepted',
  IN_PROGRESS:'in_progress',
  COMPLETED:  'completed',
  CANCELLED:  'cancelled',
  FROZEN:     'frozen',
};

/** 工单类型 */
export const WORK_ORDER_TYPE = {
  NURSE:     'nurse',
  DOCTOR:    'doctor',
  FOLLOWUP:  'followup',
  ASSESSMENT:'assessment',
};

/** 服务类型 */
export const SERVICE_TYPE = {
  NURSE:  'nurse',
  GRID:   'grid',
  DOCTOR: 'doctor',
};

/** 派单模式 */
export const DISPATCH_MODE = {
  SMART:    'smart',
  MANUAL:   'manual',
  TRANSFER: 'transfer',
};

/** 签到方式 */
export const CHECK_IN_TYPE = {
  SCAN: 'scan',
  GPS:  'gps',
};

/** 紧急级别 */
export const URGENCY_LEVEL = {
  RED:    'red',
  YELLOW: 'yellow',
  GREEN:  'green',
};

// ─── 内部状态 ──────────────────────────────────────────────────

let _config = { ...DEFAULTS };

// ─── 公开方法 ──────────────────────────────────────────────────

export function init(config) {
  if (!config || !config.secret) throw new Error('缺少 secret 参数');
  _config = { ...DEFAULTS, ...config };
}

export async function sync(payload) {
  if (!payload?.orderNo) throw new Error('sync() 缺少必填字段: orderNo');
  if (!payload?.staffId) throw new Error('sync() 缺少必填字段: staffId');
  return post('/openapi/workorder/sync', payload);
}

export async function getDetail(workOrderId) {
  if (!workOrderId) throw new Error('getDetail() 缺少 workOrderId');
  return get('/openapi/workorder/detail', { workOrderId });
}

export async function page(payload) {
  if (!payload?.elderId) throw new Error('page() 缺少必填字段: elderId');
  return post('/openapi/workorder/page', payload);
}

export async function cancel(payload) {
  if (!payload?.workOrderId) throw new Error('cancel() 缺少必填字段: workOrderId');
  return post('/openapi/workorder/cancel', payload);
}

export async function getProgress(workOrderId) {
  if (!workOrderId) throw new Error('getProgress() 缺少 workOrderId');
  return get('/openapi/workorder/progress', { workOrderId });
}

export async function getTimeline(workOrderId) {
  if (!workOrderId) throw new Error('getTimeline() 缺少 workOrderId');
  return get('/openapi/workorder/timeline', { workOrderId });
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
  getProgress,
  getTimeline,
  getConfig,
  CATEGORY,
  WORK_ORDER_STATUS,
  WORK_ORDER_TYPE,
  SERVICE_TYPE,
  DISPATCH_MODE,
  CHECK_IN_TYPE,
  URGENCY_LEVEL,
};