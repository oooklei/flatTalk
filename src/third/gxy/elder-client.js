// src/third/gxy/elder-client.js
/**
 * 桂小养老人管理客户端。
 * 移植自 AI对接包-v3/backend/app/clients/gxy_elder.py
 *
 * 接口：POST /openapi/elder/address/page — 分页查询老人地址（含经纬度）
 */

import { createGxyClient } from './base-client.js';

export const ADDRESS_TAG = {
  HOME: 'home',
  HOSPITAL: 'hospital',
  OTHER: 'other',
};

export function createElderClient(config) {
  const client = createGxyClient(config);

  async function pageAddresses(userId, tag) {
    const payload = { userId, pageNo: 1, pageSize: 20 };
    if (tag) payload.tag = tag;
    return client.post('/openapi/elder/address/page', payload);
  }

  return { pageAddresses };
}
