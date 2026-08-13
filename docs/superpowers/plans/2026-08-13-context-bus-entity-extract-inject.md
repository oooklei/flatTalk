# Context Bus Entity Extract & Skill Inject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地登录/会话分层 Context Bus、SafetyGate、轻量规范化、TurnExtractor、按 `skill_key` 的 Detector Registry 与 `inject_profile` 注入，消除 `has_elder` 空跑与附近静默 skip。

**Architecture:** 新增 `src/core/context-bus/` 与 `src/core/pipeline/`（safety / normalize / extract / detectors）。登录在 `/assistant` + 首条聊天补全 location；每轮聊天在 LIS 路由前跑 Safety→Normalize→Extract，路由后跑 Detectors 并注入 orchestrator。LLM 调用对齐 `city-extractor`（可注入 `llmCall`）。

**Tech Stack:** Node.js ESM、`node:test`、`callOpenAiCompatibleModel` / model-registry、现有 SessionStore `global_context`、PgTagReader、AES SSO

**Spec:** `docs/superpowers/specs/2026-08-13-context-bus-entity-extract-inject-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/context-bus/role-entity-map.js` | 创建 | role_id ↔ entity_type / 绑定策略 |
| `src/core/context-bus/schema.js` | 创建 | emptyLogin / emptyTurn / normalize / inject_profile |
| `src/core/context-bus/store.js` | 创建 | 读写 session.global_context.context_bus |
| `src/core/context-bus/login-binder.js` | 创建 | SSO → provisional login |
| `src/core/context-bus/tag-corrector.js` | 创建 | PG/Tag → confirmed |
| `src/core/context-bus/index.js` | 创建 | 对外导出 |
| `src/core/pipeline/safety-gate.js` | 创建 | 有害分类与动作 |
| `src/core/pipeline/input-normalizer.js` | 创建 | 轻量勘误 + 500 字校验 |
| `src/core/pipeline/turn-extractor.js` | 创建 | LLM 槽位 + 规则校验 + 多意图 |
| `src/core/pipeline/detectors/registry.js` | 创建 | register / run |
| `src/core/pipeline/detectors/travel_route.js` | 创建 | 旅居资源要素 |
| `src/core/pipeline/detectors/meal_plan.js` | 创建 | 膳食资源要素 |
| `src/core/pipeline/detectors/nearby_resource.js` | 创建 | 附近锚点/品类 |
| `src/core/pipeline/detectors/index.js` | 创建 | 注册默认探测器 |
| `src/core/pipeline/run-pre-route.js` | 创建 | Safety→Normalize→Extract 编排 |
| `src/core/pipeline/run-post-route.js` | 创建 | Detectors + inject_profile |
| `src/prompts/context-bus/turn-extract.md` | 创建 | 抽取 prompt |
| `src/prompts/context-bus/normalize.md` | 创建 | 规范化 prompt |
| `src/server/external-aes-sso.js` | 修改 | token/payload 带 provisional entity 字段 |
| `src/app.js` | 修改 | `/assistant` 绑定；chat 入口字数与 pipeline |
| `src/core/orchestrator/chat-orchestrator.js` | 修改 | 挂 pre/post route；消费 profile |
| `src/public/mobile.js` | 修改 | 500 字前端拦截；location 写入会话 |
| `src/public/login.js` | 修改 | 可选：登录后预写 location 提示 |
| `.env.example` | 修改 | timeout / 开关 |
| `tests/context-bus-*.test.js` 等 | 创建 | 见各 Task |

---

### Task 1: RoleEntityMap + SessionContext schema

**Files:**
- Create: `src/core/context-bus/role-entity-map.js`
- Create: `src/core/context-bus/schema.js`
- Test: `tests/context-bus-schema.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntityType, ROLE_ENTITY_MAP } from '../src/core/context-bus/role-entity-map.js';
import {
  emptyLogin,
  emptyTurn,
  injectProfile,
  normalizeLogin,
  normalizeTurn,
} from '../src/core/context-bus/schema.js';

describe('role-entity-map', () => {
  it('maps LAO_REN to ELDER self-binding', () => {
    const r = resolveEntityType('LAO_REN');
    assert.equal(r.entity_type, 'ELDER');
    assert.equal(r.binding, 'self');
  });
  it('maps JIA_SHU to USER family binding', () => {
    const r = resolveEntityType('JIA_SHU');
    assert.equal(r.entity_type, 'USER');
    assert.equal(r.binding, 'family');
  });
  it('maps SQJJ-GLY to USER+ORG', () => {
    const r = resolveEntityType('SQJJ-GLY');
    assert.equal(r.entity_type, 'USER');
    assert.equal(r.org_required, true);
  });
});

describe('schema inject_profile', () => {
  it('merges login + turn common + skill business', () => {
    const login = normalizeLogin({
      ...emptyLogin(),
      user_id: 'U1',
      role_key: 'elder',
      entity_type: 'ELDER',
      elder_binding: { elder_id: 'E1' },
      identity_status: 'confirmed',
    });
    const turn = normalizeTurn({
      ...emptyTurn(),
      primary_city: '桂林',
      business: { meal_plan: { meal_slot: 'lunch' } },
    });
    const p = injectProfile(login, turn, 'meal_plan');
    assert.equal(p.elder_id, 'E1');
    assert.equal(p.has_elder, true);
    assert.equal(p.role_key, 'elder');
    assert.equal(p.primary_city, '桂林');
    assert.equal(p.resources.meal_slot, 'lunch');
  });
  it('has_elder false when no binding', () => {
    const p = injectProfile(emptyLogin(), emptyTurn(), 'meal_plan');
    assert.equal(p.has_elder, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/context-bus-schema.test.js`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement role-entity-map.js**

