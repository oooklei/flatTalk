/**
 * external-aes-sso.js — 外部系统 AES 加密 SSO 接入模块
 *
 * 处理业务系统通过加密 userInfo 跳转桂小养的完整流程：
 *   1. 解密 userInfo（AES-GCM-128）
 *   2. 解析用户信息
 *   3. 角色编码映射（业务系统 roleId → 桂小养 role_key）
 *   4. 生成 session token
 *   5. 构造 mobile URL
 *
 * 依赖: lib/h5-crypto.js（与 H5AESUtils.java 算法一致）
 */

import { decrypt } from '../lib/h5-crypto.js';

// ========== 配置 ==========

/** 共享密钥（默认与 H5AESUtils.AES_REAL_PERSON_CERTIFICATION 一致） */
const SHARED_AES_KEY = process.env.GXY_EXTERNAL_AES_KEY || 'tr6mxi9go1k9p63j';

/** 时间戳有效窗口（毫秒），默认 ±5 分钟 */
const TIMESTAMP_WINDOW_MS = Number(process.env.GXY_EXTERNAL_TIMESTAMP_WINDOW_MS || 5 * 60 * 1000);

/** session token 有效期（秒），默认 1 小时 */
const SESSION_TOKEN_TTL = Number(process.env.GXY_EXTERNAL_SESSION_TTL || 3600);

/** 已使用 nonce 集合（内存去重，生产环境建议用 Redis） */
const usedNonces = new Set();

/** 定期清理过期 nonce（每 10 分钟） */
setInterval(() => {
  // 简单策略：超过窗口期后清空（生产环境应使用 Redis TTL）
  if (usedNonces.size > 10000) usedNonces.clear();
}, 10 * 60 * 1000);

// ========== 角色编码映射（业务系统 → 桂小养） ==========

const ROLE_ID_TO_DISPLAY = {
  elder: '老人',
  family: '家属',
  elder_family: '家属',
  civil_affairs_staff: '民政局科员',
  grid_worker: '社区网格员',
  institution_admin: '机构管理员',
  org_staff: '机构人员',
  care_worker: '护理员/驾驶员',
  village_doctor: '村医/社区医生',
  provider_staff: '服务商',
  system_admin: '系统管理员',
  admin: '配置管理员',
  guest: '访客',
};

/**
 * 角色归一化映射
 * @param {string} roleId - 业务系统角色编码
 * @returns {string} 桂小养内部 role_key
 */
export function normalizeRole(roleId) {
  if (!roleId) return 'guest';
  const normalized = String(roleId).toLowerCase().trim();
  // 直接匹配
  const directMap = {
    elder: 'elder',
    family: 'family',
    elder_family: 'elder_family',
    civil_affairs_staff: 'civil_affairs_staff',
    grid_worker: 'grid_worker',
    institution_admin: 'institution_admin',
    org_staff: 'org_staff',
    care_worker: 'care_worker',
    village_doctor: 'village_doctor',
    provider_staff: 'provider_staff',
    system_admin: 'system_admin',
    admin: 'admin',
    guest: 'guest',
  };
  return directMap[normalized] || 'guest';
}

// ========== 核心函数 ==========

/**
 * 解密并解析 userInfo 加密串
 * @param {string} cipherText - Base64 编码的 AES-GCM 密文
 * @returns {object} 解析后的用户信息
 * @throws {Error} 解密或解析失败时抛出
 */
export function decryptUserInfo(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') {
    throw new Error('missing_userInfo: userInfo 参数为空');
  }
  let plainText;
  try {
    plainText = decrypt(cipherText.trim(), SHARED_AES_KEY);
  } catch (e) {
    throw new Error(`解密失败: ${e.message}`);
  }
  let userInfo;
  try {
    userInfo = JSON.parse(plainText);
  } catch (e) {
    throw new Error('解密后不是合法 JSON');
  }
  return userInfo;
}

/**
 * 校验时间戳（防重放） - 可选
 * @param {number} timestamp - 毫秒时间戳（可选）
 * @throws {Error} 超出有效窗口时抛出
 */
export function validateTimestamp(timestamp) {
  // 如果没有提供 timestamp，则跳过校验（开发环境友好）
  if (!timestamp || typeof timestamp !== 'number') {
    return;
  }
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  if (diff > TIMESTAMP_WINDOW_MS) {
    throw new Error(`请求已过期（时间戳偏差 ${Math.round(diff / 1000)}s，允许 ±${TIMESTAMP_WINDOW_MS / 1000}s）`);
  }
}

/**
 * 校验 nonce（防重放） - 可选
 * @param {string} nonce - 随机串（可选）
 * @throws {Error} nonce 重复时抛出
 */
