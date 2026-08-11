# GXY Platform Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all 5 modules from AI对接包-v3 (Python/FastAPI) into flatTalk (Node.js), replacing hardcoded seed data with real GXY platform API calls for find_service and dispatch_manage skills.

**Architecture:** Three-layer separation — skill/lib (field mapping + data assembly), services/gxy-platform (business logic + API orchestration), third/gxy (HTTP transport + HMAC). Reuses existing `src/third/lib/hmac-signature.js`. Does not touch LIS boundary, scene-router, agents, action-dispatcher, or template-fill functions.

**Tech Stack:** Node.js ES Modules, node:http/https, node:crypto, pg (PostgreSQL), existing flatTalk infrastructure.

**Spec:** `docs/superpowers/specs/2026-08-11-gxy-platform-fusion-design.md`

---

## File Structure

### New files (✦)

```
src/third/gxy/
  base-client.js              ✦ Shared HTTP+HMAC wrapper (extracts pattern from gxy-order-sdk.js)
  elder-client.js             ✦ Elder address API client
  service-item-client.js      ✦ Service item catalog client (GET, no HMAC)
  feedback-client.js          ✦ Feedback submit/page client

src/services/gxy-platform/
  index.js                    ✦ Re-export all services
  shared.js                   ✦ Envelope parsing, error codes, ID generators
  elder-service.js            ✦ Elder list (PG) + addresses (API)
  service-item-service.js     ✦ Catalog page + detail
  order-service.js            ✦ Full order CRUD (overwrites src/services/order/)
  workorder-service.js        ✦ Full workorder CRUD (overwrites src/services/workorder/)
  feedback-service.js         ✦ Feedback submit + page

src/skills/find_service/lib/
  field-mapper.js             ✦ Platform camelCase → flatTalk snake_case
  data-assembler.js           ✦ Multi-API orchestration → business_data
  action-handlers.js          ✦ action_id → {assembler, template} mapping
  validators.js               ✦ Order create/cancel field validation

src/skills/dispatch_manage/lib/
  field-mapper.js             ✦ Platform → flatTalk format
  data-assembler.js           ✦ Multi-API orchestration → business_data
  action-handlers.js          ✦ action_id → {assembler, template} mapping
  validators.js               ✦ Workorder create field validation
```

### Modified files (✎)

```
src/services/table-data/index.js      ✎ getFindServiceTables() + getDispatchManageTables()
src/services/table-data/repository.js ✎ Remove fs_*/dm_* seeds, keep others
```

### Untouched files (🔒)

All files in `src/core/` (LIS, scene-router, agents, action-dispatcher, model-service, orchestrator control flow), all other skills, existing `src/third/order/` and `src/third/workorder/` SDKs, all templates.

---

## Task 1: base-client.js — Shared HTTP + HMAC wrapper

**Files:**
- Create: `src/third/gxy/base-client.js`

**Context:** Extracts the shared `post()`/`get()`/`wrapResult()`/`buildBody()` pattern from the existing `gxy-order-sdk.js` into a reusable base. Reuses `src/third/lib/hmac-signature.js` (already exists, identical to Python `signature.py`).

- [ ] **Step 1: Create the base client**

```javascript
// src/third/gxy/base-client.js
/**
 * GXY 平台 HTTP 客户端基类。
 * 复用 src/third/lib/hmac-signature.js 的签名能力。
 * 提取自 gxy-order-sdk.js 的 post/get/wrapResult/buildBody 模式。
 */

import { generateSignatureHeaders } from '../lib/hmac-signature.js';

const DEFAULTS = {
  secret:  process.env.GXY_API_SECRET  || 'sign_U9IAnIMAFv',
  apiUrl:  process.env.GXY_API_URL     || 'https://aiyl-m.yunxida.com/backend-api/portal-api',
  timeout: 10000,
  signMethod: 'POST',
  signPath:   null,
};

/**
 * 创建一个 GXY 平台客户端实例。
 * @param {object} [config] - 覆盖默认配置
 * @returns {{ post, get, config }}
 */
export function createGxyClient(config = {}) {
  const cfg = { ...DEFAULTS, ...config };

  async function post(path, payload) {
    const bodyPayload = buildBody(payload);
    const bodyJson = JSON.stringify(bodyPayload);
    const signInfo = generateSignatureHeaders({
      secret: cfg.secret,
      method: cfg.signMethod,
      path:   cfg.signPath,
      body:   bodyJson,
    });
    const result = await httpRequest(cfg.apiUrl + path, {
      method:  'POST',
      headers: signInfo.headers,
      body:    bodyJson,
      timeout: cfg.timeout,
    });
    return wrapResult(result);
  }

  async function get(path, params) {
    const qs = Object.keys(params || {})
      .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    const fullUrl = cfg.apiUrl + path + (qs ? '?' + qs : '');
    const signInfo = generateSignatureHeaders({
      secret: cfg.secret,
      method: 'GET',
      path:   cfg.signPath,
      body:   null,
    });
    const result = await httpRequest(fullUrl, {
      method:  'GET',
      headers: signInfo.headers,
      body:    null,
      timeout: cfg.timeout,
    });
    return wrapResult(result);
  }

  /**
   * 无签名 GET（用于白名单公开接口如 serviceItem）
   */
  async function getUnsigned(path, params) {
    const qs = Object.keys(params || {})
      .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    const fullUrl = cfg.apiUrl + path + (qs ? '?' + qs : '');
    const result = await httpRequest(fullUrl, {
      method:  'GET',
      headers: { Accept: 'application/json' },
      body:    null,
      timeout: cfg.timeout,
    });
    return wrapResult(result);
  }

  return { post, get, getUnsigned, config: cfg };
}

function buildBody(payload) {
  const result = {};
  Object.keys(payload || {}).forEach(k => {
    const v = payload[k];
    if (v !== null && v !== undefined && v !== '') {
      result[k] = v;
    }
  });
  return result;
}

function wrapResult(result) {
  const isSuccess = result.status === 200
    && result.data
    && (result.data.success === true || result.data.code === 0 || result.data.code === 200);
  return { ok: isSuccess, status: result.status, data: result.data };
}

function httpRequest(url, options) {
  return new Promise((resolve, reject) => {
    import('node:http').then(http => {
      import('node:https').then(https => {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        const reqOptions = {
          hostname: parsedUrl.hostname,
          port:     parsedUrl.port || (isHttps ? 443 : 80),
          path:     parsedUrl.pathname + parsedUrl.search,
          method:   options.method || 'GET',
          headers:  options.headers || {},
          timeout:  options.timeout || 10000,
        };
        const req = httpModule.request(reqOptions, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            let data;
            try { data = JSON.parse(body); } catch { data = body; }
            resolve({ status: res.statusCode, data });
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (options.body) req.write(options.body);
        req.end();
      });
    });
  });
}
```

