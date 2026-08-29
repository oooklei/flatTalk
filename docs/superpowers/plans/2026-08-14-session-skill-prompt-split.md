# Session vs Skill LLM Prompt Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将会话身份（自然语言 1～2 句）写入 template-card **system**，将【会话画像】与【技能业务数据】拆开写入 **user**，并明确引用优先级。

**Architecture:** 在 `session-prompt-context.js` 生成 `session_context_text` 并拆分 `business_data`；`template-card-llm-service.buildMessages` / `fillFallback` 注入；编排层合并后的 `businessData` 不变，供本地填槽继续使用。

**Tech Stack:** Node.js ESM、`node:test`、现有 `loadPrompt`、Context Bus `shared` / `business_data`

**Spec:** `docs/superpowers/specs/2026-08-14-session-skill-prompt-split-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/context-bus/session-prompt-context.js` | 创建 | `buildSessionContextText` + `splitBusinessDataForPrompt` |
| `src/core/context-bus/index.js` | 修改 | 导出新模块 |
| `src/prompts/template-card/system.md` | 修改 | `【会话身份】` + 引用约定 |
| `src/prompts/template-card/fill-template.md` | 修改 | `【会话画像】` + `【技能业务数据】` |
| `src/core/model-runtime/template-card-llm-service.js` | 修改 | `buildMessages` / `fillFallback` 注入拆分结果；导出 `buildTemplateCardMessages` 供测 |
| `tests/session-prompt-context.test.js` | 创建 | 身份句 + 拆分单测 |
| `tests/template-card-prompt-split.test.js` | 创建 | messages 结构断言 |

---

### Task 1: `session-prompt-context` 纯函数（TDD）

**Files:**
- Create: `src/core/context-bus/session-prompt-context.js`
- Create: `tests/session-prompt-context.test.js`
- Modify: `src/core/context-bus/index.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionContextText,
  splitBusinessDataForPrompt,
  SESSION_FIELDS_FOR_SKILL_STRIP,
} from '../src/core/context-bus/session-prompt-context.js';

describe('buildSessionContextText', () => {
  it('elder self: one sentence', () => {
    const t = buildSessionContextText({
      profile_scope: 'self',
      display_name: '黄秀英',
      user_name: '黄秀英',
    });
    assert.match(t, /黄秀英/);
    assert.match(t, /老人本人/);
  });

  it('family: lists elder names', () => {
    const t = buildSessionContextText({
      profile_scope: 'family_elders',
      user_name: '陈晓梅',
      entity_profiles: [
        { entity_type: 'ELDER', name: '黄秀英' },
        { entity_type: 'ELDER', name: '李德明' },
      ],
      elders: [{ elder_name: '黄秀英' }, { elder_name: '李德明' }],
    });
    assert.match(t, /陈晓梅/);
    assert.match(t, /家属/);
    assert.match(t, /黄秀英/);
    assert.match(t, /李德明/);
  });

  it('org: names institution', () => {
    const t = buildSessionContextText({
      profile_scope: 'org',
      user_name: '陈建国',
      org: { org_id: 'o1', org_name: '桂小养康养中心' },
    });
    assert.match(t, /机构/);
    assert.match(t, /桂小养康养中心/);
  });

  it('service_provider: names provider', () => {
    const t = buildSessionContextText({
      profile_scope: 'service_provider',
      user_name: '张服务',
      org: { org_name: '广西康养服务商' },
      entity_profile: { name: '广西康养服务商' },
    });
    assert.match(t, /服务商/);
    assert.match(t, /广西康养服务商/);
  });

  it('appends city half-sentence when present', () => {
    const t = buildSessionContextText({
      profile_scope: 'self',
      display_name: '黄秀英',
      city: '南宁',
    });
    assert.match(t, /南宁/);
  });
});

describe('splitBusinessDataForPrompt', () => {
  it('moves session fields to profiles and keeps jtd in skill', () => {
    const { session_profiles, skill_business_data } = splitBusinessDataForPrompt({
      user_name: '陈晓梅',
      entity_profile: { entity_id: 'e1', name: '黄秀英', tags: [] },
      entity_profiles: [{ entity_id: 'e1', name: '黄秀英' }],
      weather: { ok: true, text: '晴' },
      location: { city: '南宁' },
      city: '南宁',
      profile_scope: 'family_elders',
      jtd: { products: [{ product_id: 'p1' }] },
      routes: [{ route_id: 'r1' }],
      destination: '北海',
    });
    assert.equal(session_profiles.user_name, '陈晓梅');
    assert.equal(session_profiles.entity_profile?.name, '黄秀英');
    assert.ok(session_profiles.entity_profiles?.length);
    assert.equal(session_profiles.weather?.text, '晴');
    assert.deepEqual(skill_business_data.jtd.products[0], { product_id: 'p1' });
    assert.equal(skill_business_data.destination, '北海');
    assert.equal(skill_business_data.entity_profile, undefined);
    assert.equal(skill_business_data.user_name, undefined);
    assert.equal(skill_business_data.weather, undefined);
  });

  it('handles empty / non-object', () => {
    const a = splitBusinessDataForPrompt(null);
    assert.deepEqual(a.session_profiles, {});
    assert.deepEqual(a.skill_business_data, {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-prompt-context.test.js`  
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

