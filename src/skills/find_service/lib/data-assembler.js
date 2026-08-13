// src/skills/find_service/lib/data-assembler.js
/**
 * find_service 数据装配器。
 *
 * 服务目录权威源：Tag-System.mobile_service_item
 *   （OpenAPI 资源名 mobile-service-items）
 *   关键字段：service_item_id / item_code / item_name / service_type_name / price / unit
 *
 * 数据优先级：
 *   1) Tag-System.mobile_service_item（直连 PG）
 *   2) 桂小养平台 serviceItem API（gxy-platform，仅作补充）
 *   3) flatTalk 本地种子 fs_service_catalog（应急兜底）
 *
 * 返回值 shape 对齐 fillFindServiceCard：
 *   { service_catalog, orgs, workers, orders, source }
 */

import { pageServiceItems } from '../../../services/gxy-platform/service-item-service.js';
import { getOrderPage, getOrderDetail, syncOrder } from '../../../services/gxy-platform/order-service.js';
import { listElderAddresses } from '../../../services/gxy-platform/elder-service.js';
import { getTagSystemBiz } from '../../../services/interface-data/tag-system-biz.js';
import { createTableDataRepository } from '../../../services/table-data/repository.js';
import {
  mapServiceItems,
  mapOrders,
  mapElderAddresses,
  extractOrgsFromOrders,
  extractWorkersFromOrders,
} from './field-mapper.js';
import { validateOrder } from './validators.js';

const SOURCE_OK = 'gxy_platform';
const SOURCE_TAG = 'tag_system.mobile_service_item';
const SOURCE_SEED = 'flatTalk_table_data';
const SOURCE_EMPTY = 'gxy_platform_empty';
const SOURCE_ERROR = 'gxy_platform_error';

/** SHOULD：目录种子默认禁用；演示设 FLATTALK_ALLOW_CATALOG_SEED=1 */
const ALLOW_CATALOG_SEED = process.env.FLATTALK_ALLOW_CATALOG_SEED === '1';

const repo = createTableDataRepository();

async function loadSeedTables() {
  return {
    service_catalog: await repo.list('fs_service_catalog'),
    orgs: await repo.list('fs_org'),
    workers: await repo.list('fs_worker'),
    orders: await repo.list('fs_service_order'),
    source: SOURCE_SEED,
  };
}

async function loadTagCatalog() {
  try {
    const remote = await getTagSystemBiz().listMobileServiceItems({ limit: 300 });
    if (remote?.ok && Array.isArray(remote.catalog) && remote.catalog.length > 0) {
      const orgs = Array.isArray(remote.orgs) ? remote.orgs : [];
      return {
        service_catalog: remote.catalog,
        orgs,
        workers: [],
        orders: [],
        source: SOURCE_TAG,
      };
    }
  } catch (e) {
    console.warn('[find_service] tag-system catalog failed:', e.message);
  }
  return null;
}

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
 * 装配服务目录：Tag-System.mobile_service_item → 平台 API → 本地种子。
 */
async function assembleCatalog(params = {}) {
  const tag = await loadTagCatalog();
  if (tag) return tag;

  try {
    const resp = await pageServiceItems({ pageSize: 50, ...params });
    if (resp.code === 'OK') {
      const records = resp.data?.records || [];
      const catalog = mapServiceItems(records);
      if (catalog.length > 0) {
        return { service_catalog: catalog, orgs: [], workers: [], orders: [], source: SOURCE_OK };
      }
    }
  } catch (e) {
    console.warn('[find_service] assembleCatalog platform failed:', e.message);
  }

  const seed = ALLOW_CATALOG_SEED ? await loadSeedTables() : null;
  if (seed && (seed.service_catalog || []).length > 0) return seed;

  return {
    service_catalog: [],
    orgs: [],
    workers: [],
    orders: [],
    source: SOURCE_EMPTY,
    error: ALLOW_CATALOG_SEED ? 'catalog_empty' : 'catalog_seed_blocked',
  };
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
      // P0：禁止无身份时用种子订单冒充现网
      return {
        service_catalog: [],
        orgs: [],
        workers: [],
        orders: [],
        source: SOURCE_EMPTY,
        error: 'missing_elder_or_order_id',
      };
    }
    if (resp.code !== 'OK') {
      return {
        service_catalog: [],
        orgs: [],
        workers: [],
        orders: [],
        source: SOURCE_ERROR,
        error: resp.message || resp.code,
      };
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
    return {
      service_catalog: [],
      orgs: [],
      workers: [],
      orders: [],
      source: SOURCE_ERROR,
      error: e.message,
    };
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
    let catalog = mapServiceItems(catalogResp.data?.records || []);
    if (!catalog.length) {
      const fallback = await assembleCatalog(params);
      catalog = fallback.service_catalog || [];
    }
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
    return assembleCatalog(params);
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
  'find_service.recommend': assembleCatalog,
  'find_service.catalog': assembleCatalog,
  'find_service.detail_service': assembleCatalog,
  'find_service.list_orgs': assembleCatalog,
  'find_service.list_workers': assembleCatalog,
  'find_service.detail_order': assembleOrderList,
  'find_service.preview_order': assembleOrderPreview,
  'find_service.booking_confirm': assembleBookingConfirm,
  'find_service.booking_success': assembleBookingConfirm,
  'find_service.order_ticket': assembleBookingConfirm,
};