- [ ] **Step 2: Verify import works**

Run: `node -e "import('./src/third/gxy/base-client.js').then(m => console.log('OK', typeof m.createGxyClient))"`
Expected: `OK function`

- [ ] **Step 3: Commit**

```bash
git add src/third/gxy/base-client.js
git commit -m "feat: add GXY base HTTP client with HMAC signing"
```

---

## Task 2: elder-client.js — Elder address API client

**Files:**
- Create: `src/third/gxy/elder-client.js`

**Context:** Port of `gxy_elder.py`. Only one method: `pageAddresses(userId, tag)`.

- [ ] **Step 1: Create the client**

```javascript
// src/third/gxy/elder-client.js
/**
 * 桂小养老人管理客户端。
 * 移植自 AI对接包-v3/backend/app/clients/gxy_elder.py
 *
 * 接口：POST /openapi/elder/address/page — 分页查询老人地址（含经纬度）
 */

import { createGxyClient } from './base-client.js';

export const ADDRESS_TAG = {
  HOME: 'home',
  HOSPITAL: 'hospital',
  OTHER: 'other',
};

export function createElderClient(config) {
  const client = createGxyClient(config);

  async function pageAddresses(userId, tag) {
    const payload = { userId, pageNo: 1, pageSize: 20 };
    if (tag) payload.tag = tag;
    return client.post('/openapi/elder/address/page', payload);
  }

  return { pageAddresses };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/third/gxy/elder-client.js
git commit -m "feat: add GXY elder address client"
```

---

## Task 3: service-item-client.js — Service item catalog (GET, no HMAC)

**Files:**
- Create: `src/third/gxy/service-item-client.js`

**Context:** Port of `gxy_service_item.py`. Uses `getUnsigned` because serviceItem endpoints are whitelist public GET (no HMAC needed).

- [ ] **Step 1: Create the client**

```javascript
// src/third/gxy/service-item-client.js
/**
 * 桂小养服务项目目录客户端。
 * 移植自 AI对接包-v3/backend/app/clients/gxy_service_item.py
 *
 * 白名单公开 GET 接口，无需 HMAC 签名：
 *   GET /serviceItem/pageByType — 分页查询项目列表
 *   GET /serviceItem/detail     — 查询项目详情
 */

import { createGxyClient } from './base-client.js';

export function createServiceItemClient(config) {
  const client = createGxyClient(config);

  async function pageByType(params) {
    return client.getUnsigned('/serviceItem/pageByType', params);
  }

  async function getDetail(itemId) {
    return client.getUnsigned('/serviceItem/detail', { id: itemId });
  }

  return { pageByType, getDetail };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/third/gxy/service-item-client.js
git commit -m "feat: add GXY service-item catalog client"
```

---

## Task 4: feedback-client.js — Feedback submit/page client

**Files:**
- Create: `src/third/gxy/feedback-client.js`

- [ ] **Step 1: Create the client**

```javascript
// src/third/gxy/feedback-client.js
/**
 * 桂小养反馈意见客户端。
 * 移植自 AI对接包-v3/backend/app/clients/gxy_feedback.py
 *
 * 接口：
 *   POST /openapi/feedback/submit — 提交反馈
 *   POST /openapi/feedback/page   — 分页查询反馈列表
 */

import { createGxyClient } from './base-client.js';

export const FEEDBACK_TYPE = {
  COURSE: 'course', ACTIVITY: 'activity', FACILITY: 'facility',
  SERVICE: 'service', SYSTEM: 'system', OTHER: 'other',
};

export const FEEDBACK_SOURCE = { APP: 'app', WEB: 'web' };

export function createFeedbackClient(config) {
  const client = createGxyClient(config);

  async function submit(payload) {
    return client.post('/openapi/feedback/submit', payload);
  }

  async function page(payload) {
    return client.post('/openapi/feedback/page', payload);
  }

  return { submit, page };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/third/gxy/feedback-client.js
git commit -m "feat: add GXY feedback client"
```

---

## Task 5: gxy-platform/shared.js — Envelope parsing + helpers

**Files:**
- Create: `src/services/gxy-platform/shared.js`

**Context:** Port of the `_ok`/`_err`/`_to_platform_result` helpers from the Python services. Also includes ID generators and service type inference.

- [ ] **Step 1: Create shared utilities**

```javascript
// src/services/gxy-platform/shared.js
/**
 * GXY 平台共享工具：信封解析、错误码、ID 生成、服务类型推断。
 * 移植自 AI对接包-v3 各 service 文件中的公共函数。
 */

import crypto from 'node:crypto';

export const CODE_OK = 'OK';

export function ok(data, message = '操作成功') {
  return { code: CODE_OK, message, data };
}

export function err(code, message) {
  return { code, message, data: null };
}

/**
 * 把 GXY SDK 返回的 { ok, status, data } 包装为统一信封 { code, message, data }。
 * 平台返回体兼容两种格式：
 *   - { success: true, result: ... }  → 取 result
 *   - { code: 0, data: ... }          → 取 data
 */
export function toPlatformResult(resp, okMessage) {
  if (resp?.ok) {
    const body = resp.data;
    const result = (body && typeof body === 'object')
      ? (body.result ?? body.data ?? body)
      : body;
    return ok(result, okMessage);
  }
  const data = resp?.data;
  const message = (data && typeof data === 'object')
    ? (data.message || '调用桂小养平台失败')
    : String(data || '调用桂小养平台失败');
  return err('PLATFORM_ERROR', message);
}

/**
 * 生成订单号：GD + 时间戳 + 6 位随机数。
 */
export function generateOrderNo() {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = crypto.randomInt(100000, 999999);
  return `GD${ts}${rand}`;
}

/**
 * 生成工单号：GXWO + 时间戳 + 6 位随机数。
 */
export function generateWorkOrderNo() {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = crypto.randomInt(100000, 999999);
  return `GXWO${ts}${rand}`;
}

/**
 * 按服务项目名称推断 serviceType。
 */
export function inferServiceType(itemName) {
  const name = String(itemName || '');
  if (/网格|巡查|巡访/.test(name)) return 'grid';
  if (/村医|医生/.test(name)) return 'doctor';
  return 'nurse';
}
```

