/** @typedef {'self'|'family'|'none'} BindingKind */

export const ROLE_ENTITY_MAP = {
  LAO_REN: { entity_type: 'ELDER', binding: 'self', org_required: false },
  ELDER: { entity_type: 'ELDER', binding: 'self', org_required: false },
  JIA_SHU: { entity_type: 'USER', binding: 'family', org_required: false, tags: ['FAMILY'] },
  HU_LI_YUAN: { entity_type: 'WORKER', binding: 'none', org_required: false },
  nurse: { entity_type: 'WORKER', binding: 'none', org_required: false },
  'SQJJ-HLRY': { entity_type: 'WORKER', binding: 'none', org_required: false },
  'SQJJ-ZLY': { entity_type: 'WORKER', binding: 'none', org_required: false },
  CUN_YI: { entity_type: 'DOCTOR', binding: 'none', org_required: false },
  'SQJJ-YS': { entity_type: 'DOCTOR', binding: 'none', org_required: false },
  FU_WU_SHANG: { entity_type: 'SERVICE_PROVIDER', binding: 'none', org_required: false },
  'SQJJ-GLY': { entity_type: 'USER', binding: 'none', org_required: true, tags: ['ORG_ADMIN'] },
  SHE_QU_WANG_GE_YUAN: { entity_type: 'GRID_WORKER', binding: 'none', org_required: false },
};

export function resolveEntityType(roleId) {
  const key = String(roleId || '').trim();
  if (!key) return { entity_type: 'USER', binding: 'none', org_required: false };
  if (ROLE_ENTITY_MAP[key]) return { ...ROLE_ENTITY_MAP[key] };
  const upper = key.toUpperCase();
  if (ROLE_ENTITY_MAP[upper]) return { ...ROLE_ENTITY_MAP[upper] };
  return { entity_type: 'USER', binding: 'none', org_required: false };
}
