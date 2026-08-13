/**
 * auth-middleware.js — SSO 会话令牌鉴权中间件
 *
 * 从请求中提取 AES 加密的 session token（与 external-aes-sso.js 生成的令牌一致），
 * 复用 decryptSessionToken 进行解密校验，校验通过后把用户身份挂到 req.auth，
 * 供下游路由使用。
 *
 * 令牌读取优先级（避免消费请求体流，保证下游路由仍可读取 body）：
 *   1. Authorization: Bearer <token>          （主路径，推荐）
 *   2. 查询参数 ?token=xxx / ?userToken=xxx   （兼容 SSO 跳转 URL）
 *
 * 返回值约定：
 *   - true  → 鉴权通过（已挂载 req.auth），调用方继续处理路由
 *   - false → 已写回错误响应（401/403），调用方应直接 return
 */

import { decryptSessionToken } from './external-aes-sso.js';

// ========== 白名单配置 ==========

/**
 * 精确匹配的免鉴权路径
 */
const WHITELIST_PATHS = new Set([
  '/mobile.html',
  '/login.html',
  '/api/health',
  '/gxy-assistant',
  '/assistant',
]);

/**
 * 前缀匹配的免鉴权路径（如 /api/sso/dev-login 等登录入口）
 */
const WHITELIST_PREFIXES = [
  '/api/sso/',
  '/api/login/',
  '/api/admin/', // 管理台自身接口（页面在内网，不走移动端 SSO token）
];

/**
 * 视为静态资源的扩展名（静态文件直接放行）
 */
const STATIC_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.js',
  '.png',
  '.svg',
  '.ico',
]);

/**
 * 判断路径是否命中白名单（精确 / 前缀 / 静态扩展名）
 * @param {string} pathname
 * @returns {boolean}
 */
function isPathWhitelisted(pathname) {
  if (!pathname) return false;
  if (WHITELIST_PATHS.has(pathname)) return true;
  for (const prefix of WHITELIST_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  const dot = pathname.lastIndexOf('.');
  if (dot !== -1) {
    const ext = pathname.slice(dot).toLowerCase();
    if (STATIC_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

/**
 * 从请求中提取令牌（不读取请求体，避免消费流）
 * @param {object} req - HTTP 请求
 * @param {URL} url - 已解析的 URL
 * @returns {string|null}
 */
function extractToken(req, url) {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authHeader === 'string' && /^bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^\s*bearer\s+/i, '').trim();
    if (token) return token;
  }
  // 2. 查询参数 token
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  // 3. 查询参数 userToken（兼容 SSO 跳转 URL）
  const userToken = url.searchParams.get('userToken');
  if (userToken) return userToken;
  return null;
}

/**
 * 默认的 JSON 响应写回（当调用方未提供 json 函数时使用）
 */
function defaultJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * 本地/测试环境缺省身份（仅在非严格模式下放行时挂载）
 */
function buildDevAuth() {
  return {
    roleKey: 'system_admin',
    userName: 'dev',
    terminal: 'local',
    userId: 'dev',
    authLevel: 'dev',
  };
}

/**
 * 鉴权中间件
 *
 * @param {object} req - HTTP 请求
 * @param {object} res - HTTP 响应
 * @param {URL} url - 已解析的 URL 对象
 * @param {object} [options]
 * @param {string} [options.runtimeMode='local'] - 运行模式；'production'/'prod' 之外的模式在缺少令牌时放行（开发友好）
 * @param {function} [options.json] - 写回错误响应的 json(res,status,payload) 函数
 * @returns {Promise<boolean>} true 表示通过（已挂载 req.auth），false 表示已写回错误响应
 */
export async function requireAuth(req, res, url, options = {}) {
  const { runtimeMode = 'local', json: jsonFn } = options;
  const respond = typeof jsonFn === 'function' ? jsonFn : defaultJson;
  const strict = runtimeMode === 'production' || runtimeMode === 'prod';

  // 1. 白名单路径直接放行
  if (isPathWhitelisted(url.pathname)) {
    return true;
  }

  // 2. 提取令牌
  const token = extractToken(req, url);

  // 3. 未提供令牌
  if (!token) {
    // 本地/测试环境放行（保持现有开发流程与测试可用）
    if (!strict) {
      req.auth = buildDevAuth();
      return true;
    }
    respond(res, 401, { ok: false, error: 'missing_token', message: '未提供认证令牌' });
    return false;
  }

  // 4. 解密校验令牌
  const payload = decryptSessionToken(token);
  if (!payload) {
    // 生产模式严格拒绝无效令牌；本地/测试模式放行（兼容 dev preset 等明文令牌）
    if (!strict) {
      req.auth = buildDevAuth();
      return true;
    }
    respond(res, 403, { ok: false, error: 'invalid_token', message: '认证令牌无效' });
    return false;
  }

  // 5. 过期校验
  if (payload.exp && Date.now() > payload.exp) {
    respond(res, 403, { ok: false, error: 'expired_token', message: '认证令牌已过期' });
    return false;
  }

  // 6. 挂载用户身份
  req.auth = {
    roleKey: payload.roleKey,
    userName: payload.userName,
    terminal: payload.terminal || '',
    userId: payload.userId,
    city: payload.city,
    orgId: payload.orgId,
    tenantId: payload.tenantId,
    authLevel: payload.mode || 'external',
  };
  return true;
}

export {
  WHITELIST_PATHS,
  WHITELIST_PREFIXES,
  STATIC_EXTENSIONS,
  isPathWhitelisted,
  extractToken,
};