- [ ] **Step 2: Verify**

Run: `node -e "import('./src/services/gxy-platform/shared.js').then(m => console.log(m.generateOrderNo(), m.inferServiceType('上门护理')))"`
Expected: `GD20260811... nurse`

- [ ] **Step 3: Commit**

```bash
git add src/services/gxy-platform/shared.js
git commit -m "feat: add GXY platform shared utilities"
```

---

## Task 6: elder-service.js — Elder list (PG) + addresses (API)

**Files:**
- Create: `src/services/gxy-platform/elder-service.js`

**Context:** Port of `elder_service.py`. Elder list queries PostgreSQL `user_center_user` table. Addresses call GXY platform API. Uses the existing `pg-tag-reader.js` pattern for PG access.

- [ ] **Step 1: Read existing PG accessor pattern**

Check `src/services/interface-data/pg-tag-reader.js` to understand how flatTalk connects to PostgreSQL. Use the same connection string pattern.

- [ ] **Step 2: Create the service**

```javascript
// src/services/gxy-platform/elder-service.js
/**
 * 老人服务：老人列表（PG user_center_user）+ 老人地址（GXY 平台 API）。
 * 移植自 AI对接包-v3/backend/app/services/elder_service.py
 */

import pg from 'pg';
import { createElderClient } from '../../third/gxy/elder-client.js';
import { ok, err } from './shared.js';

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:123456@localhost:5432/tag_system';

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  }
  return _pool;
}

/**
 * 查询老人列表。
 * @param {object} [opts] - { keyword, limit }
 * @returns {Promise<Array<{id,name,phone,account}>>}
 */
export async function listElders({ keyword, limit = 200 } = {}) {
  const pool = getPool();
  let sql = "SELECT user_id, user_name, user_phone, user_account FROM user_center_user WHERE entity_type = 'ELDER'";
  const params = [];
  if (keyword) {
    sql += ' AND (user_name ILIKE $1 OR user_account ILIKE $1 OR user_phone LIKE $1)';
    params.push(`%${keyword}%`);
  }
  sql += ' ORDER BY user_name LIMIT $' + (params.length + 1);
  params.push(limit);

  const { rows } = await pool.query(sql, params);
  return rows
    .map(r => ({
      id: String(r.user_id || '').trim(),
      name: String(r.user_name || '').trim() || String(r.user_id || '').trim(),
      phone: String(r.user_phone || '').trim(),
      account: String(r.user_account || '').trim(),
    }))
    .filter(e => e.id);
}

/**
 * 查询老人地址列表（含经纬度）。
 * @param {string} userId
 * @returns {Promise<{code,message,data}>}
 */
export async function listElderAddresses(userId) {
  if (!userId) {
    return err('FIELD_INVALID', '老人ID不能为空');
  }
  const client = createElderClient();
  const resp = await client.pageAddresses(userId);
  if (!resp.ok) {
    const data = resp.data;
    const message = (data && typeof data === 'object') ? (data.message || '调用桂小养平台失败') : '调用桂小养平台失败';
    return err('PLATFORM_ERROR', message);
  }
  const body = resp.data;
  const page = (body && typeof body === 'object') ? (body.result ?? body.data) : null;
  const records = (page && typeof page === 'object') ? (page.records || []) : [];
  return ok(records, '查询老人地址成功');
}
```

- [ ] **Step 3: Verify PG connection**

Run: `node -e "import('./src/services/gxy-platform/elder-service.js').then(async m => { const r = await m.listElders({ limit: 3 }); console.log('elders:', r.length, r[0]); })"`
Expected: `elders: 3 { id: '...', name: '...', phone: '...', account: '...' }`

- [ ] **Step 4: Commit**

```bash
git add src/services/gxy-platform/elder-service.js
git commit -m "feat: add GXY elder service with PG + API support"
```

---

## Task 7: service-item-service.js — Catalog page + detail

**Files:**
- Create: `src/services/gxy-platform/service-item-service.js`

- [ ] **Step 1: Create the service**

```javascript
// src/services/gxy-platform/service-item-service.js
/**
 * 服务项目服务：目录分页 + 详情。
 * 移植自 AI对接包-v3/backend/app/services/service_item_service.py
 */

import { createServiceItemClient } from '../../third/gxy/service-item-client.js';
import { ok, err, toPlatformResult } from './shared.js';

const STRING_PARAMS = ['serviceTypeId', 'itemName', 'regionCode', 'userLong', 'userLat'];
const NUMBER_PARAMS = ['minPrice', 'maxPrice', 'maxDistance'];

export async function pageServiceItems(payload = {}) {
  const client = createServiceItemClient();
  const params = {};
  for (const key of STRING_PARAMS) {
    if (payload[key]) params[key] = payload[key];
  }
  for (const key of NUMBER_PARAMS) {
    if (payload[key] != null) params[key] = payload[key];
  }
  params.pageNo = payload.pageNo || 1;
  params.pageSize = payload.pageSize || 10;
  const resp = await client.pageByType(params);
  return toPlatformResult(resp, '查询服务项目列表成功');
}

export async function getServiceItemDetail(itemId) {
  if (!itemId) {
    return err('FIELD_INVALID', '项目ID不能为空');
  }
  const client = createServiceItemClient();
  const resp = await client.getDetail(itemId);
  return toPlatformResult(resp, '查询服务项目详情成功');
}
```

- [ ] **Step 2: Verify**

Run: `node -e "import('./src/services/gxy-platform/service-item-service.js').then(async m => { const r = await m.pageServiceItems({ pageSize: 3 }); console.log('code:', r.code, 'count:', r.data?.records?.length || 0); })"`
Expected: `code: OK count: 3`

- [ ] **Step 3: Commit**

```bash
git add src/services/gxy-platform/service-item-service.js
git commit -m "feat: add GXY service-item service"
```

---

## Task 8: feedback-service.js — Feedback submit + page

**Files:**
- Create: `src/services/gxy-platform/feedback-service.js`