```js
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

/**
 * @param {string} roleId
 * @returns {{ entity_type: string, binding: BindingKind, org_required: boolean, tags?: string[] }}
 */
export function resolveEntityType(roleId) {
  const key = String(roleId || '').trim();
  if (!key) return { entity_type: 'USER', binding: 'none', org_required: false };
  if (ROLE_ENTITY_MAP[key]) return { ...ROLE_ENTITY_MAP[key] };
  const upper = key.toUpperCase();
  if (ROLE_ENTITY_MAP[upper]) return { ...ROLE_ENTITY_MAP[upper] };
  return { entity_type: 'USER', binding: 'none', org_required: false };
}
```

- [ ] **Step 4: Implement schema.js**

```js
export function emptyLogin() {
  return {
    user_id: '',
    role_key: '',
    role_id: '',
    entity_type: '',
    entity_id: '',
    tags: [],
    elder_binding: { elder_id: '', elders: [] },
    org: { org_id: '', org_name: '' },
    city: '',
    location: null,
    identity_source: 'sso',
    identity_status: 'provisional',
  };
}

export function emptyTurn() {
  return {
    original_text: '',
    normalized_text: '',
    pronouns: [],
    mentioned_entities: [],
    cities: [],
    primary_city: '',
    location_intent: false,
    need_location: false,
    intents: [],
    primary_intent_index: 0,
    pending_intents: [],
    business: {},
    safety: null,
    normalize: null,
    updated_at: '',
  };
}

export function normalizeLogin(raw = {}) {
  const base = emptyLogin();
  return {
    ...base,
    ...raw,
    tags: Array.isArray(raw.tags) ? raw.tags : base.tags,
    elder_binding: { ...base.elder_binding, ...(raw.elder_binding || {}) },
    org: { ...base.org, ...(raw.org || {}) },
  };
}

export function normalizeTurn(raw = {}) {
  const base = emptyTurn();
  return {
    ...base,
    ...raw,
    pronouns: Array.isArray(raw.pronouns) ? raw.pronouns : [],
    mentioned_entities: Array.isArray(raw.mentioned_entities) ? raw.mentioned_entities : [],
    cities: Array.isArray(raw.cities) ? raw.cities : [],
    intents: Array.isArray(raw.intents) ? raw.intents : [],
    pending_intents: Array.isArray(raw.pending_intents) ? raw.pending_intents : [],
    business: raw.business && typeof raw.business === 'object' ? raw.business : {},
  };
}

export function injectProfile(login, turn, skillKey) {
  const L = normalizeLogin(login);
  const T = normalizeTurn(turn);
  const elderId = L.elder_binding?.elder_id || '';
  const resources = (T.business && T.business[skillKey]) || {};
  return {
    user_id: L.user_id,
    role_key: L.role_key,
    entity_type: L.entity_type,
    entity_id: L.entity_id || L.user_id,
    tags: L.tags,
    elder_id: elderId,
    has_elder: Boolean(elderId),
    org: L.org,
    city: T.primary_city || L.city || '',
    location: L.location,
    need_location: Boolean(T.need_location),
    identity_status: L.identity_status,
    normalized_text: T.normalized_text || T.original_text,
    mentioned_entities: T.mentioned_entities,
    pronouns: T.pronouns,
    resources,
    skill_key: skillKey,
  };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `node --test tests/context-bus-schema.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/core/context-bus/role-entity-map.js src/core/context-bus/schema.js tests/context-bus-schema.test.js
git commit -m "feat(context-bus): add role map and SessionContext schema"
```

---

### Task 2: Context Bus store on SessionStore.global_context

**Files:**
- Create: `src/core/context-bus/store.js`
- Create: `src/core/context-bus/index.js`
- Test: `tests/context-bus-store.test.js`
- Modify: `src/core/conversation/session-store.js`（仅确保 `global_context` 存在；读写走 store 助手，避免大改）

- [ ] **Step 1: Write the failing test**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readBus, writeLogin, mergeTurn, setSkillBusiness } from '../src/core/context-bus/store.js';
import { emptyLogin } from '../src/core/context-bus/schema.js';

describe('context-bus store', () => {
  it('writeLogin and mergeTurn roundtrip on session object', () => {
    const session = { conversation_id: 'c1', global_context: {} };
    writeLogin(session, { ...emptyLogin(), user_id: 'U1', identity_status: 'provisional' });
    mergeTurn(session, { original_text: 'hi', normalized_text: 'hi', primary_city: '南宁' });
    setSkillBusiness(session, 'travel_route', { route_name: '滨海线' });
    const bus = readBus(session);
    assert.equal(bus.login.user_id, 'U1');
    assert.equal(bus.turn.primary_city, '南宁');
    assert.equal(bus.turn.business.travel_route.route_name, '滨海线');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement store.js**

```js
import { emptyLogin, emptyTurn, normalizeLogin, normalizeTurn } from './schema.js';