Create `src/core/context-bus/session-prompt-context.js`:

```js
export const SESSION_FIELDS_FOR_SKILL_STRIP = [
  'user_name', 'elder_name', 'display_name', 'profile_scope',
  'entity_profile', 'entity_profiles', 'weather', 'location',
  'shared', 'user_id', 'role_key', 'role_id', 'org', 'elders',
  'elder_id', 'has_elder', 'identity_status', 'entity_type', 'entity_id',
  'tags', 'normalized_text', 'mentioned_entities', 'pronouns',
  'need_location', 'resources', 'skill_key', 'primary_city',
];

function pickName(...vals) {
  for (const v of vals) {
    const s = v == null ? '' : String(v).trim();
    if (s) return s;
  }
  return '';
}

function elderNameList(bd = {}) {
  const fromProfiles = (Array.isArray(bd.entity_profiles) ? bd.entity_profiles : [])
    .filter((p) => !p.entity_type || p.entity_type === 'ELDER')
    .map((p) => pickName(p.name, p.entity_name, p.elder_name))
    .filter(Boolean);
  if (fromProfiles.length) return [...new Set(fromProfiles)];
  const fromElders = (Array.isArray(bd.elders) ? bd.elders : [])
    .map((e) => pickName(e.elder_name, e.name))
    .filter(Boolean);
  if (fromElders.length) return [...new Set(fromElders)];
  const one = pickName(bd.elder_name);
  return one ? [one] : [];
}

/**
 * @param {object} bd - merged businessData / shared-like fields
 * @returns {string}
 */
export function buildSessionContextText(bd = {}) {
  const scope = bd.profile_scope || '';
  const userName = pickName(bd.user_name, bd.display_name);
  const displayName = pickName(bd.display_name, bd.user_name, bd.elder_name);
  const orgName = pickName(bd.org?.org_name, bd.entity_profile?.name, bd.entity_profile?.entity_name);
  const city = pickName(bd.city, bd.primary_city);
  let core = '';
  if (scope === 'family_elders') {
    const names = elderNameList(bd);
    const list = names.length ? names.join('、') : '（暂无绑定老人）';
    core = `当前用户是${userName || '家属用户'}（家属）。你代表其名下老人：${list}。`;
  } else if (scope === 'org') {
    core = `当前用户是${userName || '机构用户'}（机构侧）。你代表机构：${orgName || '（未命名机构）'}。`;
  } else if (scope === 'service_provider') {
    core = `当前用户是${userName || '服务商用户'}（服务商侧）。你代表服务商：${orgName || '（未命名服务商）'}。`;
  } else if (scope === 'self') {
    core = `当前用户是${displayName || userName || '老人用户'}（老人本人）。`;
  } else {
    core = `当前用户是${displayName || userName || '用户'}。`;
  }
  if (city) core += `当前关注城市：${city}。`;
  return core.trim();
}

/**
 * @param {object|null} businessData
 * @returns {{ session_profiles: object, skill_business_data: object }}
 */
export function splitBusinessDataForPrompt(businessData) {
  if (!businessData || typeof businessData !== 'object') {
    return { session_profiles: {}, skill_business_data: {} };
  }
  const session_profiles = {};
  const profileKeys = [
    'user_name', 'elder_name', 'display_name', 'profile_scope',
    'entity_profile', 'entity_profiles', 'weather', 'location', 'city',
    'primary_city', 'elders', 'elder_id', 'org',
  ];
  for (const k of profileKeys) {
    if (businessData[k] !== undefined && businessData[k] !== null && businessData[k] !== '') {
      session_profiles[k] = businessData[k];
    }
  }
  const skill_business_data = { ...businessData };
  for (const k of SESSION_FIELDS_FOR_SKILL_STRIP) {
    delete skill_business_data[k];
  }
  // city / primary_city：会话定位进 profiles；若技能也用 city 作目的地，destination 等仍留在 skill
  delete skill_business_data.city;
  delete skill_business_data.primary_city;
  return { session_profiles, skill_business_data };
}
```