- [ ] **Step 1: Create the service**

```javascript
// src/services/gxy-platform/feedback-service.js
/**
 * 反馈意见服务。
 * 移植自 AI对接包-v3/backend/app/services/feedback_service.py
 * 注意：submit 接口平台侧已知故障（需登录上下文），代码写好等修复。
 */

import { createFeedbackClient } from '../../third/gxy/feedback-client.js';
import { ok, err, toPlatformResult } from './shared.js';

export async function submitFeedback(payload = {}) {
  if (!payload.feedbackType) {
    return err('FIELD_INVALID', '反馈类型(feedbackType)不能为空');
  }
  if (!payload.content) {
    return err('FIELD_INVALID', '反馈内容(content)不能为空');
  }
  const client = createFeedbackClient();
  const resp = await client.submit(payload);
  return toPlatformResult(resp, '反馈提交成功');
}

export async function pageFeedback(payload = {}) {
  const client = createFeedbackClient();
  const resp = await client.page(payload);
  return toPlatformResult(resp, '查询反馈列表成功');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/gxy-platform/feedback-service.js
git commit -m "feat: add GXY feedback service"
```

---

## Task 9: order-service.js — Full order CRUD (overwrite)

**Files:**
- Create: `src/services/gxy-platform/order-service.js`

**Context:** Port of `order_service.py`. Reuses the EXISTING `src/third/order/gxy-order-sdk.js` (already verified working). Adds business logic: orderNo auto-generation, field validation, envelope parsing.

- [ ] **Step 1: Create the service with try/catch on all SDK calls**

The existing `gxy-order-sdk.js` throws on missing required fields (e.g., `page()` throws if `elderId` is empty per L78 of the SDK). All SDK-calling methods must catch and return `FIELD_INVALID` instead of crashing.

```javascript
// src/services/gxy-platform/order-service.js
/**
 * 订单服务：同步/查询/分页/取消/评价/时间轴。
 * 移植自 AI对接包-v3/backend/app/services/order_service.py
 *
 * 复用已有的 src/third/order/gxy-order-sdk.js（端点一致，已验证可用）。
 * 本文件覆写 src/services/order/order-service.js（当前 write 方法零调用点）。
 */

import * as gxyOrderSdk from '../../third/order/gxy-order-sdk.js';
import { ok, err, toPlatformResult, generateOrderNo } from './shared.js';

/**
 * 同步订单（创建/更新）。orderNo 缺省时自动生成，保证幂等。
 */
export async function syncOrder(payload = {}) {
  if (!payload.elderId) {
    return err('FIELD_INVALID', '老人ID(elderId)不能为空');
  }
  if (!payload.orderNo) {
    payload = { ...payload, orderNo: generateOrderNo() };
  }
  try {
    const resp = await gxyOrderSdk.sync(payload);
    return toPlatformResult(resp, '订单同步成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getOrderDetail(orderId) {
  if (!orderId) {
    return err('FIELD_INVALID', '订单ID(orderId)不能为空');
  }
  try {
    const resp = await gxyOrderSdk.getDetail(orderId);
    return toPlatformResult(resp, '查询订单详情成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getOrderPage(payload = {}) {
  try {
    const resp = await gxyOrderSdk.page(payload);
    return toPlatformResult(resp, '查询订单列表成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function cancelOrder(orderId, reason = '') {
  if (!orderId) {
    return err('FIELD_INVALID', '订单ID(orderId)不能为空');
  }
  try {
    const resp = await gxyOrderSdk.cancel({ orderId, cancelReason: reason });
    return toPlatformResult(resp, '订单取消成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function evaluateOrder(orderId, rating, evaluateContent = '', tags = null) {
  if (!orderId) {
    return err('FIELD_INVALID', '订单ID(orderId)不能为空');
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return err('FIELD_INVALID', '评分必须为 1-5');
  }
  if (tags && tags.length > 10) {
    return err('FIELD_INVALID', '评价标签最多 10 个');
  }
  try {
    const resp = await gxyOrderSdk.evaluate({ orderId, rating, evaluateContent, evaluateTags: tags });
    return toPlatformResult(resp, '订单评价成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getOrderTimeline(orderId) {
  if (!orderId) {
    return err('FIELD_INVALID', '订单ID(orderId)不能为空');
  }
  try {
    const resp = await gxyOrderSdk.getTimeline(orderId);
    return toPlatformResult(resp, '查询订单时间轴成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}
```

- [ ] **Step 2: Verify empty elderId returns FIELD_INVALID (not crash)**

Run: `node -e "import('./src/services/gxy-platform/order-service.js').then(async m => { const r = await m.getOrderPage({ elderId: '', pageNo: 1, pageSize: 3 }); console.log('code:', r.code, 'msg:', r.message); })"`
Expected: `code: FIELD_INVALID msg: page() 缺少必填字段: elderId`

- [ ] **Step 3: Commit**

```bash
git add src/services/gxy-platform/order-service.js
git commit -m "feat: add GXY order service with full CRUD"
```

---

## Task 10: workorder-service.js — Full workorder CRUD (overwrite)

**Files:**
- Create: `src/services/gxy-platform/workorder-service.js`

**Context:** Port of `workorder_service.py`. Reuses existing `src/third/workorder/gxy-workorder-sdk.js`. Same pattern as order-service.js.

- [ ] **Step 1: Read the existing workorder SDK to confirm method names**

Read `src/third/workorder/gxy-workorder-sdk.js` to verify export names (sync, getDetail, page, cancel, getProgress, getTimeline).

- [ ] **Step 2: Create the service**

