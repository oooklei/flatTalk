/**
 * 登录前导页：从 tag-system 用户中心抽取可用身份，映射为 /assistant AES 包字段。
 */
import pg from 'pg';
import { normalizeRole } from '../../server/external-aes-sso.js';

const { Pool } = pg;
let pool = null;

function resolvePgUrl() {
  return (
    process.env.FLATTALK_TAG_SYSTEM_PG_URL
    || process.env.FLATTALK_PG_URL
    || process.env.TAG_SYSTEM_PG_URL
    || process.env.DATABASE_URL
    || ''
  );
}

function getPool() {
  const url = resolvePgUrl();
  if (!url) return null;
  if (pool) return pool;
  pool = new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 4000,
    application_name: 'flattalk_login_presets',
  });
  pool.on('error', () => {});
  return pool;
}

/** 角色编码 / 名称 → 对接包 roleId（业务系统编码或桂小养 key） */
const ROLE_HINTS = [
  { test: /老人|长者|LAO_REN|^elder$/i, roleId: 'LAO_REN', terminal: 'C' },
  { test: /家属|家人|JIA_SHU|family/i, roleId: 'JIA_SHU', terminal: 'C' },
  { test: /村医|CUN_YI|village_doctor/i, roleId: 'CUN_YI', terminal: 'G' },
  { test: /社区.*医生|SQJJ.?YS|community_doctor/i, roleId: 'SQJJ-YS', terminal: 'G' },
  { test: /护理|HU_LI|nurse|care_worker|HLRY/i, roleId: 'HU_LI_YUAN', terminal: 'B' },
  { test: /助老|ZLY|community_helper/i, roleId: 'SQJJ-ZLY', terminal: 'B' },
  { test: /院长|管理员|GLY|YZ|director|manager|institution/i, roleId: 'SQJJ-GLY', terminal: 'B' },
  { test: /服务商|FU_WU|provider/i, roleId: 'FU_WU_SHANG', terminal: 'B' },
  { test: /食堂|ST|canteen/i, roleId: 'SQJJ-ST', terminal: 'B' },
  { test: /厨房|CF|kitchen/i, roleId: 'SQJJ-CF', terminal: 'B' },
  { test: /后勤|HQ|support/i, roleId: 'SQJJ-HQ', terminal: 'B' },
  { test: /民政|MIN_ZHENG|civil/i, roleId: 'MIN_ZHENG_KE_YUAN', terminal: 'G' },
  { test: /网格|WANG_GE|grid/i, roleId: 'SHE_QU_WANG_GE_YUAN', terminal: 'G' },
  { test: /厅级|TING_JI|senior_official/i, roleId: 'TING_JI_GAN_BU', terminal: 'G' },
  { test: /超级|CHAO_JI|system_admin/i, roleId: 'CHAO_JI_GUAN_LI_YUAN', terminal: 'Admin' },
];

function inferRoleId(roleCode, roleName, roleId) {
  const hay = [roleCode, roleName, roleId].filter(Boolean).join(' ');
  for (const h of ROLE_HINTS) {
    if (h.test.test(hay)) return { roleId: h.roleId, terminal: h.terminal };
  }
  if (roleCode && normalizeRole(roleCode) !== 'guest') {
    return { roleId: roleCode, terminal: 'C' };
  }
  if (roleId && normalizeRole(roleId) !== 'guest') {
    return { roleId, terminal: 'C' };
  }
  return null;
}

function displayRole(roleKey) {
  const map = {
    elder: '老人',
    elder_family: '家属',
    village_doctor: '村医',
    community_doctor: '社区医生',
    care_worker: '护理员',
    community_helper: '助老员',
    institution_admin: '机构管理员',
    provider_staff: '服务商',
    community_support: '后勤',
    community_canteen: '食堂',
    community_kitchen: '厨房',
    civil_affairs_staff: '民政科员',
    grid_worker: '网格员',
    senior_official: '厅级干部',
    system_admin: '超级管理员',
    admin: '配置管理员',
  };
  return map[roleKey] || roleKey || '访客';
}