const BUS_KEY = 'context_bus';

export function readBus(session) {
  const raw = session?.global_context?.[BUS_KEY] || {};
  return {
    login: normalizeLogin(raw.login || emptyLogin()),
    turn: normalizeTurn(raw.turn || emptyTurn()),
  };
}

function ensure(session) {
  if (!session.global_context) session.global_context = {};
  if (!session.global_context[BUS_KEY]) {
    session.global_context[BUS_KEY] = { login: emptyLogin(), turn: emptyTurn() };
  }
  return session.global_context[BUS_KEY];
}

export function writeLogin(session, loginPatch) {
  const bus = ensure(session);
  bus.login = normalizeLogin({ ...bus.login, ...loginPatch });
  return bus.login;
}

export function mergeTurn(session, turnPatch) {
  const bus = ensure(session);
  const prevBiz = bus.turn?.business || {};
  const next = normalizeTurn({ ...bus.turn, ...turnPatch });
  if (turnPatch.business) {
    next.business = { ...prevBiz, ...turnPatch.business };
  } else {
    next.business = prevBiz;
  }
  next.updated_at = new Date().toISOString();
  bus.turn = next;
  return bus.turn;
}

export function setSkillBusiness(session, skillKey, resources) {
  const bus = ensure(session);
  bus.turn = normalizeTurn(bus.turn);
  bus.turn.business = { ...(bus.turn.business || {}), [skillKey]: resources || {} };
  bus.turn.updated_at = new Date().toISOString();
  return bus.turn.business[skillKey];
}

export function replacePendingIntents(session, pending) {
  return mergeTurn(session, { pending_intents: Array.isArray(pending) ? pending : [] });
}
```

- [ ] **Step 4: index.js re-exports**

```js
export * from './role-entity-map.js';
export * from './schema.js';
export * from './store.js';
```

- [ ] **Step 5: Run PASS + Commit**

```bash
git add src/core/context-bus/ tests/context-bus-store.test.js
git commit -m "feat(context-bus): session global_context bus store"
```

---

### Task 3: LoginBinder + TagCorrector + SSO wire

**Files:**
- Create: `src/core/context-bus/login-binder.js`
- Create: `src/core/context-bus/tag-corrector.js`
- Test: `tests/context-bus-login-bind.test.js`
- Modify: `src/server/external-aes-sso.js` — `processExternalSsoRequest` 返回体增加 `context_login` provisional 快照
- Modify: `src/app.js` — `handleChat` 若 session 无 login，用 token/body 调 `ensureLoginOnSession`

- [ ] **Step 1: Failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bindFromSso } from '../src/core/context-bus/login-binder.js';
import { applyTagCorrection } from '../src/core/context-bus/tag-corrector.js';

describe('login-binder', () => {
  it('builds provisional ELDER from LAO_REN', () => {
    const login = bindFromSso({
      userId: 'U_E',
      roleId: 'LAO_REN',
      elderScope: 'elder_E1',
      orgId: '',
      orgName: '',
    });
    assert.equal(login.identity_status, 'provisional');
    assert.equal(login.entity_type, 'ELDER');
    assert.equal(login.elder_binding.elder_id, 'E1');
  });
});

describe('tag-corrector', () => {
  it('marks confirmed when tag reader returns profile', async () => {
    const reader = {
      async getEntityProfile() {
        return {
          ok: true,
          data: {
            entity_type: 'ELDER',
            entity_id: 'U_E',
            tags: [{ tag_code: 'DIABETES' }],
          },
        };
      },
    };
    const next = await applyTagCorrection(
      { user_id: 'U_E', entity_type: 'ELDER', elder_binding: { elder_id: 'U_E' }, tags: [] },
      { tagReader: reader },
    );
    assert.equal(next.identity_status, 'confirmed');
    assert.equal(next.identity_source, 'merged');
    assert.ok(next.tags.some((t) => t.tag_code === 'DIABETES' || t === 'DIABETES'));
  });
  it('keeps provisional on reader failure', async () => {
    const reader = {
      async getEntityProfile() {
        return { ok: false, error: 'pg_error' };
      },
    };
    const next = await applyTagCorrection(
      { user_id: 'U_E', entity_type: 'ELDER', identity_status: 'provisional', tags: [] },
      { tagReader: reader },
    );
    assert.equal(next.identity_status, 'provisional');
  });
});
```

- [ ] **Step 2: Implement login-binder.js**