```javascript
// src/services/gxy-platform/workorder-service.js
/**
 * 工单服务：同步/查询/分页/取消/进度/时间轴。
 * 移植自 AI对接包-v3/backend/app/services/workorder_service.py
 *
 * 复用已有的 src/third/workorder/gxy-workorder-sdk.js。
 * 本文件覆写 src/services/workorder/workorder-service.js。
 */

import * as gxyWorkorderSdk from '../../third/workorder/gxy-workorder-sdk.js';
import { ok, err, toPlatformResult, generateWorkOrderNo } from './shared.js';

export async function syncWorkorder(payload = {}) {
  if (!payload.elderId) {
    return err('FIELD_INVALID', '老人ID(elderId)不能为空');
  }
  if (!payload.workOrderNo) {
    payload = { ...payload, workOrderNo: generateWorkOrderNo() };
  }
  try {
    const resp = await gxyWorkorderSdk.sync(payload);
    return toPlatformResult(resp, '工单同步成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getWorkorderDetail(workOrderId) {
  if (!workOrderId) {
    return err('FIELD_INVALID', '工单ID(workOrderId)不能为空');
  }
  try {
    const resp = await gxyWorkorderSdk.getDetail(workOrderId);
    return toPlatformResult(resp, '查询工单详情成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getWorkorderPage(payload = {}) {
  try {
    const resp = await gxyWorkorderSdk.page(payload);
    return toPlatformResult(resp, '查询工单列表成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function cancelWorkorder(workOrderId, reason = '') {
  if (!workOrderId) {
    return err('FIELD_INVALID', '工单ID(workOrderId)不能为空');
  }
  try {
    const resp = await gxyWorkorderSdk.cancel({ workOrderId, cancelReason: reason });
    return toPlatformResult(resp, '工单取消成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getWorkorderProgress(workOrderId) {
  if (!workOrderId) {
    return err('FIELD_INVALID', '工单ID(workOrderId)不能为空');
  }
  try {
    const resp = await gxyWorkorderSdk.getProgress(workOrderId);
    return toPlatformResult(resp, '查询工单进度成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}

export async function getWorkorderTimeline(workOrderId) {
  if (!workOrderId) {
    return err('FIELD_INVALID', '工单ID(workOrderId)不能为空');
  }
  try {
    const resp = await gxyWorkorderSdk.getTimeline(workOrderId);
    return toPlatformResult(resp, '查询工单时间轴成功');
  } catch (e) {
    return err('FIELD_INVALID', e.message);
  }
}
```

- [ ] **Step 3: Verify**

Run: `node -e "import('./src/services/gxy-platform/workorder-service.js').then(async m => { const r = await m.getWorkorderPage({ pageNo: 1, pageSize: 3 }); console.log('code:', r.code, 'total:', r.data?.total || 0); })"`
Expected: `code: OK total: 9974`

- [ ] **Step 4: Commit**

```bash
git add src/services/gxy-platform/workorder-service.js
git commit -m "feat: add GXY workorder service with full CRUD"
```

---

## Task 11: gxy-platform/index.js — Re-export all services

**Files:**
- Create: `src/services/gxy-platform/index.js`

- [ ] **Step 1: Create the index**

```javascript
// src/services/gxy-platform/index.js
/**
 * GXY 平台服务统一出口。
 */

export {
  listElders,
  listElderAddresses,
} from './elder-service.js';

export {
  pageServiceItems,
  getServiceItemDetail,
} from './service-item-service.js';

export {
  syncOrder,
  getOrderDetail,
  getOrderPage,
  cancelOrder,
  evaluateOrder,
  getOrderTimeline,
} from './order-service.js';

export {
  syncWorkorder,
  getWorkorderDetail,
  getWorkorderPage,
  cancelWorkorder,
  getWorkorderProgress,
  getWorkorderTimeline,
} from './workorder-service.js';

export {
  submitFeedback,
  pageFeedback,
} from './feedback-service.js';

export {
  ok,
  err,
  toPlatformResult,
  generateOrderNo,
  generateWorkOrderNo,
  inferServiceType,
} from './shared.js';
```

- [ ] **Step 2: Commit**

```bash
git add src/services/gxy-platform/index.js
git commit -m "feat: add GXY platform service index"
```

---

## Task 12: find_service/lib/field-mapper.js + validators.js

**Files:**
- Create: `src/skills/find_service/lib/field-mapper.js`
- Create: `src/skills/find_service/lib/validators.js`

**Context:** field-mapper maps platform camelCase → flatTalk snake_case (consumed by `fillFindServiceCard` at model-service.js L2027-2038). validators checks the 19 required fields for order creation.

- [ ] **Step 1: Create field-mapper.js**

```javascript
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
```

- [ ] **Step 2: Create validators.js**

```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add src/skills/find_service/lib/field-mapper.js src/skills/find_service/lib/validators.js
git commit -m "feat: add find_service field-mapper and validators"
```

---

## Task 13: find_service/lib/data-assembler.js + action-handlers.js

**Files:**
- Create: `src/skills/find_service/lib/data-assembler.js`
- Create: `src/skills/find_service/lib/action-handlers.js`

**Context:** data-assembler orchestrates multiple gxy-platform service calls and returns business_data with the same shape that `fillFindServiceCard` expects. action-handlers maps action_id → { assembler, template }.

- [ ] **Step 1: Create data-assembler.js**