/** 库不可用时的像样兜底身份（仍走正式 AES → /assistant） */
export const FALLBACK_PRESETS = [
  {
    key: 'fb_elder',
    userId: 'U_GX_ELDER_01',
    userName: '黄秀英',
    roleId: 'LAO_REN',
    roleName: '老人',
    orgId: 'org_qingxiu_community',
    orgName: '青秀社区',
    terminal: 'C',
  },
  {
    key: 'fb_family',
    userId: 'U_GX_FAMILY_01',
    userName: '黄明',
    roleId: 'JIA_SHU',
    roleName: '家属',
    orgId: 'org_qingxiu_community',
    orgName: '青秀社区',
    terminal: 'C',
  },
  {
    key: 'fb_nurse',
    userId: 'U_GX_NURSE_01',
    userName: '李护理',
    roleId: 'HU_LI_YUAN',
    roleName: '护理员',
    orgId: 'org_guixiaoyang_center',
    orgName: '桂小养康养中心',
    terminal: 'B',
  },
  {
    key: 'fb_doctor',
    userId: 'U_GX_DOC_01',
    userName: '王村医',
    roleId: 'CUN_YI',
    roleName: '村医',
    orgId: 'org_qingxiu_clinic',
    orgName: '青秀村医服务点',
    terminal: 'G',
  },
  {
    key: 'fb_admin',
    userId: 'U_GX_ADMIN_01',
    userName: '陈院长',
    roleId: 'SQJJ-GLY',
    roleName: '机构管理员',
    orgId: 'org_guixiaoyang_center',
    orgName: '桂小养康养中心',
    terminal: 'B',
  },
  {
    key: 'fb_provider',
    userId: 'U_GX_PROV_01',
    userName: '赵服务',
    roleId: 'FU_WU_SHANG',
    roleName: '服务商',
    orgId: 'org_provider_1',
    orgName: '广西康养服务商',
    terminal: 'B',
  },
];

function pickOrgName(row) {
  return String(
    row.org_name
    || row.root_group_name
    || row.group_name
    || '',
  ).trim();
}

function toPreset(row, idx) {
  const inferred = inferRoleId(row.role_code, row.role_name, row.role_id);
  if (!inferred) return null;
  const roleKey = normalizeRole(inferred.roleId);
  if (roleKey === 'guest') return null;
  const userName = String(row.user_name || row.user_account || '').trim();
  const userId = String(row.user_id || '').trim();
  if (!userId || !userName) return null;
  const orgId = String(row.org_id || row.group_id || '').trim();
  const orgName = pickOrgName(row);
  return {
    key: `tag_${userId}_${inferred.roleId}_${idx}`,
    userId,
    userName,
    roleId: inferred.roleId,
    roleKey,
    roleName: row.role_name || displayRole(roleKey),
    orgId,
    orgName,
    orgCode: orgId,
    rootGroupName: String(row.root_group_name || '').trim(),
    terminal: inferred.terminal,
    phone: row.user_phone || '',
    source: 'tag_system',
  };
}