export function validateNonce(nonce) {
  // 如果没有提供 nonce，则跳过校验（开发环境友好）
  if (!nonce || typeof nonce !== 'string') {
    return;
  }
  if (usedNonces.has(nonce)) {
    throw new Error('请求已使用（重放攻击）');
  }
  usedNonces.add(nonce);
}

/**
 * 映射角色编码
 * @param {string} roleId - 业务系统角色编码
 * @returns {string} 桂小养内部 role_key
 */
function mapRoleId(roleId) {
  if (!roleId) return 'guest';
  return normalizeRole(roleId);
}

/**
 * 生成 session token
 * @param {object} userInfo - 用户信息
 * @returns {string} session token
 */
export function generateSessionToken(userInfo) {
  const payload = {
    userId: userInfo.userId,
    roleKey: mapRoleId(userInfo.roleId),
    userName: userInfo.userName,
    orgId: userInfo.orgId || '',
    tenantId: userInfo.tenantId || '',
    iat: Date.now(),
    exp: Date.now() + SESSION_TOKEN_TTL * 1000,
    mode: 'external_aes_sso',
  };
  // 使用 Base64URL 编码（无签名，仅用于标识；生产环境应使用 JWT 或 Redis session）
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * 构造 mobile URL
 * @param {string} token - session token
 * @param {object} userInfo - 用户信息
 * @param {string} host - 可选，自定义 host
 * @returns {string} 完整的 mobile URL
 */
export function buildMobileUrl(token, userInfo, host = null) {
  const roleKey = mapRoleId(userInfo.roleId);
  const params = new URLSearchParams({
    token,
    userToken: token,
    roleKey,
    userName: userInfo.userName || '',
    userId: userInfo.userId || '',
    orgId: userInfo.orgId || '',
    orgName: userInfo.orgName || '',
    elderScope: userInfo.elderScope || '',
    terminal: userInfo.terminal || '',
    authLevel: userInfo.authLevel || 'external',
    presetKey: 'external_aes_sso',
  });
  const baseHost = host || ''; // 空则使用相对路径
  return `${baseHost}/mobile.html?${params.toString()}`;
}

/**
 * 主处理函数：解析请求并返回结果
 * @param {string} cipherText - userInfo 加密串
 * @param {object} options - 可选配置 { host }
 * @returns {{ ok: boolean, mobileUrl?: string, expiresIn?: number, error?: string, message?: string, userInfo?: object }}
 */
export function processExternalSsoRequest(cipherText, options = {}) {
  try {
    // 1. 解密
    const userInfo = decryptUserInfo(cipherText);

    // 2. 校验时间戳
    validateTimestamp(userInfo.timestamp);

    // 3. 校验 nonce
    validateNonce(userInfo.nonce);

    // 4. 角色映射
    const roleKey = mapRoleId(userInfo.roleId);
    if (roleKey === 'guest' && userInfo.roleId) {
      throw new Error(`role_not_mapped: 角色编码 "${userInfo.roleId}" 无法映射到桂小养角色`);
    }

    // 5. 生成 token
    const token = generateSessionToken(userInfo);

    // 6. 构造 mobile URL
    const mobileUrl = buildMobileUrl(token, userInfo, options.host);

    return {
      ok: true,
      mode: 'external_aes_sso',
      mobileUrl,
      expiresIn: SESSION_TOKEN_TTL,
      userInfo: {
        userId: userInfo.userId,
        userName: userInfo.userName,
        roleId: userInfo.roleId,
        roleKey,
        roleName: ROLE_ID_TO_DISPLAY[roleKey] || roleKey,
        orgName: userInfo.orgName || '',
      },
    };
  } catch (err) {
    const msg = err.message || '';
    return {
      ok: false,
      error: msg.includes('missing_userInfo') ? 'missing_userInfo'
        : msg.includes('role_not_mapped') ? 'role_not_mapped'
        : msg.includes('解密') || msg.includes('decrypt') ? 'decrypt_failed'
        : msg.includes('JSON') ? 'invalid_json'
        : msg.includes('过期') || msg.includes('expired') ? 'expired_request'
        : msg.includes('重放') || msg.includes('duplicate') ? 'duplicate_nonce'
        : msg.includes('缺少') || msg.includes('missing') ? 'missing_field'
        : 'internal_error',
      message: msg.replace(/^[^:]+:\s*/, ''),
    };
  }
}

export {
  SHARED_AES_KEY,
  TIMESTAMP_WINDOW_MS,
  SESSION_TOKEN_TTL,
  ROLE_ID_TO_DISPLAY,
};