// src/skills/dispatch_manage/lib/validators.js
/**
 * 工单创建字段校验。
 * 移植自 AI对接包-v3/backend/app/schemas/workorder.py。
 */

const WORKORDER_REQUIRED_FIELDS = [
  'elderId', 'workOrderType', 'category',
  'provinceCode', 'cityCode', 'districtCode', 'address', 'addressLat', 'addressLng',
  'contactName', 'contactPhone',
];

export function validateWorkorder(fields, candidates = {}) {
  const missing = WORKORDER_REQUIRED_FIELDS.filter(f => !fields[f]);
  const invalid = [];

  if (fields.elderId && candidates.elders) {
    const ids = new Set(candidates.elders.map(e => e.id));
    if (!ids.has(fields.elderId)) invalid.push('elderId');
  }
  if (fields.contactPhone && !/^1\d{10}$/.test(fields.contactPhone)) {
    invalid.push('contactPhone');
  }

  return { valid: missing.length === 0 && invalid.length === 0, missing, invalid };
}
