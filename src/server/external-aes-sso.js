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

import { decrypt, encrypt } from '../lib/h5-crypto.js';

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
const nonceCleanupTimer = setInterval(() => {
  // 简单策略：超过窗口期后清空（生产环境应使用 Redis TTL）
  if (usedNonces.size > 10000) usedNonces.clear();
}, 10 * 60 * 1000);
nonceCleanupTimer.unref?.();

// ========== 角色编码映射（业务系统 → 桂小养） ==========

/**
 * 业务系统 roleId → 桂小养 roleKey 映射表
 * 来源：docs/specs/2026-07-28-role-encoding-crosswalk-design.md
 */
const ROLE_ID_TO_DISPLAY = {
  elder: '老人',
  elder_family: '家属',
  village_doctor: '村医',
  community_doctor: '社区居家-医生',
  care_worker: '护理员',
  community_helper: '社区居家-助老员',
  institution_admin: '机构端-管理员',
  provider_staff: '服务商',
  community_support: '社区居家-后勤',
  community_canteen: '社区居家-食堂',
  community_kitchen: '社区居家-厨房',
  community_guard: '社区居家-门卫',
  community_maintenance: '社区居家-维修',
  senior_official: '厅级干部',
  system_admin: '超级管理员',
  admin: '配置管理员',
  civil_affairs_staff: '民政局科员',
  grid_worker: '社区网格员',
  guest: '访客',
};

/**
 * 业务系统 roleId → 桂小养 roleKey 映射
 * 业务系统使用大写拼音编码，如 LAO_REN、JIA_SHU 等
 */
const ROLE_ID_MAPPING = {
  // ===== 长者 =====
  LAO_REN: 'elder',                    // 老人
  JIA_SHU: 'elder_family',             // 家属
  // ===== 医护 =====
  CUN_YI: 'village_doctor',            // 村医
  'SQJJ-YS': 'community_doctor',       // 社区居家-医生（连字符）
  SQJJ_YS: 'community_doctor',         // 社区居家-医生（下划线兼容）
  // ===== 护理 =====
  nurse: 'care_worker',                // 机构端-护理员
  HU_LI_YUAN: 'care_worker',           // 护理员（旧编码）
  'SQJJ-HLRY': 'care_worker',          // 社区居家-护理人员（连字符）
  SQJJ_HLRY: 'care_worker',            // 社区居家-护理人员（下划线兼容）
  'SQJJ-JSY': 'care_worker',           // 社区居家-驾驶员（连字符）
  SQJJ_JSY: 'care_worker',             // 社区居家-驾驶员（下划线兼容）
  'SQJJ-ZLY': 'community_helper',      // 社区居家-助老员（连字符）
  SQJJ_ZLY: 'community_helper',        // 社区居家-助老员（下划线兼容）
  // ===== 机构管理 =====
  director: 'institution_admin',       // 机构端-院长
  manager: 'institution_admin',        // 机构端-管理员
  'SQJJ-YZ': 'institution_admin',      // 社区居家-院长（连字符）
  SQJJ_YZ: 'institution_admin',        // 社区居家-院长（下划线兼容）
  'SQJJ-GLY': 'institution_admin',     // 社区居家-管理员（连字符）
  SQJJ_GLY: 'institution_admin',       // 社区居家-管理员（下划线兼容）
  // ===== 服务方 =====
  FU_WU_SHANG: 'provider_staff',       // 服务商
  'SQJJ-HQ': 'community_support',      // 社区居家-后勤（连字符）
  SQJJ_HQ: 'community_support',        // 社区居家-后勤（下划线兼容）
  'SQJJ-ST': 'community_canteen',      // 社区居家-食堂（连字符）
  SQJJ_ST: 'community_canteen',        // 社区居家-食堂（下划线兼容）
  'SQJJ-CF': 'community_kitchen',      // 社区居家-厨房（连字符）
  SQJJ_CF: 'community_kitchen',        // 社区居家-厨房（下划线兼容）
  'SQJJ-MW': 'community_guard',        // 社区居家-门卫（连字符）
  SQJJ_MW: 'community_guard',          // 社区居家-门卫（下划线兼容）
  'SQJJ-WX': 'community_maintenance',  // 社区居家-维修（连字符）
  SQJJ_WX: 'community_maintenance',    // 社区居家-维修（下划线兼容）
  // ===== 政府/管理 =====
  TING_JI_GAN_BU: 'senior_official',   // 厅级干部
  CHAO_JI_GUAN_LI_YUAN: 'system_admin', // 超级管理员
  PEI_ZHI_GUAN_LI_YUAN: 'admin',       // 配置管理员
  // ===== 旧编码兼容 =====
  MIN_ZHENG_KE_YUAN: 'civil_affairs_staff',  // 民政局科员
  SHE_QU_WANG_GE_YUAN: 'grid_worker',        // 社区网格员
  XI_TONG_GUAN_LI_YUAN: 'system_admin',      // 系统管理员（旧编码）
  // 兼容直接使用桂小养 roleKey
  elder: 'elder',
  family: 'elder_family',
  elder_family: 'elder_family',
  civil_affairs_staff: 'civil_affairs_staff',
  grid_worker: 'grid_worker',
  institution_admin: 'institution_admin',
  care_worker: 'care_worker',
  village_doctor: 'village_doctor',
  system_admin: 'system_admin',
  community_doctor: 'community_doctor',
  community_helper: 'community_helper',
  provider_staff: 'provider_staff',
  community_support: 'community_support',
  community_canteen: 'community_canteen',
  community_kitchen: 'community_kitchen',
  community_guard: 'community_guard',
  community_maintenance: 'community_maintenance',
  senior_official: 'senior_official',
  admin: 'admin',
};

