// src/skills/find_service/lib/validators.js
/**
 * 下单/取消/评价字段校验。
 * 移植自 AI对接包-v3/backend/app/schemas/order.py 的 Pydantic 校验规则。
 */

const ORDER_REQUIRED_FIELDS = [
  'category', 'elderId', 'orderSource', 'dispatchMode',
  'nurseId', 'serviceTypeId', 'serviceType', 'serviceItemId',
  'serviceItemName', 'provinceCode', 'cityCode', 'districtCode',
  'address', 'addressLat', 'addressLng',
  'contactName', 'contactPhone', 'reserveDate', 'reserveTime',
];

/**
 * 校验下单必填字段。
 * @param {object} fields - 订单字段
 * @param {object} [candidates] - 可选的候选列表 { elders, serviceItems } 用于 ID 白名单校验
 * @returns {{ valid: boolean, missing: string[], invalid: string[] }}
 */
export function validateOrder(fields, candidates = {}) {
  const missing = ORDER_REQUIRED_FIELDS.filter(f => !fields[f]);

  const invalid = [];

  // ID 白名单校验：禁止 LLM 编造平台主键
  if (fields.elderId && candidates.elders) {
    const ids = new Set(candidates.elders.map(e => e.id));
    if (!ids.has(fields.elderId)) invalid.push('elderId');
  }
  if (fields.serviceItemId && candidates.serviceItems) {
    const ids = new Set(candidates.serviceItems.map(s => s.id || s.itemId));
    if (!ids.has(fields.serviceItemId)) invalid.push('serviceItemId');
  }

  // 手机号格式
  if (fields.contactPhone && !/^1\d{10}$/.test(fields.contactPhone)) {
    invalid.push('contactPhone');
  }

  // 评分范围（evaluate 场景）
  if (fields.rating != null && (fields.rating < 1 || fields.rating > 5)) {
    invalid.push('rating');
  }

  return {
    valid: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}

/**
 * 校验取消订单。
 */
export function validateCancel(orderId) {
  if (!orderId) return { valid: false, missing: ['orderId'], invalid: [] };
  return { valid: true, missing: [], invalid: [] };
}
