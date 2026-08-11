// src/skills/dispatch_manage/lib/field-mapper.js
/**
 * 平台工单字段 → flatTalk business_data 字段映射。
 * 目标 shape 对齐 fillDispatchManageCard (model-service.js L2418-2424)：
 *   { dispatch_orders, orders, workers }
 */

export function mapWorkorders(records) {
  return (records || []).map(r => ({
    dispatch_id: r.workOrderNo || r.workOrderId || '',
    order_id: r.orderNo || r.orderId || '',
    worker_name: r.staffName || '',
    worker_id: r.staffId || '',
    elder_name: r.elderName || '',
    elder_id: r.elderId || '',
    dispatch_status: r.workOrderStatus || '',
    dispatch_type: r.workOrderType || '',
    category: r.category || '',
    service_item_name: r.serviceItemName || '',
    org_name: r.orgName || '',
    address: r.address || '',
    lat: r.addressLat || '',
    lng: r.addressLng || '',
    create_time: r.createTime || '',
    reserve_date: r.reserveDate || '',
    service_summary: r.serviceSummary || '',
    arrive_time: r.arriveTime || '',
    leave_time: r.leaveTime || '',
  }));
}

export function extractWorkersFromWorkorders(workorders) {
  const seen = new Map();
  for (const w of workorders || []) {
    const id = w.worker_id;
    if (id && !seen.has(id)) {
      seen.set(id, { worker_id: id, worker_name: w.worker_name, available: true });
    }
  }
  return [...seen.values()];
}
