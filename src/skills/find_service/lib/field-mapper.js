// src/skills/find_service/lib/field-mapper.js
/**
 * 平台 API 字段 → flatTalk business_data 字段映射。
 * 纯函数，无副作用。
 *
 * 目标 shape 对齐 fillFindServiceCard (model-service.js L2027-2038) 消费的字段名。
 */

/**
 * 映射服务项目列表。
 */
export function mapServiceItems(records) {
  return (records || []).map(r => ({
    service_id: r.id || r.itemId || '',
    name: r.itemName || r.name || '',
    service_type: r.serviceType || '',
    price_from: r.minPrice || r.price || 0,
    price_to: r.maxPrice || r.price || 0,
    org_name: r.orgName || '',
    org_id: r.orgId || '',
    description: r.itemDesc || r.description || '',
    tags: r.tags || [],
    image_url: r.imageUrl || '',
  }));
}

/**
 * 映射订单列表。
 */
export function mapOrders(records) {
  return (records || []).map(r => ({
    order_id: r.orderNo || r.orderId || '',
    elder_name: r.elderName || '',
    elder_id: r.elderId || '',
    service_name: r.serviceItemName || r.serviceName || '',
    service_id: r.serviceItemId || '',
    org_name: r.orgName || '',
    org_id: r.orgId || '',
    worker_name: r.staffName || r.nurseName || '',
    worker_id: r.staffId || r.nurseId || '',
    order_status: r.orderStatus || '',
    price: r.amount || r.orderAmount || 0,
    service_address: r.address || '',
    lat: r.addressLat || '',
    lng: r.addressLng || '',
    reserve_date: r.reserveDate || '',
    reserve_time: r.reserveTime || '',
    create_time: r.createTime || '',
    category: r.category || '',
  }));
}

/**
 * 映射老人地址列表。
 */
export function mapElderAddresses(records) {
  return (records || []).map(r => ({
    address_id: r.id || '',
    elder_id: r.userId || '',
    contact_name: r.contactName || r.userName || '',
    contact_phone: r.contactPhone || r.userPhone || '',
    province_code: r.provinceCode || '',
    city_code: r.cityCode || '',
    district_code: r.districtCode || '',
    address: r.address || r.detailAddress || '',
    lat: r.lat || r.addressLat || '',
    lng: r.lng || r.addressLng || '',
    tag: r.tag || '',
  }));
}

/**
 * 从订单记录中提取去重的机构列表。
 */
export function extractOrgsFromOrders(orders) {
  const seen = new Map();
  for (const o of orders || []) {
    const id = o.org_id || o.orgId;
    if (id && !seen.has(id)) {
      seen.set(id, { org_id: id, org_name: o.org_name || o.orgName || '' });
    }
  }
  return [...seen.values()];
}

/**
 * 从订单记录中提取去重的护工列表。
 */
export function extractWorkersFromOrders(orders) {
  const seen = new Map();
  for (const o of orders || []) {
    const id = o.worker_id || o.staffId;
    if (id && !seen.has(id)) {
      seen.set(id, { worker_id: id, worker_name: o.worker_name || o.staffName || '', available: true });
    }
  }
  return [...seen.values()];
}