Export from `src/core/context-bus/index.js`:

```js
export * from './session-prompt-context.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/session-prompt-context.test.js`  
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/context-bus/session-prompt-context.js src/core/context-bus/index.js tests/session-prompt-context.test.js
git commit -m "feat: add session vs skill prompt context split helpers"
```

---

### Task 2: 更新 prompt 模板

**Files:**
- Modify: `src/prompts/template-card/system.md`
- Modify: `src/prompts/template-card/fill-template.md`

- [ ] **Step 1: Update `system.md`**

Replace file content with (keep existing rules, append identity block):

```md
你是“桂小养”本地技能运行时的后端大模型。

你的任务是根据用户问题、意图分类、知识库证据、会话画像、技能业务数据和可用 HTML 模板说明，输出一份可被后端 template-card 渲染器直接使用的 JSON。

必须遵守：
- 只输出 JSON，不输出 Markdown，不解释。
- 必须从 template_library 中选择一个真实存在的 template_id。
- 不要输出完整 HTML、script、style、iframe 或事件属性。
- data 字段必须只放模板需要的数据。
- answer_text 是给用户看的简短自然语言答复。
- actions 和 followup_suggestions 只能放后续真实可处理的建议；不确定时返回空数组。
- 医疗健康内容只能做生活照护和膳食建议，不能替代医生诊断。

【会话身份】
{{session_context_text}}

引用约定：身份以本段为准；人物/机构详情见 user 的【会话画像】；本轮业务与资源见【技能业务数据】。缺信息追问，勿臆造。
```

- [ ] **Step 2: Update `fill-template.md`**

In `src/prompts/template-card/fill-template.md`, replace the block:

```md
【业务表数据】
{{business_data}}
```

with:

```md
【会话画像】
{{session_profiles}}

【技能业务数据】
{{skill_business_data}}
```

Keep all other sections unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/template-card/system.md src/prompts/template-card/fill-template.md
git commit -m "feat: split session identity and skill data in template-card prompts"
```

---

### Task 3: 接入 `buildMessages` / `fillFallback`

**Files:**
- Modify: `src/core/model-runtime/template-card-llm-service.js`
- Create: `tests/template-card-prompt-split.test.js`

- [ ] **Step 1: Write the failing integration test**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateCardMessages } from '../src/core/model-runtime/template-card-llm-service.js';