async function queryTagUsers(limit = 60) {
  const p = getPool();
  if (!p) return { ok: false, error: 'pg_unconfigured', rows: [] };

  // 注意：tag-system 同步表无 create_time；组织名以 user_org_rel 冗余字段为准
  // （user_org_rel.org_id 与 user_center_org.group_id 并非总能对上）
  const sql = `
    SELECT
      u.user_id,
      u.user_name,
      u.user_account,
      u.user_phone,
      u.user_status,
      u.tenant_id,
      r.role_id,
      r.role_name,
      r.role_code,
      uo.org_id,
      COALESCE(NULLIF(TRIM(uo.org_name), ''), NULLIF(TRIM(uo.root_group_name), ''), NULLIF(TRIM(o.group_name), '')) AS org_name,
      uo.root_group_name,
      o.group_id,
      o.group_name
    FROM user_center_user u
    LEFT JOIN user_role_rel ur ON ur.user_id = u.user_id
    LEFT JOIN user_center_role r ON r.role_id = ur.role_id
    LEFT JOIN LATERAL (
      SELECT org_id, org_name, root_group_name
      FROM user_org_rel
      WHERE user_id = u.user_id
      ORDER BY id ASC NULLS LAST
      LIMIT 1
    ) uo ON true
    LEFT JOIN user_center_org o ON o.group_id = uo.org_id
    WHERE (
        u.delete_flag IS NULL
        OR LOWER(CAST(u.delete_flag AS text)) IN ('0', 'false', 'n', 'no', '')
      )
      AND (
        u.user_status IS NULL
        OR LOWER(CAST(u.user_status AS text)) IN ('valid', '1', 'active', '正常', 'enable', 'enabled')
      )
    ORDER BY COALESCE(u.synced_at, u.updated_at) DESC NULLS LAST
    LIMIT $1
  `;
  const sqlNoStatus = `
    SELECT
      u.user_id,
      u.user_name,
      u.user_account,
      u.user_phone,
      u.user_status,
      u.tenant_id,
      r.role_id,
      r.role_name,
      r.role_code,
      uo.org_id,
      COALESCE(NULLIF(TRIM(uo.org_name), ''), NULLIF(TRIM(uo.root_group_name), '')) AS org_name,
      uo.root_group_name
    FROM user_center_user u
    LEFT JOIN user_role_rel ur ON ur.user_id = u.user_id
    LEFT JOIN user_center_role r ON r.role_id = ur.role_id
    LEFT JOIN LATERAL (
      SELECT org_id, org_name, root_group_name
      FROM user_org_rel
      WHERE user_id = u.user_id
      ORDER BY id ASC NULLS LAST
      LIMIT 1
    ) uo ON true
    ORDER BY COALESCE(u.synced_at, u.updated_at) DESC NULLS LAST
    LIMIT $1
  `;
  try {
    const result = await p.query(sql, [limit]);
    return { ok: true, rows: result.rows || [] };
  } catch (e1) {
    try {
      const result = await p.query(sqlNoStatus, [limit]);
      return { ok: true, rows: result.rows || [], warn: e1.message || String(e1) };
    } catch (e2) {
      return { ok: false, error: e2.message || String(e2), rows: [] };
    }
  }
}

/**
 * 返回登录页可选身份列表（去重：同用户同角色只留一条）
 */
export async function listLoginPresets({ limit = 48 } = {}) {
  const q = await queryTagUsers(Math.max(limit * 2, 80));
  const presets = [];
  const seen = new Set();

  if (q.ok) {
    for (let i = 0; i < q.rows.length; i += 1) {
      const p = toPreset(q.rows[i], i);
      if (!p) continue;
      // 老人(LAO_REN/elder)允许无组织；其余角色必须绑定组织
      const isElder = p.roleId === 'LAO_REN' || p.roleKey === 'elder';
      if (!isElder && !p.orgId && !p.orgName) continue;
      const k = `${p.userId}::${p.roleId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      presets.push(p);
      if (presets.length >= limit) break;
    }
  }

  const have = new Set(presets.map((p) => p.roleKey));
  for (const fb of FALLBACK_PRESETS) {
    const roleKey = normalizeRole(fb.roleId);
    if (have.has(roleKey)) continue;
    presets.push({
      ...fb,
      roleKey,
      roleName: fb.roleName || displayRole(roleKey),
      orgCode: fb.orgId,
      source: q.ok ? 'fallback_fill' : 'fallback',
    });
    have.add(roleKey);
  }

  if (!presets.length) {
    for (const fb of FALLBACK_PRESETS) {
      presets.push({
        ...fb,
        roleKey: normalizeRole(fb.roleId),
        orgCode: fb.orgId,
        source: 'fallback',
      });
    }
  }

  const withOrg = presets.filter((p) => p.orgId || p.orgName).length;
  return {
    ok: true,
    source: q.ok && presets.some((p) => p.source === 'tag_system') ? 'tag_system' : 'fallback',
    tag_error: q.ok ? null : q.error,
    warn: q.warn || null,
    org_bound: withOrg,
    items: presets,
  };
}

/**
 * 构造对接要求的 userInfo 明文（供服务端自测；浏览器侧自行组包）
 */
export function buildAssistantUserInfoPlain(preset) {
  return {
    userId: preset.userId,
    userName: preset.userName,
    roleId: preset.roleId,
    orgId: preset.orgId || '',
    orgName: preset.orgName || '',
    terminal: preset.terminal || 'C',
    timestamp: Date.now(),
    nonce: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  };
}
