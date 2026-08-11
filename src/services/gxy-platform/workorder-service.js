// src/services/gxy-platform/workorder-service.js
/**
 * 工单服务：同步/查询/分页/取消/进度/时间轴。
 * 移植自 AI对接包-v3/backend/app/services/workorder_service.py
 *
 * 复用已有的 src/third/workorder/gxy-workorder-sdk.js。
 * 本文件覆写 src/services/workorder/workorder-service.js。
 */

import * as gxyWorkorderSdk from '../../third/workorder/gxy-workorder-sdk.js';
import { ok, err, toPlatformResult, generateWorkOrderNo } from './shared.js';

export async function syncWorkorder(payload = {}) {
  if (!payload.elderId) {
    return err('FIELD_INVALID', '老人ID(elderId)不能为空');
  }
  if (!payload.workOrderNo) {
    payload = { ...payload, workOrderNo: generateWorkOrderNo() };
  }
  try {
    const resp = await gxyWorkorderSdk.sync(payload);
    return toPlatformResult(resp, '工单同步成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getWorkorderDetail(workOrderId) {
  if (!workOrderId) {
    return err('FIELD_INVALID', '工单ID(workOrderId)不能为空');
  }
  try {
    const resp = await gxyWorkorderSdk.getDetail(workOrderId);
    return toPlatformResult(resp, '查询工单详情成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getWorkorderPage(payload = {}) {
  try {
    const resp = await gxyWorkorderSdk.page(payload);
    return toPlatformResult(resp, '查询工单列表成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function cancelWorkorder(workOrderId, reason = '') {
  if (!workOrderId) {
    return err('FIELD_INVALID', '工单ID(workOrderId)不能为空');
  }
  try {
    const resp = await gxyWorkorderSdk.cancel({ workOrderId, cancelReason: reason });
    return toPlatformResult(resp, '工单取消成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getWorkorderProgress(workOrderId) {
  if (!workOrderId) {
    return err('FIELD_INVALID', '工单ID(workOrderId)不能为空');
  }
  try {
    const resp = await gxyWorkorderSdk.getProgress(workOrderId);
    return toPlatformResult(resp, '查询工单进度成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getWorkorderTimeline(workOrderId) {
  if (!workOrderId) {
    return err('FIELD_INVALID', '工单ID(workOrderId)不能为空');
  }
  try {
    const resp = await gxyWorkorderSdk.getTimeline(workOrderId);
    return toPlatformResult(resp, '查询工单时间轴成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}