```javascript
// src/skills/find_service/lib/data-assembler.js
/**
 * find_service 数据装配器。
 * 编排 gxy-platform 服务调用，返回 business_data。
 *
 * 返回值 shape 对齐 fillFindServiceCard (model-service.js L2027-2038)：
 *   { service_catalog, orgs, workers, orders, source }
 */

import { pageServiceItems } from '../../../services/gxy-platform/service-item-service.js';
import { getOrderPage, getOrderDetail, syncOrder } from '../../../services/gxy-platform/order-service.js';
import { listElderAddresses } from '../../../services/gxy-platform/elder-service.js';
import {
  mapServiceItems,
  mapOrders,
  mapElderAddresses,
  extractOrgsFromOrders,
  extractWorkersFromOrders,
} from './field-mapper.js';
import { validateOrder } from './validators.js';

const SOURCE_OK = 'gxy_platform';
const SOURCE_EMPTY = 'gxy_platform_empty';
const SOURCE_ERROR = 'gxy_platform_error';

/**
 * 主入口：根据 action 和 params 装配 business_data。
 * 由 table-data/index.js 的 getFindServiceTables() 调用。
 */
export async function assembleFindServiceData(params = {}) {
  const action = params.action || params.intent || '';
  const handler = ACTION_HANDLERS[action] || ACTION_HANDLERS['find_service.recommend'];
  return handler(params);
}

/**
 * 装配服务目录。
 */
async function assembleCatalog(params = {}) {
  try {
    const resp = await pageServiceItems({ pageSize: 50, ...params });
    if (resp.code !== 'OK') {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
    }
    const records = resp.data?.records || [];
    const catalog = mapServiceItems(records);
    if (catalog.length === 0) {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_EMPTY };
    }
    return { service_catalog: catalog, orgs: [], workers: [], orders: [], source: SOURCE_OK };
  } catch (e) {
    console.warn('[find_service] assembleCatalog failed:', e.message);
    return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
  }
}

/**
 * 装配订单列表。
 */
async function assembleOrderList(params = {}) {
  const { elderId, orderId } = params;
  try {
    let resp;
    if (orderId) {
      resp = await getOrderDetail(orderId);
    } else if (elderId) {
      resp = await getOrderPage({ elderId, pageNo: 1, pageSize: 20 });
    } else {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_EMPTY };
    }
    if (resp.code !== 'OK') {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
    }
    const records = orderId ? (resp.data ? [resp.data] : []) : (resp.data?.records || []);
    const orders = mapOrders(records);
    const orgs = extractOrgsFromOrders(orders);
    const workers = extractWorkersFromOrders(orders);
    if (orders.length === 0) {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_EMPTY };
    }
    return { service_catalog: [], orgs, workers, orders, source: SOURCE_OK };
  } catch (e) {
    console.warn('[find_service] assembleOrderList failed:', e.message);
    return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
  }
}

/**
 * 装配订单预览（下单前）。
 */
async function assembleOrderPreview(params = {}) {
  try {
    const [catalogResp, addrResp] = await Promise.all([
      pageServiceItems({ itemName: params.service_name, pageSize: 10 }),
      params.elderId ? listElderAddresses(params.elderId) : Promise.resolve({ code: 'OK', data: [] }),
    ]);
    const catalog = mapServiceItems(catalogResp.data?.records || []);
    const addresses = mapElderAddresses(addrResp.data || []);
    return {
      service_catalog: catalog,
      orgs: [],
      workers: [],
      orders: [],
      elder_addresses: addresses,
      source: SOURCE_OK,
    };
  } catch (e) {
    console.warn('[find_service] assembleOrderPreview failed:', e.message);
    return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
  }
}

/**
 * 装配下单确认（执行下单）。
 */
async function assembleBookingConfirm(params = {}) {
  try {
    const validation = validateOrder(params.orderFields || {}, {
      elders: params.candidateElders,
      serviceItems: params.candidateServiceItems,
    });
    if (!validation.valid) {
      return {
        service_catalog: [], orgs: [], workers: [], orders: [],
        validation_error: validation,
        source: SOURCE_ERROR,
      };
    }
    const resp = await syncOrder(params.orderFields);
    if (resp.code !== 'OK') {
      return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR, error: resp.message };
    }
    const orders = mapOrders(resp.data ? [resp.data] : []);
    return { service_catalog: [], orgs: [], workers: [], orders, source: SOURCE_OK };
  } catch (e) {
    console.warn('[find_service] assembleBookingConfirm failed:', e.message);
    return { service_catalog: [], orgs: [], workers: [], orders: [], source: SOURCE_ERROR };
  }
}

const ACTION_HANDLERS = {
  'find_service.recommend':      assembleCatalog,
  'find_service.catalog':        assembleCatalog,
  'find_service.detail_service': assembleCatalog,
  'find_service.list_orgs':      assembleCatalog,
  'find_service.list_workers':   assembleCatalog,
  'find_service.detail_order':   assembleOrderList,
  'find_service.preview_order':  assembleOrderPreview,
  'find_service.booking_confirm': assembleBookingConfirm,
  'find_service.booking_success': assembleBookingConfirm,
  'find_service.order_ticket':   assembleBookingConfirm,
};
```

- [ ] **Step 2: Create action-handlers.js**

```javascript
// src/skills/find_service/lib/action-handlers.js
/**
 * find_service action → template 映射表。
 * 与 action-dispatcher.js L111-123 保持一致。
 */

export const FIND_SERVICE_ACTION_MAP = {
  'find_service.recommend':       'service_recommend',
  'find_service.catalog':         'service_catalog',
  'find_service.detail_service':  'service_detail',
  'find_service.list_orgs':       'org_profile',
  'find_service.list_workers':    'worker_profile',
  'find_service.detail_order':    'order_status',
  'find_service.preview_order':   'order_preview',
  'find_service.booking_confirm': 'service_booking_confirm',
  'find_service.booking_success': 'booking_success',
  'find_service.contact_confirm': 'contact_confirm',
  'find_service.order_ticket':    'service_order_ticket',
  'find_service.booking_reschedule': 'booking_reschedule',
};

export function getTemplateForAction(actionKey) {
  return FIND_SERVICE_ACTION_MAP[actionKey] || 'service_recommend';
}
```

- [ ] **Step 3: Commit**

```bash
git add src/skills/find_service/lib/data-assembler.js src/skills/find_service/lib/action-handlers.js
git commit -m "feat: add find_service data-assembler and action-handlers"
```

---

## Task 14: dispatch_manage/lib/ — 4 files (same pattern as find_service)

**Files:**
- Create: `src/skills/dispatch_manage/lib/field-mapper.js`
- Create: `src/skills/dispatch_manage/lib/data-assembler.js`
- Create: `src/skills/dispatch_manage/lib/action-handlers.js`
- Create: `src/skills/dispatch_manage/lib/validators.js`

**Context:** Same pattern as find_service/lib but for workorders. Maps to `fillDispatchManageCard` (model-service.js L2418-2424) which consumes `bd.dispatch_orders` and `bd.orders`.

- [ ] **Step 1: Create field-mapper.js**

```javascript
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
```

- [ ] **Step 2: Create validators.js**

```javascript
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
```

- [ ] **Step 3: Create data-assembler.js**