/**
 * 角色归一化映射
 * @param {string} roleId - 业务系统角色编码
 * @returns {string} 桂小养内部 role_key
 */
export function normalizeRole(roleId) {
  if (!roleId) return 'guest';
  const raw = String(roleId).trim();
  // 优先精确匹配（业务系统编码）
  if (ROLE_ID_MAPPING[raw]) {
    return ROLE_ID_MAPPING[raw];
  }
  // 忽略大小写匹配
  const normalized = raw.toLowerCase();
  for (const [key, value] of Object.entries(ROLE_ID_MAPPING)) {
    if (key.toLowerCase() === normalized) {
      return value;
    }
  }
  return 'guest';
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
 * 从 userInfo 中提取用户姓名（兼容常见异名字段）
 * 业务系统可能使用 userName / name / realName / nickName / accountName 等
 * @param {object} userInfo - 解密后的用户信息
 * @returns {string} 用户姓名，找不到时返回空字符串
 */
function extractUserName(userInfo) {
  if (!userInfo) return '';
  return userInfo.userName
    || userInfo.name
    || userInfo.realName
    || userInfo.nickName
    || userInfo.nickname
    || userInfo.accountName
    || '';
}

/**
 * 从 userInfo 中提取用户所在城市（用于天气查询）
 * 兼容 city / address / location / region 等常见字段
 * @param {object} userInfo - 解密后的用户信息
 * @returns {string} 城市名称，找不到时返回空字符串
 */
function extractUserCity(userInfo) {
  if (!userInfo) return '';
  return userInfo.city
    || userInfo.address
    || userInfo.location
    || userInfo.region
    || userInfo.area
    || '';
}

/**
 * 生成 session token（AES-GCM 加密）
 * @param {object} userInfo - 用户信息
 * @returns {string} 加密后的 session token
 */
export function generateSessionToken(userInfo) {
  const payload = {
    userId: userInfo.userId,
    roleKey: mapRoleId(userInfo.roleId),
    userName: extractUserName(userInfo),
    city: extractUserCity(userInfo),
    orgId: userInfo.orgId || '',
    tenantId: userInfo.tenantId || '',
    iat: Date.now(),
    exp: Date.now() + SESSION_TOKEN_TTL * 1000,
    mode: 'external_aes_sso',
  };
  // 使用 AES-GCM 加密（与 h5-crypto.js 一致）
  const plainText = JSON.stringify(payload);
  return encrypt(plainText, SHARED_AES_KEY);
}

/**
 * 解密 session token
 * @param {string} token - 加密后的 session token
 * @returns {object|null} 解析后的用户信息，解密失败返回 null
 */
export function decryptSessionToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  try {
    const plainText = decrypt(token, SHARED_AES_KEY);
    return JSON.parse(plainText);
  } catch (e) {
    console.error('[decryptSessionToken] 解密失败:', e.message);
    return null;
  }
}

/**
 * 构造 mobile URL
 * @param {string} token - session token（已加密）
 * @param {object} userInfo - 用户信息
 * @param {object} options - 可选配置 { host, port, sslPort, useHttps }
 * @returns {string} 完整的 mobile URL
 */
export function buildMobileUrl(token, userInfo, options = {}) {
  const roleKey = mapRoleId(userInfo.roleId);
  const { host, port, sslPort, useHttps, reqPort } = options;

  // 构建完整 URL
  // 优先使用请求的实际端口（reqPort），确保用户从哪个端口访问就返回哪个端口
  let baseUrl = '';
  if (host) {
    if (useHttps === true) {
      // HTTPS：优先用请求端口，其次 sslPort
      baseUrl = `https://${host}:${reqPort || sslPort || port || '5444'}`;
    } else {
      // HTTP：优先用请求端口，其次运行时端口
      baseUrl = `http://${host}:${reqPort || port || '5298'}`;
    }
  }

  const params = new URLSearchParams({
    token,
    userToken: token,
    roleKey,
    userName: extractUserName(userInfo),
    userId: userInfo.userId || '',
    orgId: userInfo.orgId || '',
    orgName: userInfo.orgName || '',
    city: extractUserCity(userInfo),
    elderScope: userInfo.elderScope || '',
    terminal: userInfo.terminal || '',
    authLevel: userInfo.authLevel || 'external',
    presetKey: 'external_aes_sso',
  });

  return `${baseUrl}/mobile.html?${params.toString()}`;
}

/**
 * 主处理函数：解析请求并返回结果
 * @param {string} cipherText - userInfo 加密串
 * @param {object} options - 可选配置 { host, port, sslPort }
 * @returns {{ ok: boolean, mobileUrl?: string, token?: string, userToken?: string, expiresIn?: number, error?: string, message?: string }}
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

    // 5. 生成 token（已加密）
    const token = generateSessionToken(userInfo);

    // 6. 构造 mobile URL（完整路径）
    const mobileUrl = buildMobileUrl(token, userInfo, options);

    // 7. 返回精简格式
    return {
      ok: true,
      mode: 'external_aes_sso',
      mobileUrl,
      token,
      userToken: token,
      expiresIn: SESSION_TOKEN_TTL,
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