```js
import { resolveEntityType } from './role-entity-map.js';
import { normalizeLogin, emptyLogin } from './schema.js';

function stripElderScope(scope) {
  const s = String(scope || '');
  if (s.startsWith('elder_')) return s.slice('elder_'.length);
  return s;
}

/** role_key 由 SSO 层传入，避免 login-binder ↔ external-aes-sso 循环依赖 */
export function bindFromSso(userInfo = {}, { roleKey = '' } = {}) {
  const roleId = String(userInfo.roleId || userInfo.role_id || '').trim();
  const mapped = resolveEntityType(roleId);
  const userId = String(userInfo.userId || userInfo.user_id || '').trim();
  let elderId = stripElderScope(userInfo.elderScope || userInfo.elder_id || '');
  if (mapped.binding === 'self' && !elderId) elderId = userId;

  return normalizeLogin({
    ...emptyLogin(),
    user_id: userId,
    role_id: roleId,
    role_key: roleKey || String(userInfo.roleKey || userInfo.role_key || '').trim(),
    entity_type: mapped.entity_type,
    entity_id: userId,
    tags: mapped.tags || [],
    elder_binding: {
      elder_id: elderId,
      elders: elderId ? [{ elder_id: elderId }] : [],
    },
    org: {
      org_id: String(userInfo.orgId || userInfo.org_id || '').trim(),
      org_name: String(userInfo.orgName || userInfo.org_name || '').trim(),
    },
    identity_source: 'sso',
    identity_status: 'provisional',
  });
}
```

- [ ] **Step 3: Implement tag-corrector.js**

```js
import { normalizeLogin } from './schema.js';

export async function applyTagCorrection(login, { tagReader, timeoutMs = 2500 } = {}) {
  const base = normalizeLogin(login);
  if (!tagReader || typeof tagReader.getEntityProfile !== 'function') {
    return base;
  }
  try {
    const result = await Promise.race([
      tagReader.getEntityProfile(base.user_id, { entityType: base.entity_type || '' }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeoutMs)),
    ]);
    if (!result?.ok || !result.data) return { ...base, identity_status: 'provisional' };
    const tags = Array.isArray(result.data.tags) ? result.data.tags : [];
    return normalizeLogin({
      ...base,
      entity_type: result.data.entity_type || base.entity_type,
      entity_id: result.data.entity_id || base.entity_id,
      tags,
      identity_source: 'merged',
      identity_status: 'confirmed',
    });
  } catch {
    return { ...base, identity_status: 'provisional' };
  }
}
```

- [ ] **Step 4: Wire SSO** — in `processExternalSsoRequest` success path, after building token:

```js
import { bindFromSso } from '../core/context-bus/login-binder.js';
// ...
const context_login = bindFromSso(userInfo, { roleKey });
return { ok: true, mobileUrl, token, userToken: token, expiresIn, context_login, /* existing fields */ };
```

测试中：`bindFromSso({ userId, roleId }, { roleKey: 'elder' })`。

- [ ] **Step 5: Wire chat** — helper `ensureLoginOnSession(session, request, tagReader)`:
  1. If `readBus(session).login.user_id` empty → `bindFromSso` from `request` fields / decrypted token claims  
  2. `await applyTagCorrection`  
  3. `writeLogin(session, ...)` + `sessionStore.save(session)`  
  4. If `request.location` → merge into `login.location` / `login.city`

Call from `handleChat` after `getOrCreate`, before orchestrator.

- [ ] **Step 6: Tests PASS + Commit**

```bash
git commit -m "feat(context-bus): SSO provisional login and Tag corrector"
```

---

### Task 4: SafetyGate

**Files:**
- Create: `src/core/pipeline/safety-gate.js`
- Test: `tests/safety-gate.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSafetyGate } from '../src/core/pipeline/safety-gate.js';

describe('safety-gate', () => {
  it('blocks porn/violence keywords', () => {
    const r = runSafetyGate('这里有色情暴力内容示范拦截');
    assert.equal(r.action, 'block');
    assert.ok(['porn', 'violence'].includes(r.category) || r.category === 'porn' || r.category === 'violence');
  });
  it('care on self-harm signals', () => {
    const r = runSafetyGate('我不想活了真的很抑郁');
    assert.equal(r.action, 'care');
    assert.equal(r.category, 'self_harm_negativity');
  });
  it('pass clean', () => {
    const r = runSafetyGate('推荐桂林旅居线路');
    assert.equal(r.action, 'pass');
    assert.equal(r.category, 'clean');
  });
});
```

- [ ] **Step 2: Implement**（规则初筛；可后续换 LLM，接口保持）

