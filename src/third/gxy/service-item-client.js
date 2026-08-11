// src/third/gxy/service-item-client.js
/**
 * 桂小养服务项目目录客户端。
 * 移植自 AI对接包-v3/backend/app/clients/gxy_service_item.py
 *
 * 白名单公开 GET 接口，无需 HMAC 签名：
 *   GET /serviceItem/pageByType — 分页查询项目列表
 *   GET /serviceItem/detail     — 查询项目详情
 */

import { createGxyClient } from './base-client.js';

export function createServiceItemClient(config) {
  const client = createGxyClient(config);

  async function pageByType(params) {
    return client.getUnsigned('/serviceItem/pageByType', params);
  }

  async function getDetail(itemId) {
    return client.getUnsigned('/serviceItem/detail', { id: itemId });
  }

  return { pageByType, getDetail };
}
