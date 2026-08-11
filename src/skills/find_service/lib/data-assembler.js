// src/skills/find_service/lib/data-assembler.js
/**
 * find_service 数据装配器。
 * 编排 gxy-platform 服务调用，返回 business_data。
 *
 * 返回值 shape 对齐 fillFindServiceCard (model-service.js L2027-2038)：
 *   { service_catalog, orgs, workers, orders, source }
 */

import { pageServiceItems } from '../../../services/gxy-platform/service-item-service.js';
import { getOrderPage, getOrderDetail, syncOrder } from '../../../services/gxy-platform/order-service.js';
import { listElderAddresses } from '../../../services/gxy-platform/elder-service.js';
import {
  mapServiceItems,
  mapOrders,
  mapElderAddresses,
  extractOrgsFromOrders,
  extractWorkersFromOrders,
} from './field-mapper.js';
import { validateOrder } from './validators.js';

const SOURCE_OK = 'gxy_platform';
const SOURCE_EMPTY = 'gxy_platform_empty';
const SOURCE_ERROR = 'gxy_platform_error';

/**
 * 主入口：根据 action 和 params 装配 business_data。
 * 由 table-data/index.js 的 getFindServiceTables() 调用。
 */
export async function assembleFindServiceData(params = {}) {
  const action = params.action || params.intent || '';
  const handler = ACTION_HANDLERS[action] || ACTION_HANDLERS['find_service.recommend'];
  return handler(params);
}

/**
 * 装配服务目录。
 */
async function assembleCatalog(params = {}) {
  try {
    const resp = await pageServiceItems({ pageSize: 50, ...params });
    if (resp.code !== 'OK') {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
    }
    const records = resp.data?.records || [];
    const catalog = mapServiceItems(records);
    if (catalog.length === 0) {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_EMPTY };
    }
    return { service_catalog: catalog, orgs: [], workers: [], orders: [], source: SOURCE_OK };
  } catch (e) {
    console.warn('[find_service] assembleCatalog failed:', e.message);
    return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
  }
}

/**
 * 装配订单列表。
 */
async function assembleOrderList(params = {}) {
  const { elderId, orderId } = params;
  try {
    let resp;
    if (orderId) {
      resp = await getOrderDetail(orderId);
    } else if (elderId) {
      resp = await getOrderPage({ elderId, pageNo: 1, pageSize: 20 });
    } else {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_EMPTY };
    }
    if (resp.code !== 'OK') {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
    }
    const records = orderId ? (resp.data ? [resp.data] : []) : (resp.data?.records || []);
    const orders = mapOrders(records);
    const orgs = extractOrgsFromOrders(orders);
    const workers = extractWorkersFromOrders(orders);
    if (orders.length === 0) {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_EMPTY };
    }
    return { service_catalog: [], orgs, workers, orders, source: SOURCE_OK };
  } catch (e) {
    console.warn('[find_service] assembleOrderList failed:', e.message);
    return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
  }
}

/**
 * 装配订单预览（下单前）。
 */
async function assembleOrderPreview(params = {}) {
  try {
    const [catalogResp, addrResp] = await Promise.all([
      pageServiceItems({ itemName: params.service_name, pageSize: 10 }),
      params.elderId ? listElderAddresses(params.elderId) : Promise.resolve({ code: 'OK', data: [] }),
    ]);
    const catalog = mapServiceItems(catalogResp.data?.records || []);
    const addresses = mapElderAddresses(addrResp.data || []);
    return {
      service_catalog: catalog,
      orgs: [],
      workers: [],
      orders: [],
      elder_addresses: addresses,
      source: SOURCE_OK,
    };
  } catch (e) {
    console.warn('[find_service] assembleOrderPreview failed:', e.message);
    return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
  }
}

/**
 * 装配下单确认（执行下单）。
 */
async function assembleBookingConfirm(params = {}) {
  try {
    const validation = validateOrder(params.orderFields || {}, {
      elders: params.candidateElders,
      serviceItems: params.candidateServiceItems,
    });
    if (!validation.valid) {
      return {
        service_catalog: [], orgs: [], workers: [], orders: [],
        validation_error: validation,
        source: SOURCE_ERROR,
      };
    }
    const resp = await syncOrder(params.orderFields);
    if (resp.code !== 'OK') {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR, error: resp.message };
    }
    const orders = mapOrders(resp.data ? [resp.data] : []);
    return { service_catalog: [], orgs: [], workers: [], orders, source: SOURCE_OK };
  } catch (e) {
    console.warn('[find_service] assembleBookingConfirm failed:', e.message);
    return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
  }
}

const ACTION_HANDLERS = {
  'find_service.recommend':      assembleCatalog,
  'find_service.catalog':        assembleCatalog,
  'find_service.detail_service': assembleCatalog,
  'find_service.list_orgs':      assembleCatalog,
  'find_service.list_workers':   assembleCatalog,
  'find_service.detail_order':   assembleOrderList,
  'find_service.preview_order':  assembleOrderPreview,
  'find_service.booking_confirm': assembleBookingConfirm,
  'find_service.booking_success': assembleBookingConfirm,
  'find_service.order_ticket':   assembleBookingConfirm,
};