```javascript
// src/skills/dispatch_manage/lib/data-assembler.js
/**
 * dispatch_manage 数据装配器。
 * 返回值 shape 对齐 fillDispatchManageCard (model-service.js L2418-2424)：
 *   { dispatch_orders, orders, workers, source }
 */

import {
  getWorkorderPage,
  getWorkorderDetail,
  getWorkorderProgress,
  syncWorkorder,
} from '../../../services/gxy-platform/workorder-service.js';
import { mapWorkorders, extractWorkersFromWorkorders } from './field-mapper.js';
import { validateWorkorder } from './validators.js';

const SOURCE_OK = 'gxy_platform';
const SOURCE_EMPTY = 'gxy_platform_empty';
const SOURCE_ERROR = 'gxy_platform_error';

export async function assembleDispatchData(params = {}) {
  const action = params.action || params.intent || '';
  const handler = ACTION_HANDLERS[action] || ACTION_HANDLERS['dispatch_manage.list'];
  return handler(params);
}

async function assembleDispatchList(params = {}) {
  const { elderId, workOrderId } = params;
  try {
    let resp;
    if (workOrderId) {
      resp = await getWorkorderDetail(workOrderId);
    } else {
      resp = await getWorkorderPage({ elderId, pageNo: 1, pageSize: 20 });
    }
    if (resp.code !== 'OK') {
      return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
    }
    const records = workOrderId ? (resp.data ? [resp.data] : []) : (resp.data?.records || []);
    const workorders = mapWorkorders(records);
    const workers = extractWorkersFromWorkorders(workorders);
    if (workorders.length === 0) {
      return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_EMPTY };
    }
    return { dispatch_orders: workorders, orders: [], workers, source: SOURCE_OK };
  } catch (e) {
    console.warn('[dispatch_manage] assembleDispatchList failed:', e.message);
    return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
  }
}

async function assembleDispatchStatus(params = {}) {
  const { workOrderId } = params;
  if (!workOrderId) {
    return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_EMPTY };
  }
  try {
    const resp = await getWorkorderProgress(workOrderId);
    if (resp.code !== 'OK') {
      return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
    }
    const workorders = mapWorkorders(resp.data ? [resp.data] : []);
    return { dispatch_orders: workorders, orders: [], workers: [], source: SOURCE_OK };
  } catch (e) {
    return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
  }
}

async function assembleDispatchSync(params = {}) {
  try {
    const validation = validateWorkorder(params.workorderFields || {}, {
      elders: params.candidateElders,
    });
    if (!validation.valid) {
      return { dispatch_orders: [], orders: [], workers: [], validation_error: validation, source: SOURCE_ERROR };
    }
    const resp = await syncWorkorder(params.workorderFields);
    if (resp.code !== 'OK') {
      return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR, error: resp.message };
    }
    const workorders = mapWorkorders(resp.data ? [resp.data] : []);
    return { dispatch_orders: workorders, orders: [], workers: [], source: SOURCE_OK };
  } catch (e) {
    return { dispatch_orders: [], orders: [], workers: [], source: SOURCE_ERROR };
  }
}

const ACTION_HANDLERS = {
  'dispatch_manage.list':     assembleDispatchList,
  'dispatch_manage.detail':   assembleDispatchList,
  'dispatch_manage.work_order': assembleDispatchList,
  'dispatch_manage.status':   assembleDispatchStatus,
  'dispatch_manage.accept':   assembleDispatchList,
  'dispatch_manage.reject':   assembleDispatchList,
  'dispatch_manage.transfer': assembleDispatchList,
  'dispatch_manage.supplier': assembleDispatchList,
};
```

- [ ] **Step 4: Create action-handlers.js**

```javascript
// src/skills/dispatch_manage/lib/action-handlers.js
/**
 * dispatch_manage action → template 映射表。
 * 与 action-dispatcher.js L125-133 保持一致。
 */

export const DISPATCH_ACTION_MAP = {
  'dispatch_manage.detail':   'dispatch_detail',
  'dispatch_manage.work_order': 'work_order',
  'dispatch_manage.status':   'dispatch_status',
  'dispatch_manage.accept':   'dispatch_accept',
  'dispatch_manage.reject':   'dispatch_reject',
  'dispatch_manage.transfer': 'dispatch_transfer',
  'dispatch_manage.supplier': 'dispatch_supplier_action',
  'dispatch_manage.list':     'dispatch_list',
};

export function getTemplateForAction(actionKey) {
  return DISPATCH_ACTION_MAP[actionKey] || 'dispatch_list';
}
```

- [ ] **Step 5: Commit**

```bash
git add src/skills/dispatch_manage/lib/
git commit -m "feat: add dispatch_manage lib (field-mapper, data-assembler, action-handlers, validators)"
```

---

## Task 15: Wire table-data/index.js — Switch to real API

**Files:**
- Modify: `src/services/table-data/index.js` (only `getFindServiceTables` and `getDispatchManageTables`)

**Context:** This is the critical wiring step. The orchestrator calls `getFindServiceTables()` at L1467 and `getDispatchManageTables()` at L1506. We change the implementation to call the skill data-assemblers instead of returning seed data. The other 4 methods stay untouched.

- [ ] **Step 1: Read the current file**

Read `src/services/table-data/index.js` to confirm the exact current content. It was already read earlier — the file has 6 methods, we only change 2.

- [ ] **Step 2: Modify getFindServiceTables and getDispatchManageTables**

Replace the two methods:

```javascript
// In src/services/table-data/index.js

// REPLACE getFindServiceTables:
async getFindServiceTables(params = {}) {
  const { assembleFindServiceData } = await import('../../skills/find_service/lib/data-assembler.js');
  return assembleFindServiceData(params);
},

// REPLACE getDispatchManageTables:
async getDispatchManageTables(params = {}) {
  const { assembleDispatchData } = await import('../../skills/dispatch_manage/lib/data-assembler.js');
  return assembleDispatchData(params);
},
```

Keep `getMealPlanTables()`, `getTravelRouteTables()`, `getHealthRiskWarningTables()`, `getSkillConfigs()` exactly as they are.

- [ ] **Step 3: Verify other skills still work**

Run: `node -e "import('./src/services/table-data/index.js').then(async m => { const s = m.createTableDataService(); const r = await s.getMealPlanTables(); console.log('meal_plan OK, keys:', Object.keys(r).join(',')); })"`
Expected: `meal_plan OK, keys: elder_profile,meal_rules,diet_contraindications,source`

- [ ] **Step 4: Verify find_service returns real data**

Run: `node -e "import('./src/services/table-data/index.js').then(async m => { const s = m.createTableDataService(); const r = await s.getFindServiceTables({ action: 'find_service.catalog' }); console.log('source:', r.source, 'catalog:', r.service_catalog?.length || 0); })"`
Expected: `source: gxy_platform catalog: 5`

- [ ] **Step 5: Verify dispatch_manage returns real data**

