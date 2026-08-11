// src/services/gxy-platform/order-service.js
/**
 * 订单服务：同步/查询/分页/取消/评价/时间轴。
 * 移植自 AI对接包-v3/backend/app/services/order_service.py
 *
 * 复用已有的 src/third/order/gxy-order-sdk.js（端点一致，已验证可用）。
 * 本文件覆写 src/services/order/order-service.js（当前 write 方法零调用点）。
 */

import * as gxyOrderSdk from '../../third/order/gxy-order-sdk.js';
import { err, toPlatformResult, generateOrderNo } from './shared.js';

/**
 * 同步订单（创建/更新）。orderNo 缺省时自动生成，保证幂等。
 */
export async function syncOrder(payload = {}) {
  if (!payload.elderId) {
    return err('FIELD_INVALID', '老人ID(elderId)不能为空');
  }
  if (!payload.orderNo) {
    payload = { ...payload, orderNo: generateOrderNo() };
  }
  try {
    const resp = await gxyOrderSdk.sync(payload);
    return toPlatformResult(resp, '订单同步成功');
  } catch (e) {
    return err('PLATFORM_ERROR', e.message);
  }
}

export async function getOrderDetail(orderId) {
  if (!orderId) {
    return err('FIELD_INVALID', '订单ID(orderId)不能为空');
  }
  try {
    const resp = await gxyOrderSdk.getDetail(orderId);
    return toPlatformResult(resp, '查询订单详情成功');
  } catch (e) {
    return err('PLATFORM_ERROR', e.message);
  }
}

export async function getOrderPage(payload = {}) {
  try {
    const resp = await gxyOrderSdk.page(payload);
    return toPlatformResult(resp, '查询订单列表成功');
  } catch (e) {
    return err('PLATFORM_ERROR', e.message);
  }
}

export async function cancelOrder(orderId, reason = '') {
  if (!orderId) {
    return err('FIELD_INVALID', '订单ID(orderId)不能为空');
  }
  try {
    const resp = await gxyOrderSdk.cancel({ orderId, cancelReason: reason });
    return toPlatformResult(resp, '订单取消成功');
  } catch (e) {
    return err('PLATFORM_ERROR', e.message);
  }
}

export async function evaluateOrder(orderId, rating, evaluateContent = '', tags = null) {
  if (!orderId) {
    return err('FIELD_INVALID', '订单ID(orderId)不能为空');
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return err('FIELD_INVALID', '评分必须为 1-5');
  }
  if (tags && tags.length > 10) {
    return err('FIELD_INVALID', '评价标签最多 10 个');
  }
  try {
    const resp = await gxyOrderSdk.evaluate({ orderId, rating, evaluateContent, evaluateTags: tags });
    return toPlatformResult(resp, '订单评价成功');
  } catch (e) {
    return err('PLATFORM_ERROR', e.message);
  }
}

export async function getOrderTimeline(orderId) {
  if (!orderId) {
    return err('FIELD_INVALID', '订单ID(orderId)不能为空');
  }
  try {
    const resp = await gxyOrderSdk.getTimeline(orderId);
    return toPlatformResult(resp, '查询订单时间轴成功');
  } catch (e) {
    return err('PLATFORM_ERROR', e.message);
  }
}
