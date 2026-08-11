// src/services/gxy-platform/service-item-service.js
/**
 * 服务项目服务：目录分页 + 详情。
 * 移植自 AI对接包-v3/backend/app/services/service_item_service.py
 */

import { createServiceItemClient } from '../../third/gxy/service-item-client.js';
import { err, toPlatformResult } from './shared.js';

const STRING_PARAMS = ['serviceTypeId', 'itemName', 'regionCode', 'userLong', 'userLat'];
const NUMBER_PARAMS = ['minPrice', 'maxPrice', 'maxDistance'];

export async function pageServiceItems(payload = {}) {
  const client = createServiceItemClient();
  const params = {};
  for (const key of STRING_PARAMS) {
    if (payload[key]) params[key] = payload[key];
  }
  for (const key of NUMBER_PARAMS) {
    if (payload[key] != null) params[key] = payload[key];
  }
  params.pageNo = payload.pageNo || 1;
  params.pageSize = payload.pageSize || 10;
  const resp = await client.pageByType(params);
  return toPlatformResult(resp, '查询服务项目列表成功');
}

export async function getServiceItemDetail(itemId) {
  if (!itemId) {
    return err('FIELD_INVALID', '项目ID不能为空');
  }
  const client = createServiceItemClient();
  const resp = await client.getDetail(itemId);
  return toPlatformResult(resp, '查询服务项目详情成功');
}