Run: `node -e "import('./src/services/table-data/index.js').then(async m => { const s = m.createTableDataService(); const r = await s.getDispatchManageTables({ action: 'dispatch_manage.list' }); console.log('source:', r.source, 'dispatch_orders:', r.dispatch_orders?.length || 0); })"`
Expected: `source: gxy_platform dispatch_orders: 20` (first page of 9974)

- [ ] **Step 6: Commit**

```bash
git add src/services/table-data/index.js
git commit -m "feat: wire table-data to GXY platform API for find_service and dispatch_manage"
```

---

## Task 16: Clean repository.js — Remove seed data

**Files:**
- Modify: `src/services/table-data/repository.js`

**Context:** Remove the `fs_*` and `dm_*` seed entries from DEFAULT_TABLES. Keep `meal_*`, `gxy_travel_*`, `health_risk_*`, `skill_configs`, `elder_profile`.

- [ ] **Step 1: Read repository.js to find the exact seed data blocks**

Read `src/services/table-data/repository.js` and locate the DEFAULT_TABLES object. Identify the `fs_service_catalog`, `fs_org`, `fs_worker`, `fs_service_order`, and `dm_dispatch_order` entries.

- [ ] **Step 2: Remove the find_service and dispatch_manage seed entries**

Delete the `fs_service_catalog`, `fs_org`, `fs_worker`, `fs_service_order`, and `dm_dispatch_order` arrays from DEFAULT_TABLES. Do NOT remove any other entries.

- [ ] **Step 3: Verify other skills still work**

Run: `node -e "import('./src/services/table-data/index.js').then(async m => { const s = m.createTableDataService(); const r = await s.getMealPlanTables(); console.log('meal_plan OK:', r.meal_rules?.length || 0, 'rules'); })"`
Expected: `meal_plan OK: X rules` (same count as before)

- [ ] **Step 4: Commit**

```bash
git add src/services/table-data/repository.js
git commit -m "refactor: remove find_service and dispatch_manage seed data from repository"
```

---

## Task 17: End-to-end verification

**Context:** Final verification that the full pipeline works. No new files — just testing.

- [ ] **Step 1: Verify find_service catalog through table-data**

```bash
node -e "import('./src/services/table-data/index.js').then(async m => {
  const s = m.createTableDataService();
  const r = await s.getFindServiceTables({ action: 'find_service.catalog' });
  console.log('=== find_service.catalog ===');
  console.log('source:', r.source);
  console.log('catalog count:', r.service_catalog?.length || 0);
  if (r.service_catalog?.[0]) console.log('first item:', r.service_catalog[0].name);
})"
```

Expected: `source: gxy_platform`, `catalog count: 5` (or more)

- [ ] **Step 2: Verify find_service order list through table-data**

```bash
node -e "import('./src/services/table-data/index.js').then(async m => {
  const s = m.createTableDataService();
  const r = await s.getFindServiceTables({ action: 'find_service.detail_order' });
  console.log('=== find_service.detail_order ===');
  console.log('source:', r.source);
  console.log('orders count:', r.orders?.length || 0);
})"
```

Expected: `source: gxy_platform_empty` (no elderId passed) or `source: gxy_platform` with orders if elderId is in params.

- [ ] **Step 3: Verify dispatch_manage through table-data**

```bash
node -e "import('./src/services/table-data/index.js').then(async m => {
  const s = m.createTableDataService();
  const r = await s.getDispatchManageTables({ action: 'dispatch_manage.list' });
  console.log('=== dispatch_manage.list ===');
  console.log('source:', r.source);
  console.log('dispatch_orders count:', r.dispatch_orders?.length || 0);
  if (r.dispatch_orders?.[0]) console.log('first:', r.dispatch_orders[0].dispatch_id);
})"
```

Expected: `source: gxy_platform`, `dispatch_orders count: 20`

- [ ] **Step 4: Verify other skills are NOT broken**

```bash
node -e "import('./src/services/table-data/index.js').then(async m => {
  const s = m.createTableDataService();
  const meal = await s.getMealPlanTables();
  const travel = await s.getTravelRouteTables();
  const health = await s.getHealthRiskWarningTables();
  const configs = await s.getSkillConfigs();
  console.log('meal_plan:', meal.meal_rules?.length || 0, 'rules');
  console.log('travel_route:', travel.routes?.length || 0, 'routes');
  console.log('health_risk:', health.business_scenes?.length || 0, 'scenes');
  console.log('skill_configs:', Object.keys(configs).length, 'configs');
})"
```

Expected: All counts match their pre-change values.

- [ ] **Step 5: Verify flatTalk server starts without errors**

```bash
cd d:\GuiCare\flatTalk && node src/server.js
```

Expected: Server starts on port 5298 without import errors.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete GXY platform fusion — real API data for find_service and dispatch_manage"
```

---

## Self-Review

### Spec Coverage

| Spec Section | Task(s) |
|---|---|
| §3 Three-layer architecture | Tasks 1-14 (all layers) |
| §4 Directory structure | Tasks 1-14 (all files) |
| §5.1 field-mapper.js | Task 12 (find_service), Task 14 (dispatch_manage) |
| §5.2 data-assembler.js | Task 13 (find_service), Task 14 (dispatch_manage) |
| §5.3 action-handlers.js | Task 13 (find_service), Task 14 (dispatch_manage) |
| §5.4 validators.js | Task 12 (find_service), Task 14 (dispatch_manage) |
| §5.5 gxy-platform services | Tasks 5-11 |
| §5.6 third/gxy clients | Tasks 1-4 |
| §6 Data flow examples | Task 17 (E2E verification) |
| §7 table-data/index.js modification | Task 15 |
| §4.2 Seed data removal | Task 16 |
| §11 Migration sequence phases 1-3 | Tasks 1-16 |
| §11 Phase 4 (write operations) | Task 13 (assembleBookingConfirm with validators + syncOrder) |

### Placeholder Scan

No TBDs, TODOs, or incomplete sections. All code blocks contain full implementations.

### Type Consistency

- `createGxyClient()` returns `{ post, get, getUnsigned, config }` — used consistently in Tasks 2-4
- `toPlatformResult(resp, message)` signature consistent across all services
- `assembleFindServiceData(params)` / `assembleDispatchData(params)` — both return objects with `source` field
- `mapOrders` / `mapWorkorders` — both return arrays of objects with snake_case keys
- `validateOrder` / `validateWorkorder` — both return `{ valid, missing, invalid }`