describe('buildTemplateCardMessages', () => {
  it('puts identity in system and splits user blocks', () => {
    const messages = buildTemplateCardMessages({
      message: '帮我看看北海路线',
      skill_key: 'travel_route',
      intent_context: { intent: 'travel' },
      template_id: 'sojourn_route',
      template_library: [{ id: 'sojourn_route' }],
      template_fields: [],
      evidence: [],
      conversation_history: [],
      business_data: {
        profile_scope: 'family_elders',
        user_name: '陈晓梅',
        entity_profiles: [{ entity_type: 'ELDER', name: '黄秀英' }],
        weather: { ok: true, text: '多云' },
        jtd: { products: [{ product_id: 'p1' }] },
      },
    });
    const system = messages.find((m) => m.role === 'system')?.content || '';
    const user = messages.filter((m) => m.role === 'user').at(-1)?.content || '';
    assert.match(system, /【会话身份】/);
    assert.match(system, /陈晓梅/);
    assert.match(system, /黄秀英/);
    assert.match(system, /引用约定/);
    assert.match(user, /【会话画像】/);
    assert.match(user, /【技能业务数据】/);
    assert.match(user, /p1/);
    assert.doesNotMatch(user, /【业务表数据】/);
    // skill block should not re-dump entity_profiles as only source of truth for identity
    const skillSection = user.split('【技能业务数据】')[1] || '';
    assert.doesNotMatch(skillSection, /"entity_profiles"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/template-card-prompt-split.test.js`  
Expected: FAIL (`buildTemplateCardMessages` not exported)

- [ ] **Step 3: Wire `template-card-llm-service.js`**

At top of file, add:

```js
import {
  buildSessionContextText,
  splitBusinessDataForPrompt,
} from '../context-bus/session-prompt-context.js';
```

Replace `buildMessages` with exported wrapper:

```js
export function buildTemplateCardMessages(input = {}) {
  return buildMessages(input);
}

function buildMessages(input) {
  const historyText = formatHistoryText(input.conversation_history);
  const businessData = input.business_data || {};
  const session_context_text = input.session_context_text
    || buildSessionContextText(businessData);
  const split = input.session_profiles || input.skill_business_data
    ? {
        session_profiles: input.session_profiles || {},
        skill_business_data: input.skill_business_data || {},
      }
    : splitBusinessDataForPrompt(businessData);

  const system = loadPrompt('template-card/system.md', {
    session_context_text: session_context_text || '（当前会话暂无明确登录身份）',
  });
  const user = loadPrompt('template-card/fill-template.md', {
    user_message: input.message || '',
    intent_context: input.intent_context || {},
    skill_key: input.skill_key || '',
    requested_template_id: input.template_id || input.templateId || '',
    template_library: input.template_library || [],
    template_fields: input.template_fields || [],
    evidence: input.evidence || [],
    session_profiles: split.session_profiles,
    skill_business_data: split.skill_business_data,
    conversation_history: historyText,
    skill_instruction: buildSkillInstruction(input.skill_key),
  });
  const messages = [{ role: 'system', content: system }];
  const history = Array.isArray(input.conversation_history) ? input.conversation_history : [];
  for (const msg of history) {
    if (msg.role && msg.content) messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: user });
  return messages;
}
```

Update `fillFallback` messages construction:

```js
const session_context_text = buildSessionContextText(input.business_data || {});
const messages = [
  {
    role: 'system',
    content: loadPrompt('template-card/system.md', {
      session_context_text: session_context_text || '（当前会话暂无明确登录身份）',
    }),
  },
  { role: 'user', content: input.prompt || '' },
];
```

Ensure `fillTemplateSlots` still calls `buildMessages({ ...input, template_fields: templateFields })` (unchanged call site).

- [ ] **Step 4: Run tests**

Run:

```bash
node --test tests/session-prompt-context.test.js tests/template-card-prompt-split.test.js tests/context-bus-schema.test.js
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/model-runtime/template-card-llm-service.js tests/template-card-prompt-split.test.js
git commit -m "feat: inject session identity and split skill data into LLM prompts"
```

---

### Task 4: 回归冒烟 + 文档状态

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-session-skill-prompt-split-design.md`（状态改为已实现）

- [ ] **Step 1: Run broader related tests**

```bash
node --test tests/session-prompt-context.test.js tests/template-card-prompt-split.test.js tests/context-bus-schema.test.js
```

If any existing test asserts on `【业务表数据】` string, update that assertion to the new section titles.

Search:

```bash
rg "业务表数据|business_data\}\}" tests src/prompts -n
```

Fix any stale expectations.

- [ ] **Step 2: Mark spec status**

In the design doc header, set `**状态**: 已实现` (or `实现中` → after green tests `已实现`).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-14-session-skill-prompt-split-design.md
git commit -m "docs: mark session-skill prompt split design implemented"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| system 1～2 句自然语言身份 | Task 1 + 2 + 3 |
| user 拆【会话画像】/【技能业务数据】 | Task 2 + 3 |
| 引用约定文案 | Task 2 |
| skill 包剔除会话字段 | Task 1 `SESSION_FIELDS_FOR_SKILL_STRIP` |
| 不改 hydrate/缓存 | 无对应改动（刻意） |
| 本地填槽不强制拆提示 | Task 3 仅 LLM 路径 |
| fillFallback 追加身份 | Task 3 |
| 家属/机构/服务商/本人测试 | Task 1 + 3 |

## Out of scope (do not implement in this plan)

- 改 `FLATTALK_SHARED_TTL_MS` / hydrate 缓存  
- 把完整 tags 塞进 system  
- 编排器 `chat-orchestrator.js` 强制预拆（由 model 层拆分即可）
