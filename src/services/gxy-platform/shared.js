// src/services/gxy-platform/shared.js
/**
 * GXY 平台共享工具：信封解析、错误码、ID 生成、服务类型推断。
 * 移植自 AI对接包-v3 各 service 文件中的公共函数。
 */

import crypto from 'node:crypto';
import { recordDegrade } from '../../core/observability/degradation-monitor.js';

export const CODE_OK = 'OK';

export function ok(data, message = '操作成功') {
  return { code: CODE_OK, message, data };
}

export function err(code, message) {
  if (code && code !== CODE_OK && code !== 'FIELD_INVALID') {
    recordDegrade('gxy_soft_err', { detail: `${code}: ${message || ''}` });
  }
  return { code, message, data: null };
}

/**
 * 把 GXY SDK 返回的 { ok, status, data } 包装为统一信封 { code, message, data }。
 * 平台返回体兼容两种格式：
 *   - { success: true, result: ... }  → 取 result
 *   - { code: 0, data: ... }          → 取 data
 */
export function toPlatformResult(resp, okMessage) {
  if (resp?.ok) {
    const body = resp.data;
    const result = (body && typeof body === 'object')
      ? (body.result ?? body.data ?? body)
      : body;
    return {
      ...ok(result, okMessage),
      method: resp.method,
      url: resp.url,
      http_status: resp.http_status ?? resp.status,
    };
  }
  const data = resp?.data;
  const message = (data && typeof data === 'object')
    ? (data.message || '调用桂小养平台失败')
    : String(data || '调用桂小养平台失败');
  return {
    ...err('PLATFORM_ERROR', message),
    method: resp?.method,
    url: resp?.url,
    http_status: resp?.http_status ?? resp?.status,
    error: message,
  };
}

/**
 * 生成订单号：GD + 时间戳 + 6 位随机数。
 */
export function generateOrderNo() {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = crypto.randomInt(100000, 999999);
  return `GD${ts}${rand}`;
}

/**
 * 生成工单号：GXWO + 时间戳 + 6 位随机数。
 */
export function generateWorkOrderNo() {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = crypto.randomInt(100000, 999999);
  return `GXWO${ts}${rand}`;
}

/**
 * 按服务项目名称推断 serviceType。
 */
export function inferServiceType(itemName) {
  const name = String(itemName || '');
  if (/网格|巡查|巡访/.test(name)) return 'grid';
  if (/村医|医生/.test(name)) return 'doctor';
  return 'nurse';
}