```js
const RULES = [
  { category: 'porn', action: 'block', patterns: [/色情/, /淫秽/, /黄色网站/] },
  { category: 'violence', action: 'block', patterns: [/杀人/, /爆炸制作/, /恐怖袭击/] },
  { category: 'political_extremism', action: 'block', patterns: [/颠覆国家/, /分裂国家/] },
  { category: 'self_harm_negativity', action: 'care', patterns: [/不想活/, /自杀/, /结束生命/, /极度抑郁/] },
];

export function runSafetyGate(text = '') {
  const t = String(text || '');
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(t))) {
      return { action: rule.action, category: rule.category, matched: true };
    }
  }
  return { action: 'pass', category: 'clean', matched: false };
}

export function safetyEnvelope(action) {
  if (action === 'block') {
    return {
      template_id: 'safety_refuse',
      skill_key: 'common',
      message: '该问题涉及不当内容，我无法继续讨论。请换一个养老服务相关的问题。',
    };
  }
  if (action === 'care') {
    return {
      template_id: 'safety_care',
      skill_key: 'common',
      message: '听到你现在很难受。请先照顾好自己；如需帮助，可联系身边亲友或当地心理援助热线。我也可以帮你聊聊养老服务、健康或日常安排。',
    };
  }
  return null;
}
```

- [ ] **Step 3: PASS + Commit**

```bash
git commit -m "feat(pipeline): add SafetyGate for harmful input"
```

---

### Task 5: InputNormalizer + 500 字硬限

**Files:**
- Create: `src/core/pipeline/input-normalizer.js`
- Create: `src/prompts/context-bus/normalize.md`
- Test: `tests/input-normalizer.test.js`
- Modify: `src/app.js` `handleChat` — 超 500 返回 400  
- Modify: `src/public/mobile.js` — 发送前拦截

- [ ] **Step 1: Tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertWithinLimit, normalizeInput } from '../src/core/pipeline/input-normalizer.js';

describe('input-normalizer', () => {
  it('rejects over 500 chars', () => {
    const r = assertWithinLimit('啊'.repeat(501));
    assert.equal(r.ok, false);
    assert.equal(r.error, 'text_too_long');
  });
  it('rules path: fullwidth and slang without LLM', async () => {
    const r = await normalizeInput('　旅居綫路　', { llmCall: null });
    assert.equal(r.needs_clarify, false);
    assert.ok(r.normalized_text.includes('旅居'));
  });
  it('uses llm when provided', async () => {
    const r = await normalizeInput('旅居線路易州', {
      llmCall: async () => ({
        content: JSON.stringify({
          normalized_text: '旅居线路北海涠洲',
          fixes: [{ type: 'typo' }],
          needs_clarify: false,
        }),
      }),
    });
    assert.equal(r.normalized_text, '旅居线路北海涠洲');
  });
});
```

- [ ] **Step 2: Implement**

```js
export const MAX_USER_CHARS = 500;

export function assertWithinLimit(text) {
  const s = String(text || '');
  if ([...s].length > MAX_USER_CHARS) {
    return { ok: false, error: 'text_too_long', message: '请将问题控制在500字以内，并分段提问。', length: [...s].length };
  }
  return { ok: true, length: [...s].length };
}

function rulesNormalize(text) {
  let t = String(text || '');
  t = t.replace(/[\u3000]/g, ' ').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  t = t.replace(/綫/g, '线').replace(/綫路/g, '线路').replace(/易州/g, '涠洲');
  return t.trim();
}

