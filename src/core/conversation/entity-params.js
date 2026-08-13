/**
 * ActiveEntity 参数工具：选记录 + 给追问/动作打实体 params。
 * 与 context-snapshot 配套：锁定写入 business_data，此处负责读取与下发。
 */

export function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

/** 按锁定 id 从列表取记录；无 id / 未命中时返回 fallback（默认 list[0] 仅在 allowFallback 时） */
export function pickByLockedId(list, lockedId, idKeys = ['id'], { allowFallback = true } = {}) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return null;
  const want = String(lockedId || '').trim();
  if (want) {
    const keys = Array.isArray(idKeys) ? idKeys : [idKeys];
    const hit = items.find((item) => keys.some((k) => String(item?.[k] ?? '') === want));
    if (hit) return hit;
  }
  return allowFallback ? items[0] : null;
}

export function withEntityParams(followups = [], params = {}) {
  const clean = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v != null && String(v).trim() !== ''),
  );
  if (!Object.keys(clean).length) return Array.isArray(followups) ? followups : [];
  return (Array.isArray(followups) ? followups : []).map((item) => ({
    ...item,
    params: { ...clean, ...(item.params || {}) },
  }));
}

export function travelEntityParams(data = {}, businessData = {}) {
  const destination = firstText(
    data.destination,
    businessData.destination,
    businessData.primary_city,
    Array.isArray(businessData.publish_match?.destination)
      ? businessData.publish_match.destination[0]
      : businessData.publish_match?.destination,
  );
  return {
    destination,
    city: firstText(data.city, destination),
    route_id: firstText(data.route_id, businessData.route_id, businessData.publish_match?.route_id),
    product_id: firstText(data.productId, data.product_id, businessData.jtd?.selected_product?.product_id),
    route_title: firstText(data.routeTitle, data.route_title, businessData.route_title, businessData.publish_match?.title),
    sku_id: firstText(data.skuId, data.sku_id, businessData.jtd?.selected_product?.sku_id),
  };
}

export function elderEntityParams(data = {}, businessData = {}) {
  return {
    elder_id: firstText(data.elder_id, data.elderId, businessData.elder_id),
    elder_name: firstText(data.elder_name, data.elderName, data.profileName, businessData.elder_name, businessData.elderName),
  };
}

export function findServiceEntityParams(data = {}, businessData = {}) {
  return {
    ...elderEntityParams(data, businessData),
    service_id: firstText(data.service_id, data.id, businessData.service_id),
    org_id: firstText(data.org_id, businessData.org_id),
    worker_id: firstText(data.worker_id, businessData.worker_id),
    order_id: firstText(data.orderId, data.order_id, data.order_no, businessData.order_id),
  };
}

export function dispatchEntityParams(data = {}, businessData = {}) {
  return {
    dispatch_id: firstText(data.dispatchId, data.dispatch_id, businessData.dispatch_id),
    order_id: firstText(data.orderId, data.order_id, data.orderNo, businessData.order_id),
    worker_id: firstText(data.worker_id, businessData.worker_id),
    elder_id: firstText(data.elder_id, businessData.elder_id),
  };
}

export function nearbyEntityParams(data = {}, businessData = {}) {
  return {
    center: firstText(data.center, businessData.center, '嘉路康养中心'),
    category: firstText(data.category, businessData.category),
    destination: firstText(data.destination, businessData.destination),
  };
}

export function qualityEntityParams(data = {}, businessData = {}) {
  return {
    org_id: firstText(data.org_id, data.orgId, businessData.org_id),
    staff_id: firstText(data.staff_id, data.staffId, businessData.staff_id),
    org_name: firstText(data.orgName, data.org_name, businessData.org_name, businessData.orgName),
  };
}

export function entityParamsForScene(sceneKey, data = {}, businessData = {}) {
  const scene = String(sceneKey || '').trim();
  if (scene === 'travel_route') return travelEntityParams(data, businessData);
  if (scene === 'health_risk_warning' || scene === 'meal_plan') return elderEntityParams(data, businessData);
  if (scene === 'find_service') return findServiceEntityParams(data, businessData);
  if (scene === 'dispatch_manage') return dispatchEntityParams(data, businessData);
  if (scene === 'nearby_resource') return nearbyEntityParams(data, businessData);
  if (scene === 'service_quality_eval') return qualityEntityParams(data, businessData);
  return {};
}
