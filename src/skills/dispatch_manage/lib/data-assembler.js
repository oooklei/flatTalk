// src/skills/dispatch_manage/lib/data-assembler.js
/**
 * dispatch_manage 数据装配器。
 * 返回值 shape 对齐 fillDispatchManageCard (model-service.js L2418-2424)：
 *   { dispatch_orders, orders, workers, source }
 */

import {
  getWorkorderPage,
  getWorkorderDetail,
  getWorkorderProgress,
  syncWorkorder,
} from '../../../services/gxy-platform/workorder-service.js';
import { mapWorkorders, extractWorkersFromWorkorders } from './field-mapper.js';
import { validateWorkorder } from './validators.js';

const SOURCE_OK = 'gxy_platform';
const SOURCE_EMPTY = 'gxy_platform_empty';
const SOURCE_ERROR = 'gxy_platform_error';

export async function assembleDispatchData(params = {}) {
  const action = params.action || params.intent || '';
  const handler = ACTION_HANDLERS[action] || ACTION_HANDLERS['dispatch_manage.list'];
  return handler(params);
}

async function assembleDispatchList(params = {}) {
  const { elderId, workOrderId } = params;
  try {
    let resp;
    if (workOrderId) {
      resp = await getWorkorderDetail(workOrderId);
    } else {
      resp = await getWorkorderPage({ elderId, pageNo: 1, pageSize: 20 });
    }
    if (resp.code !== 'OK') {
      return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
    }
    const records = workOrderId ? (resp.data ? [resp.data] : []) : (resp.data?.records || []);
    const workorders = mapWorkorders(records);
    const workers = extractWorkersFromWorkorders(workorders);
    if (workorders.length === 0) {
      return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_EMPTY };
    }
    return { dispatch_orders: workorders, orders: [], workers, source: SOURCE_OK };
  } catch (e) {
    console.warn('[dispatch_manage] assembleDispatchList failed:', e.message);
    return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
  }
}

async function assembleDispatchStatus(params = {}) {
  const { workOrderId } = params;
  if (!workOrderId) {
    return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_EMPTY };
  }
  try {
    const resp = await getWorkorderProgress(workOrderId);
    if (resp.code !== 'OK') {
      return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
    }
    const workorders = mapWorkorders(resp.data ? [resp.data] : []);
    return { dispatch_orders: workorders, orders: [], workers: [], source: SOURCE_OK };
  } catch (e) {
    return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
  }
}

async function assembleDispatchSync(params = {}) {
  try {
    const validation = validateWorkorder(params.workorderFields || {}, {
      elders: params.candidateElders,
    });
    if (!validation.valid) {
      return { dispatch_orders: [], orders: [], workers: [], validation_error: validation, source: SOURCE_ERROR };
    }
    const resp = await syncWorkorder(params.workorderFields);
    if (resp.code !== 'OK') {
      return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR, error: resp.message };
    }
    const workorders = mapWorkorders(resp.data ? [resp.data] : []);
    return { dispatch_orders: workorders, orders: [], workers: [], source: SOURCE_OK };
  } catch (e) {
    return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
  }
}

const ACTION_HANDLERS = {
  'dispatch_manage.list':     assembleDispatchList,
  'dispatch_manage.detail':   assembleDispatchList,
  'dispatch_manage.work_order': assembleDispatchList,
  'dispatch_manage.status':   assembleDispatchStatus,
  'dispatch_manage.accept':   assembleDispatchList,
  'dispatch_manage.reject':   assembleDispatchList,
  'dispatch_manage.transfer': assembleDispatchList,
  'dispatch_manage.supplier': assembleDispatchList,
};