export async function normalizeInput(text, { llmCall = null, timeoutMs = 2000 } = {}) {
  const original_text = String(text || '');
  const limit = assertWithinLimit(original_text);
  if (!limit.ok) return { ...limit, needs_clarify: true, normalized_text: original_text, fixes: [] };

  let normalized_text = rulesNormalize(original_text);
  let fixes = normalized_text !== original_text ? [{ type: 'rules' }] : [];
  let needs_clarify = false;

  if (typeof llmCall === 'function') {
    try {
      const result = await Promise.race([
        llmCall({
          messages: [
            {
              role: 'system',
              content:
                '纠正错别字、火星文、明显谐音，保留专有名词。输出 JSON：{"normalized_text":"...","fixes":[{"type":"typo"}],"needs_clarify":false}',
            },
            { role: 'user', content: original_text },
          ],
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
      const parsed = JSON.parse(String(result.content || '').replace(/```json|```/g, '').trim());
      if (parsed.normalized_text) {
        normalized_text = String(parsed.normalized_text);
        fixes = Array.isArray(parsed.fixes) ? parsed.fixes : fixes;
        needs_clarify = Boolean(parsed.needs_clarify);
      }
    } catch {
      // keep rules result
    }
  }

  return { ok: true, original_text, normalized_text, fixes, needs_clarify };
}
```

- [ ] **Step 3: mobile.js** — before send:

```js
if ([...String(text || '')].length > 500) {
  this.toast?.('请将问题控制在500字以内，并分段提问');
  return;
}
```

- [ ] **Step 4: app.js handleChat** — after reading message:

```js
import { assertWithinLimit } from './core/pipeline/input-normalizer.js';
const lim = assertWithinLimit(message);
if (!lim.ok) return json(res, 400, lim);
```

- [ ] **Step 5: PASS + Commit**

```bash
git commit -m "feat(pipeline): input normalizer and 500-char limit"
```

---

### Task 6: TurnExtractor（槽位 + 多意图）

**Files:**
- Create: `src/core/pipeline/turn-extractor.js`
- Create: `src/prompts/context-bus/turn-extract.md`
- Test: `tests/turn-extractor.test.js`

- [ ] **Step 1: Tests with mock llmCall**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTurn } from '../src/core/pipeline/turn-extractor.js';

describe('turn-extractor', () => {
  it('parses intents and pending', async () => {
    const out = await extractTurn({
      text: '先看看食谱，顺便推荐桂林旅居',
      login: { elder_binding: { elder_id: 'E1' }, location: null },
      turnPrev: {},
      llmCall: async () => ({
        content: JSON.stringify({
          pronouns: [{ surface: '我', resolved_ref: 'self', confidence: 0.9 }],
          mentioned_entities: [],
          cities: ['桂林'],
          primary_city: '桂林',
          location_intent: false,
          intents: [
            { skill_key: 'meal_plan', confidence: 0.85 },
            { skill_key: 'travel_route', confidence: 0.8 },
          ],
        }),
      }),
    });
    assert.equal(out.intents[0].skill_key, 'meal_plan');
    assert.equal(out.pending_intents.length, 1);
    assert.equal(out.pending_intents[0].skill_key, 'travel_route');
    assert.equal(out.primary_city, '桂林');
  });
  it('sets need_location when location_intent and no login.location', async () => {
    const out = await extractTurn({
      text: '附近有什么',
      login: { location: null },
      llmCall: async () => ({
        content: JSON.stringify({
          pronouns: [],
          mentioned_entities: [],
          cities: [],
          primary_city: null,
          location_intent: true,
          intents: [{ skill_key: 'nearby_resource', confidence: 0.9 }],
        }),
      }),
    });
    assert.equal(out.need_location, true);
  });
});
```

- [ ] **Step 2: Implement extractTurn** — LLM JSON schema:

```json
{
  "pronouns": [{"surface":"", "resolved_ref":"self|elder|other|unknown", "confidence":0}],
  "mentioned_entities": [{"name":"", "entity_type":"ELDER|ORG|SERVICE_PROVIDER|USER|UNKNOWN", "confidence":0}],
  "cities": [],
  "primary_city": null,
  "location_intent": false,
  "intents": [{"skill_key":"", "confidence":0}]
}
```

Rules after LLM:

- Cap intents at 3; sort by confidence; `primary_intent_index=0`; `pending_intents = intents.slice(1)`  
- If `location_intent && !login.location?.lat` → `need_location=true`  
- Pronoun `self`/`elder` → prefer `login.elder_binding.elder_id` when resolving for meal  
- On LLM fail → rulesFallback: reuse `matchHotCity` from city-extractor + weak intent empty

- [ ] **Step 3: PASS + Commit**

```bash
git commit -m "feat(pipeline): TurnExtractor with multi-intent queue"
```

---

### Task 7: Detector Registry（travel / meal / nearby）

**Files:**
- Create: `src/core/pipeline/detectors/registry.js`
- Create: `src/core/pipeline/detectors/travel_route.js`
- Create: `src/core/pipeline/detectors/meal_plan.js`
- Create: `src/core/pipeline/detectors/nearby_resource.js`
- Create: `src/core/pipeline/detectors/index.js`
- Test: `tests/detectors-registry.test.js`

- [ ] **Step 1: Tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../src/core/pipeline/detectors/registry.js';
import { registerDefaultDetectors } from '../src/core/pipeline/detectors/index.js';

describe('detectors', () => {
  it('meal_plan requires elder', async () => {
    const reg = createRegistry();
    registerDefaultDetectors(reg);
    const miss = await reg.run('meal_plan', {
      utterance: '今天吃什么',
      login: { elder_binding: {} },
      turn: {},
    });
    assert.equal(miss.ok, false);
    assert.equal(miss.clarify, 'which_elder');
  });
  it('nearby need_location', async () => {
    const reg = createRegistry();
    registerDefaultDetectors(reg);
    const r = await reg.run('nearby_resource', {
      utterance: '附近目的地',
      login: { location: null },
      turn: { need_location: true },
    });
    assert.equal(r.ok, false);
    assert.equal(r.need_location, true);
    assert.equal(r.skipped, false);
  });
  it('travel_route extracts city/route hints', async () => {
    const reg = createRegistry();
    registerDefaultDetectors(reg);
    const r = await reg.run('travel_route', {
      utterance: '北海涠洲旅居线路',
      login: {},
      turn: { primary_city: '北海', cities: ['北海'] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.resources.primary_city, '北海');
  });
});
```

- [ ] **Step 2: registry.js**

```js
export function createRegistry() {
  const map = new Map();
  return {
    register(skillKey, fn) {
      map.set(skillKey, fn);
    },
    async run(skillKey, ctx) {
      const fn = map.get(skillKey);
      if (!fn) return { ok: true, resources: {}, skill_key: skillKey, detector: 'noop' };
      return fn(ctx);
    },
    has(skillKey) {
      return map.has(skillKey);
    },
  };
}
```

- [ ] **Step 3: meal_plan detector**

```js
export async function detectMealPlan({ login, turn }) {
  const elderId = login?.elder_binding?.elder_id || '';
  if (!elderId) {
    return { ok: false, skipped: false, clarify: 'which_elder', resources: {}, skill_key: 'meal_plan' };
  }
  return {
    ok: true,
    resources: {
      elder_id: elderId,
      diet_tags: (login.tags || []).map((t) => t.tag_code || t).filter(Boolean),
    },
    skill_key: 'meal_plan',
  };
}
```

- [ ] **Step 4: nearby detector** — never `skipped:true` without reason:

```js
export async function detectNearby({ login, turn }) {
  const lat = login?.location?.lat;
  const lng = login?.location?.lng;
  if (lat == null || lng == null || turn?.need_location) {
    return {
      ok: false,
      skipped: false,
      need_location: true,
      reason: 'missing_latlng',
      resources: {},
      skill_key: 'nearby_resource',
    };
  }
  return {
    ok: true,
    resources: { lat, lng, source: login.location.source || 'device' },
    skill_key: 'nearby_resource',
  };
}
```

- [ ] **Step 5: travel_route detector** — pack `primary_city`, `cities`, `route_query=utterance`

- [ ] **Step 6: PASS + Commit**

```bash
git commit -m "feat(pipeline): skill detector registry for meal/travel/nearby"
```

---

### Task 8: Pre/Post route runners + orchestrator wire

**Files:**
- Create: `src/core/pipeline/run-pre-route.js`
- Create: `src/core/pipeline/run-post-route.js`
- Modify: `src/core/orchestrator/chat-orchestrator.js`
- Modify: `src/app.js`（若 orchestrator 外短路 safety）
- Test: `tests/pipeline-orchestrator-hook.test.js`

- [ ] **Step 1: run-pre-route.js**

```js
import { runSafetyGate, safetyEnvelope } from './safety-gate.js';
import { normalizeInput } from './input-normalizer.js';
import { extractTurn } from './turn-extractor.js';
import { mergeTurn, readBus } from '../context-bus/store.js';
import { injectProfile } from '../context-bus/schema.js';

export async function runPreRoute({ session, message, llmCall, mark }) {
  const safety = runSafetyGate(message);
  mark?.('safety', '安全门', safety);
  if (safety.action !== 'pass') {
    mergeTurn(session, { safety, original_text: message, normalized_text: message });
    return { halt: true, envelopeHint: safetyEnvelope(safety.action), safety };
  }

  const norm = await normalizeInput(message, { llmCall });
  mark?.('normalize', '输入规范化', { fixes: norm.fixes, needs_clarify: norm.needs_clarify });
  if (norm.needs_clarify && norm.ok === false) {
    return { halt: true, error: norm };
  }

  const bus = readBus(session);
  const extracted = await extractTurn({
    text: norm.normalized_text,
    login: bus.login,
    turnPrev: bus.turn,
    llmCall,
  });
  mergeTurn(session, {
    original_text: message,
    normalized_text: norm.normalized_text,
    normalize: { fixes: norm.fixes },
    ...extracted,
  });
  mark?.('turn_extract', '会话抽取', {
    intents: extracted.intents,
    primary_city: extracted.primary_city,
    need_location: extracted.need_location,
  });
  return { halt: false, normalized_text: norm.normalized_text, extracted };
}
```

- [ ] **Step 2: run-post-route.js**

```js
import { setSkillBusiness, readBus, replacePendingIntents } from '../context-bus/store.js';
import { injectProfile } from '../context-bus/schema.js';
import { getDefaultRegistry } from './detectors/index.js';

export async function runPostRoute({ session, skillKey, utterance, mark }) {
  const reg = getDefaultRegistry();
  const bus = readBus(session);
  const detected = await reg.run(skillKey, { utterance, login: bus.login, turn: bus.turn });
  setSkillBusiness(session, skillKey, detected.resources || {});
  if (Array.isArray(bus.turn.pending_intents) && bus.turn.pending_intents.length) {
    // primary already consuming intents[0]; keep pending as-is for drain UX later
    replacePendingIntents(session, bus.turn.pending_intents);
  }
  const profile = injectProfile(readBus(session).login, readBus(session).turn, skillKey);
  mark?.('inject', 'profile注入', {
    skill_key: skillKey,
    has_elder: profile.has_elder,
    need_location: profile.need_location || detected.need_location,
    inject_keys: Object.keys(profile.resources || {}),
  });
  return { detected, profile };
}
```

- [ ] **Step 3: Orchestrator integration points**

1. After request normalize / before LIS gate: `runPreRoute`. If `halt` + safety → return common answer envelope（template 暂用 `answer` + message，或新增极简 HTML 卡；本期允许 `answer` 填文案）。  
2. Replace free-text message fed to LIS with `normalized_text`.  
3. After `skillKey` resolved: `runPostRoute`; pass `profile` into business_data assembly:

```js
business_data = {
  ...business_data,
  role_key: profile.role_key,
  elder_id: profile.elder_id,
  has_elder: profile.has_elder,
  context_profile: profile,
};
```

4. If `detected.need_location` → short-circuit nearby with clarify card / message「请开启定位或选择位置」，**不要** `skipped:true` 无 reason。  
5. If `detected.clarify==='which_elder'` → clarify 选老人。  
6. Prefer `extracted.intents[0].skill_key` only as **hint** to LIS when confidence ≥ 0.75；LIS 仍为权威路由（避免双路由打架）。若产品要坚持抽取覆盖 LIS，用 env `FLATTALK_INTENT_EXTRACT_OVERRIDE=1`。

- [ ] **Step 4: Hook test** — mock session + mark calls; assert safety halt; assert profile.has_elder after binder.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pipeline): wire pre/post route context bus into orchestrator"
```

---

### Task 9: Pending intents drain + mobile location → login

**Files:**
- Modify: `src/core/orchestrator/chat-orchestrator.js` or `src/core/pipeline/pending-intents.js`（创建）
- Modify: `src/public/mobile.js` — 已有 location；确保 chat payload 含 location；bootstrap 后可 `POST /api/conversation/context-location`（可选）或仅靠每条消息  
- Test: `tests/pending-intents.test.js`

- [ ] **Step 1: After successful skill envelope**, if `pending_intents.length`:

Append follow-up suggestion buttons from pending skill labels（复用现有 followup 按钮结构），文案：「还要继续：旅居线路？」  
Clicking sends that intent text / `action_key` — existing button path.

- [ ] **Step 2: ensureLoginOnSession** merges `body.location` every chat into `login.location`.

- [ ] **Step 3: Tests + Commit**

```bash
git commit -m "feat(context-bus): pending intent prompts and location merge"
```

---

### Task 10: Observability + acceptance regression tests

**Files:**
- Modify: orchestrator `mark(...)` keys already used — ensure snapshot includes `identity_status`, `safety`, `normalize`, `intents`, `inject_keys`  
- Create: `tests/context-bus-acceptance.test.js`  
- Modify: `.env.example`

- [ ] **Step 1: Acceptance tests (unit-level)**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bindFromSso } from '../src/core/context-bus/login-binder.js';
import { injectProfile, emptyTurn } from '../src/core/context-bus/schema.js';
import { runSafetyGate } from '../src/core/pipeline/safety-gate.js';
import { assertWithinLimit } from '../src/core/pipeline/input-normalizer.js';
import { createRegistry, /* or getDefaultRegistry */ } from '../src/core/pipeline/detectors/registry.js';
import { registerDefaultDetectors } from '../src/core/pipeline/detectors/index.js';

describe('acceptance mapping', () => {
  it('elder login → meal has_elder', () => {
    const login = bindFromSso({ userId: 'E1', roleId: 'LAO_REN' });
    const p = injectProfile(login, emptyTurn(), 'meal_plan');
    assert.equal(p.has_elder, true);
  });
  it('500 limit', () => {
    assert.equal(assertWithinLimit('x'.repeat(501)).ok, false);
  });
  it('safety block', () => {
    assert.equal(runSafetyGate('色情暴力').action, 'block');
  });
  it('nearby missing loc not silent skip', async () => {
    const reg = createRegistry();
    registerDefaultDetectors(reg);
    const r = await reg.run('nearby_resource', { login: {}, turn: { need_location: true } });
    assert.equal(r.skipped, false);
    assert.equal(r.need_location, true);
  });
});
```

- [ ] **Step 2: .env.example**

```
FLATTALK_CONTEXT_BUS=1
FLATTALK_NORMALIZE_TIMEOUT_MS=2000
FLATTALK_TURN_EXTRACT_TIMEOUT_MS=3000
FLATTALK_TAG_CORRECT_TIMEOUT_MS=2500
FLATTALK_INTENT_EXTRACT_OVERRIDE=0
FLATTALK_MAX_USER_CHARS=500
```

- [ ] **Step 3: Run full related suite**

```bash
node --test tests/context-bus-schema.test.js tests/context-bus-store.test.js tests/context-bus-login-bind.test.js tests/safety-gate.test.js tests/input-normalizer.test.js tests/turn-extractor.test.js tests/detectors-registry.test.js tests/pipeline-orchestrator-hook.test.js tests/pending-intents.test.js tests/context-bus-acceptance.test.js
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "test(context-bus): acceptance coverage and env flags"
```

---

## Spec coverage checklist

| Spec section | Task |
|--------------|------|
| Context Bus login/turn / inject_profile | 1–2 |
| SSO + Tag 双源 | 3 |
| SafetyGate | 4 |
| InputNormalizer | 5 |
| 500 字 | 5 |
| TurnExtractor + 城市通用化 | 6 |
| 多意图排队 | 6, 9 |
| Detector Registry + 注入 | 7–8 |
| 附近禁止无因 skip / meal has_elder | 7–8, 10 |
| 错误降级 | 3, 5, 8 |
| 验收用例 | 10 |
| RoleEntityMap 对齐 Tag | 1 |

## Self-review notes

- 无 TBD；类型名统一 `injectProfile` / `elder_binding.elder_id` / `need_location`。  
- LIS 仍默认权威路由；抽取意图仅 hint（可用 env 覆盖）。  
- Safety 模板本期可用 `answer` 文案，避免阻塞于新 HTML 卡。  
- TagCorrector 超时保持 provisional，与规格一致。
