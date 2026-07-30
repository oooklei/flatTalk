# 按钮动作通用兜底函数 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有未被硬编码特例覆盖的按钮动作（内容卡片按钮 + flowup 按钮）提供一个通用兜底：构造「谁/做什么/怎么做/有什么资源/每个动作的资源」五要素提示词，交给大模型合成，渲染返回即结束。

**Architecture:** 两类按钮已汇聚到 `chat-orchestrator.run`（带 `context.action_key`）。兜底入口即在该 run() 内：命中特例白名单则跳过；否则查 `action-resource-map.json`，用 `buildFallbackActionPrompt` 生成提示词，对 `target:"knowledge"` 的动作先经 `ragService` 检索注入 `evidence`，再调 `modelService.fillFallback`（强制走真实 LLM、绕过本地确定性模板），最终按 `next_template_id` 渲染。

**Tech Stack:** Node.js ESM、`node --test`（Node 内置测试）、OpenAI 兼容 LLM 通道、JSON 资源清单。

> **偏离 spec 说明（YAGNI）：** spec §8 列了 `app.js` 修改，但兜底所需资源由 `chat-orchestrator` 默认 `loadActionResourceMap()` 加载，`app.js` **无需改动**。`runLocalSkill` 已把 options 透传给 `createChatOrchestrator`，无需额外接线。

---

## 文件结构

| 文件 | 责任 | 操作 |
| --- | --- | --- |
| `src/core/actions/action-resource-map.json` | 按钮动作→接口/参数资源清单（含 `endpoint`+`param_sources`） | 新建 |
| `src/core/actions/fallback-prompt-builder.js` | `buildFallbackActionPrompt`（五要素纯函数）+ 特例白名单 + 加载器 | 新建 |
| `src/core/model-runtime/template-card-llm-service.js` | 新增 `fillFallback`（强制 LLM、接收 prompt 与 target template_id） | 修改 |
| `src/core/orchestrator/chat-orchestrator.js` | run() 新增兜底分支（查白名单→查 map→注入 evidence→fillFallback→渲染） | 修改 |
| `tests/action-resource-map.test.js` | 测加载器 + 查表 + 五要素提示词 | 新建 |
| `tests/template-card-llm-fallback.test.js` | 测 `fillFallback`（mock + LLM 路径） | 新建 |
| `tests/chat-orchestrator-fallback.test.js` | 集成测兜底分支（bff 类 + knowledge 类） | 新建 |

---

### Task 1: 资源清单 JSON + 加载器

**Files:**
- Create: `src/core/actions/action-resource-map.json`
- Create: `src/core/actions/fallback-prompt-builder.js`（仅加载器 + 白名单 + 查表部分）
- Test: `tests/action-resource-map.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/action-resource-map.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadActionResourceMap, getActionResource, SPECIAL_CASE_ACTION_KEYS, buildFallbackActionPrompt } from '../src/core/actions/fallback-prompt-builder.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const mapPath = path.join(moduleDir, '..', 'src', 'core', 'actions', 'action-resource-map.json');

test('loadActionResourceMap returns a Map keyed by action_key', () => {
  const map = loadActionResourceMap(mapPath);
  assert.ok(map instanceof Map);
  assert.ok(map.has('travel_route.calculate_budget'));
  assert.ok(map.has('travel_route.explain_safety'));
  assert.ok(map.has('meal_plan.check_risk'));
});

test('getActionResource returns the registered entry or null', () => {
  const map = loadActionResourceMap(mapPath);
  const entry = getActionResource('travel_route.calculate_budget', map);
  assert.equal(entry.target, 'bff');
  assert.equal(entry.next_template_id, 'route_card');
  assert.deepEqual(getActionResource('does.not.exist', map), null);
});

test('SPECIAL_CASE_ACTION_KEYS contains the weather risk action', () => {
  assert.ok(SPECIAL_CASE_ACTION_KEYS.includes('travel_route.check_weather_risk'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/action-resource-map.test.js`
Expected: FAIL — `Cannot find module '../src/core/actions/fallback-prompt-builder.js'`

- [ ] **Step 3: 创建资源清单 JSON**

```json
{
  "version": "flatalk-action-resource-map.v1",
  "actions": [
    {
      "action_key": "travel_route.calculate_budget",
      "label": "测算旅居预算",
      "skill_key": "travel_route",
      "target": "bff",
      "description": "测算住宿、交通、餐食、护理和陪同费用。",
      "endpoint": "（bff 内部能力，无外部 HTTP 地址）",
      "params_schema": { "destination": "string", "days": "number", "headcount": "number" },
      "param_sources": {
        "destination": "从上下文旅居产品 destination 抽取",
        "days": "从上下文行程天数抽取，缺省按 7 天",
        "headcount": "从上下文出行人数抽取，缺省按 2 人"
      },
      "next_template_id": "route_card"
    },
    {
      "action_key": "travel_route.check_accessibility",
      "label": "检查无障碍条件",
      "skill_key": "travel_route",
      "target": "bff",
      "description": "检查旅居基地与线路的无障碍设施与适老化条件。",
      "endpoint": "（bff 内部能力，无外部 HTTP 地址）",
      "params_schema": { "destination": "string" },
      "param_sources": { "destination": "从上下文旅居产品 destination 抽取" },
      "next_template_id": "route_card"
    },
    {
      "action_key": "travel_route.check_policy_subsidy",
      "label": "查询政策补贴",
      "skill_key": "travel_route",
      "target": "business_system",
      "description": "查询旅居养老、助老服务或相关补贴政策。",
      "endpoint": "GXY_BUSINESS_SYSTEM_BASE_URL（业务系统，base_url 由 env 提供）",
      "params_schema": { "region": "string", "elder_type": "string" },
      "param_sources": {
        "region": "从上下文老人所在地/旅居目的地抽取",
        "elder_type": "从上下文老人身份（如特困/低保/高龄）抽取"
      },
      "next_template_id": "policy_card"
    },
    {
      "action_key": "travel_route.explain_safety",
      "label": "讲解旅居安全要点",
      "skill_key": "travel_route",
      "target": "knowledge",
      "description": "基于康养知识库讲解长者旅居出行的安全与适老要点。",
      "endpoint": "本地/远程知识库（data/knowledge.json + knowledgeData.remote collections）",
      "params_schema": {},
      "param_sources": {},
      "next_template_id": "route_card"
    },
    {
      "action_key": "meal_plan.check_risk",
      "label": "检查膳食风险",
      "skill_key": "meal_plan",
      "target": "business_system",
      "description": "基于慢病与膳食方案检查潜在风险。",
      "endpoint": "GXY_BUSINESS_SYSTEM_BASE_URL",
      "params_schema": { "condition": "string" },
      "param_sources": { "condition": "从上下文老人慢病（糖尿病/高血压等）抽取" },
      "next_template_id": "diet_card"
    }
  ]
}
```

- [ ] **Step 4: 创建 fallback-prompt-builder.js（加载器 + 白名单 + 查表）**

```js
// src/core/actions/fallback-prompt-builder.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MAP_PATH = path.join(moduleDir, 'action-resource-map.json');

// 已有硬编码特例的动作，不走通用兜底
export const SPECIAL_CASE_ACTION_KEYS = [
  'travel_route.check_weather_risk',
];

export function loadActionResourceMap(filePath = DEFAULT_MAP_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    const byKey = new Map();
    for (const a of actions) {
      if (a && a.action_key) byKey.set(a.action_key, a);
    }
    return byKey;
  } catch {
    return new Map();
  }
}

export function getActionResource(actionKey, resourceMap = new Map()) {
  return resourceMap.get(actionKey) || null;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/action-resource-map.test.js`
Expected: PASS（3 tests）

- [ ] **Step 6: 提交**

```bash
git add src/core/actions/action-resource-map.json src/core/actions/fallback-prompt-builder.js tests/action-resource-map.test.js
git commit -m "feat(actions): add action-resource-map and loader for button fallback"
```

---

### Task 2: 兜底提示词构建器（五要素纯函数）

**Files:**
- Modify: `src/core/actions/fallback-prompt-builder.js`（追加 `buildFallbackActionPrompt` + `summarizeContext`）
- Test: `tests/action-resource-map.test.js`（追加用例）

- [ ] **Step 1: 写失败测试（追加到现有测试文件末尾）**

```js
test('buildFallbackActionPrompt emits the five elements with params', () => {
  const map = loadActionResourceMap(mapPath);
  const resource = getActionResource('travel_route.calculate_budget', map);
  const prompt = buildFallbackActionPrompt({
    actionKey: 'travel_route.calculate_budget',
    resource,
    skillKey: 'travel_route',
    context: { destination: '防城港', days: 7, headcount: 2 },
    evidence: [],
  });
  assert.ok(prompt.includes('【谁】'));
  assert.ok(prompt.includes('【做什么】'));
  assert.ok(prompt.includes('测算旅居预算'));
  assert.ok(prompt.includes('【怎么做】'));
  assert.ok(prompt.includes('参数个数：3 个'));
  assert.ok(prompt.includes('第1个参数：destination'));
  assert.ok(prompt.includes('从上下文旅居产品 destination 抽取'));
  assert.ok(prompt.includes('【有什么资源】'));
  assert.ok(prompt.includes('【每个动作的资源】'));
  assert.ok(prompt.includes('防城港'));
});

test('buildFallbackActionPrompt falls back to action_key when resource missing', () => {
  const prompt = buildFallbackActionPrompt({
    actionKey: 'travel_route.unknown_action',
    resource: null,
    skillKey: 'travel_route',
    context: {},
    evidence: [],
  });
  assert.ok(prompt.includes('travel_route.unknown_action'));
  assert.ok(prompt.includes('参数个数：0 个'));
  assert.ok(prompt.includes('（无可用上下文'));
});

test('buildFallbackActionPrompt injects evidence text', () => {
  const prompt = buildFallbackActionPrompt({
    actionKey: 'travel_route.explain_safety',
    resource: getActionResource('travel_route.explain_safety', loadActionResourceMap(mapPath)),
    skillKey: 'travel_route',
    context: {},
    evidence: [{ content: '长者出行需防滑防跌倒' }],
  });
  assert.ok(prompt.includes('长者出行需防滑防跌倒'));
  assert.ok(prompt.includes('target=knowledge'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/action-resource-map.test.js`
Expected: FAIL — `buildFallbackActionPrompt is not a function`

- [ ] **Step 3: 实现 buildFallbackActionPrompt（追加到文件末尾）**

```js
function summarizeContext(context = {}) {
  const parts = [];
  const push = (label, val) => {
    if (val != null && String(val).trim()) parts.push(`${label}：${String(val).trim()}`);
  };
  push('目的地', context.destination);
  push('出行人数', context.headcount);
  push('行程天数', context.days);
  push('老人慢病', context.conditions);
  push('老人所在地', context.region);
  push('老人身份', context.elder_type);
  return parts.length ? parts.join('；') : '（无可用上下文，请向用户追问缺失信息）';
}

export function buildFallbackActionPrompt({ actionKey, resource = null, skillKey = 'common', context = {}, evidence = [] } = {}) {
  const label = resource?.label || actionKey;
  const description = resource?.description || '（无详细描述）';
  const target = resource?.target || 'unknown';
  const endpoint = resource?.endpoint || '（未登记接口地址）';
  const paramsSchema = (resource?.params_schema && typeof resource.params_schema === 'object') ? resource.params_schema : {};
  const paramSources = (resource?.param_sources && typeof resource.param_sources === 'object') ? resource.param_sources : {};
  const paramEntries = Object.entries(paramsSchema);
  const paramCount = paramEntries.length;

  const paramLines = paramEntries.length
    ? paramEntries.map(([name, type], i) => `- 第${i + 1}个参数：${name}（含义/类型：${type}）；取值：${paramSources[name] || '（未登记取值方式）'}`).join('\n')
    : '- 无参数。';

  const evidenceText = Array.isArray(evidence) && evidence.length
    ? evidence.map((e, i) => `证据${i + 1}：${String(e?.content || e?.text || JSON.stringify(e)).slice(0, 300)}`).join('\n')
    : '（无注入证据）';

  return [
    '你是养老助手「桂小养」大模型，负责执行用户点击的按钮动作并合成面向老人家属的答复。',
    '',
    '【谁】你（桂小养大模型）。',
    `【做什么】按钮标签：${label}；说明：${description}。`,
    '【怎么做】',
    '- 执行时间：立刻（用户点击即触发）。',
    `- 使用资源：${target} / ${endpoint}。`,
    `- 接口地址：${endpoint}。`,
    `- 参数个数：${paramCount} 个。`,
    paramLines,
    '- 参数取值原则：优先从下方上下文已有信息抽取；缺失时向用户追问，不得臆造。',
    `【有什么资源】本技能（${skillKey}）可用资源以 action-resource-map 中同 skill_key 条目为准；含本地知识库 data/knowledge.json 与远程知识库 collections。`,
    `【每个动作的资源】本动作（${actionKey}）专用资源：${endpoint} + 上述参数。`,
    '',
    `当前上下文：${summarizeContext(context)}`,
    '',
    '已注入证据（evidence）：',
    evidenceText,
    '',
    '请基于以上资源与上下文执行该动作：',
    '- 若【有什么资源】含「知识库」类（target=knowledge），已为你注入相关证据（evidence），请基于证据推理作答；',
    '- 若含接口类资源（target=bff/business_system/HTTP），请依据接口地址与参数说明，结合上下文给出可执行方案与要点（当前不要求你直接发起 HTTP 请求）；',
    `最终以结构化 JSON 返回，匹配模板 ${resource?.next_template_id || 'answer'} 的字段结构（含 title、summary、要点列表、风险提示、后续建议）。`,
  ].join('\n');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/action-resource-map.test.js`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add src/core/actions/fallback-prompt-builder.js tests/action-resource-map.test.js
git commit -m "feat(actions): add buildFallbackActionPrompt five-element prompt builder"
```

---

### Task 3: modelService.fillFallback（强制 LLM + mock 降级）

**Files:**
- Modify: `src/core/model-runtime/template-card-llm-service.js`
- Test: `tests/template-card-llm-fallback.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/template-card-llm-fallback.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateCardModelService } from '../src/core/model-runtime/template-card-llm-service.js';

test('fillFallback in mock mode returns offline answer with target template_id', async () => {
  const svc = createTemplateCardModelService({ runtimeMode: 'test' });
  const res = await svc.fillFallback({ prompt: 'x', template_id: 'route_card' });
  assert.equal(res.template_id, 'route_card');
  assert.equal(res.model_status, 'fallback_mock');
  assert.ok(res.answer_text.includes('兜底'));
});

test('fillFallback calls the LLM and sanitizes shape when a model is available', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"title":"T","summary":"S","answer_text":"你好"}' } }],
    }),
  });
  const svc = createTemplateCardModelService({
    runtimeMode: 'test',
    fetchImpl: fakeFetch,
    registryPath: undefined,
    modelId: 'test-model',
  });
  // 强制有模型：直接注入一个 model 绕过 pickChatModel（触发 fillFallback 内的 testModel setter）
  svc.testModel = { id: 'test-model', max_tokens: 800, temperature: 0.3 };
  const res = await svc.fillFallback({ prompt: 'p', template_id: 'answer' });
  assert.equal(res.model_status, 'ok');
  assert.equal(res.template_id, 'answer');
  assert.equal(res.answer_text, '你好');
});
```

> 注：第二个测试依赖 `svc.__test_model`。实现时在 `fillFallback` 内用 `options.testModel || pickChatModel(...)`，并在服务里暴露 `this.__test_model` 赋值（见 Step 3）。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/template-card-llm-fallback.test.js`
Expected: FAIL — `svc.fillFallback is not a function`

- [ ] **Step 3: 实现 fillFallback + buildFallbackMockAnswer（在 `createTemplateCardModelService` 返回对象内与模块底部新增）**

在返回对象 `fillTemplateSlots` 之后追加：

```js
    async fillFallback(input = {}) {
      const templateId = input.template_id || input.templateId || 'answer';
      const model = options.testModel || pickChatModel({ registryPath: options.registryPath, modelId: options.modelId });
      if (useMock || !model) {
        return buildFallbackMockAnswer(input, useMock ? 'mock_mode' : 'no_available_model');
      }
      const messages = [
        { role: 'system', content: loadPrompt('template-card/system.md') },
        { role: 'user', content: input.prompt || '' },
      ];
      const response = await callOpenAiCompatibleModel(model, messages, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        maxTokens: input.max_tokens || model.max_tokens,
        temperature: input.temperature ?? model.temperature ?? 0.3,
      });
      if (!response.ok) return buildFallbackMockAnswer(input, response.status);

      const parsed = parseModelJson(response.content);
      if (!parsed) return buildFallbackMockAnswer(input, 'invalid_json', response.content);

      return sanitizeShape(
        { ...parsed, model_status: 'ok', model_used: publicModelName(model) },
        { template_id: templateId },
      );
    },
```

在文件底部（`shouldUseDeterministicTemplate` 之前或之后）新增模块函数：

```js
function buildFallbackMockAnswer(input = {}, status = 'mock', rawReply = '') {
  const templateId = input.template_id || input.templateId || 'answer';
  const reason = '（兜底离线说明）当前未调用大模型，仅返回动作提示词摘要。';
  return {
    template_id: templateId,
    template_key: templateId,
    answer_text: `[兜底动作] ${reason}`,
    answer: `[兜底动作] ${reason}`,
    data: {},
    actions: [],
    followup_suggestions: [],
    template_fit_notes: ['fallback_mock'],
    model_status: 'fallback_mock',
    model_used: 'mock',
    model_error: status,
    raw_reply: rawReply ? String(rawReply).slice(0, 1000) : '',
  };
}
```

并在返回对象上暴露测试钩子（紧接 `fillFallback` 后）：

```js
    // 测试钩子：允许测试注入模型，绕过 pickChatModel
    set testModel(m) { options.testModel = m; },
```

> 说明：测试里 `svc.__test_model = ...` 会触发该 setter（`__test_model` 经 `Object.defineProperty`？为简单，测试改为 `Object.defineProperty(svc, '__test_model', { set(v){ options.testModel = v; } })`）。更稳妥：测试直接调用内部不可行，故改测试用 `svc.testModel = model`（上面 setter 名为 `testModel`），测试代码 Step 1 中 `svc.__test_model` 改为 `svc.testModel`。

修正测试 Step 1 第二例：把 `svc.__test_model = {...}` 改为 `svc.testModel = { id: 'test-model', max_tokens: 800, temperature: 0.3 };`

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/template-card-llm-fallback.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: 提交**

```bash
git add src/core/model-runtime/template-card-llm-service.js tests/template-card-llm-fallback.test.js
git commit -m "feat(model): add fillFallback for generic button action LLM synthesis"
```

---

### Task 4: orchestrator 兜底分支（查白名单→查 map→注入 evidence→fillFallback→渲染）

**Files:**
- Modify: `src/core/orchestrator/chat-orchestrator.js`
- Test: `tests/chat-orchestrator-fallback.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/chat-orchestrator-fallback.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';
import { createTemplateCardModelService } from '../src/core/model-runtime/template-card-llm-service.js';

test('uncovered travel_route bff action routes through fallback (mock LLM)', async () => {
  const modelService = createTemplateCardModelService({ runtimeMode: 'test' });
  const result = await runLocalSkill({
    conversation_id: 'conv_fb_1',
    turn_id: 'turn_fb_1',
    skill_key: 'travel_route',
    message: '测算一下旅居预算',
    role: 'elder_family',
    context: { action_key: 'travel_route.calculate_budget' },
  }, { modelService });

  assert.equal(result.ok, true);
  assert.equal(result.skill_key, 'travel_route');
  assert.equal(result.template_id, 'route_card'); // next_template_id from map
  assert.ok(result.rendered_html && result.rendered_html.length > 0);
});

test('uncovered travel_route knowledge action injects evidence via ragService', async () => {
  const modelService = createTemplateCardModelService({ runtimeMode: 'test' });
  let retrieved = false;
  const fakeRag = {
    async retrieveKnowledge() { retrieved = true; return { matches: [{ content: '防滑防跌倒要点' }], status: 'local' }; },
    async retrieveMealPlanKnowledge() { return { matches: [], status: 'skipped' }; },
  };
  const result = await runLocalSkill({
    conversation_id: 'conv_fb_2',
    turn_id: 'turn_fb_2',
    skill_key: 'travel_route',
    message: '讲讲旅居安全',
    role: 'elder_family',
    context: { action_key: 'travel_route.explain_safety' },
  }, { modelService, ragService: fakeRag });

  assert.equal(result.ok, true);
  assert.equal(result.skill_key, 'travel_route');
  assert.equal(result.template_id, 'route_card');
  assert.equal(retrieved, true); // knowledge 分支触发了检索
});

test('special-case weather action is NOT routed to generic fallback', async () => {
  const modelService = createTemplateCardModelService({ runtimeMode: 'test' });
  const result = await runLocalSkill({
    conversation_id: 'conv_fb_3',
    turn_id: 'turn_fb_3',
    skill_key: 'travel_route',
    message: '看天气风险',
    role: 'elder_family',
    context: { action_key: 'travel_route.check_weather_risk', action_params: { city: '防城港' } },
  }, { modelService });

  assert.equal(result.ok, true);
  assert.equal(result.template_id, 'travel_weather_risk_card'); // 走特例，非兜底
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/chat-orchestrator-fallback.test.js`
Expected: FAIL — `result.template_id` 断言失败（当前 `calculate_budget` 走常规 fillTemplateSlots，不会得到 `route_card` 兜底渲染或得到不同模板）

- [ ] **Step 3: 修改 chat-orchestrator.js**

3a. 在文件顶部 import 区（`import { fillTemplateSlots, fillTravelWeatherRisk } from '../model-service.js';` 附近）追加：

```js
import { buildFallbackActionPrompt, loadActionResourceMap, getActionResource, SPECIAL_CASE_ACTION_KEYS } from '../actions/fallback-prompt-builder.js';
```

3b. 在 `createChatOrchestrator` 内 `const weatherService = options.weatherService ?? null;` 之后追加：

```js
  const actionResourceMap = options.actionResourceMap ?? loadActionResourceMap();
```

3c. 将 run() 中 `let modelResult;` 段替换为带兜底分支的版本：

```js
        let modelResult;
        const fallbackActionKey = (request.context?.action_key && !SPECIAL_CASE_ACTION_KEYS.includes(request.context.action_key))
          ? request.context.action_key
          : null;
        if (weatherActionCity) {
          const weather = weatherService ? await weatherService.getWeather(weatherActionCity).catch(() => null) : null;
          modelResult = fillTravelWeatherRisk({ city: weatherActionCity, weather, business_data: businessData });
          mark('model', '天气风险研判', { city: weatherActionCity, weather_ok: !!(weather && weather.ok), source: weather?.source || 'none' });
        } else if (fallbackActionKey) {
          const resource = getActionResource(fallbackActionKey, actionResourceMap);
          const fallbackEvidence = (resource && resource.target === 'knowledge')
            ? (await retrieveMultiKnowledge(ragService, {
                skill_keys: Array.from(new Set([skillKey, resource.skill_key].filter(Boolean))),
                query: resource.label || fallbackActionKey,
                limit: 3,
                filters: {
                  elder_id: request.elder_id || request.context?.elder_id || request.elderScope || '',
                  role_key: request.role || request.roleKey || '',
                },
              })).matches
            : [];
          const fallbackPrompt = buildFallbackActionPrompt({
            actionKey: fallbackActionKey,
            resource,
            skillKey,
            context: buildFallbackContext(businessData, request),
            evidence: fallbackEvidence,
          });
          if (typeof modelService.fillFallback === 'function') {
            modelResult = await modelService.fillFallback({
              prompt: fallbackPrompt,
              template_id: resource?.next_template_id || 'answer',
              skill_key: skillKey,
              evidence: fallbackEvidence,
              business_data: businessData,
            });
          } else {
            modelResult = buildFallbackMockModelResult(resource, skillKey);
          }
          mark('model', '兜底动作', { action_key: fallbackActionKey, target: resource?.target || 'unknown', has_llm: typeof modelService.fillFallback === 'function' });
        } else {
          modelResult = await modelService.fillTemplateSlots({
            message: sceneInput.text,
            skill_key: skillKey,
            intent_context: intentContext,
            template_id: request.template_id || request.templateId || routedTemplateId,
            default_template_id: skillTemplates.defaultTemplateId,
            template_library: skillTemplates.library,
            evidence: knowledge.matches,
            business_data: businessData,
          });
          mark('model', '模板填充', { model: modelResult.model_used, status: modelResult.model_status, template_id: modelResult.template_id });
        }
```

3d. 在文件底部辅助函数区（`resolveWeatherCity` 附近）新增两个辅助函数：

```js
function buildFallbackContext(businessData = {}, request = {}) {
  const jtd = businessData?.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);
  const route = businessData?.route || (Array.isArray(businessData.routes) ? businessData.routes[0] : null);
  return {
    destination: product?.destination || product?.city || route?.destination || businessData?.destination || '',
    headcount: businessData?.headcount || product?.headcount || '',
    days: businessData?.days || product?.days || '',
    conditions: businessData?.conditions || businessData?.chronic_diseases || '',
    region: businessData?.region || product?.region || '',
    elder_type: businessData?.elder_type || '',
  };
}

function buildFallbackMockModelResult(resource, skillKey) {
  const templateId = resource?.next_template_id || 'answer';
  const label = resource?.label || '该动作';
  return {
    template_id: templateId,
    template_key: templateId,
    answer_text: `【兜底动作·离线说明】${label}：${resource?.description || ''} 已触发，但因当前未接入大模型合成，仅返回说明。目标模板：${templateId}。`,
    answer: `【兜底动作·离线说明】${label}。`,
    data: {},
    actions: [],
    followup_suggestions: [],
    template_fit_notes: ['fallback_no_llm'],
    model_status: 'fallback_mock',
    model_used: 'mock',
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/chat-orchestrator-fallback.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: 运行全量测试确保无回归**

Run: `node --test tests/*.test.js`
Expected: 全部 PASS（含现有 travel_route / meal_plan / model-runtime 测试）

- [ ] **Step 6: 提交**

```bash
git add src/core/orchestrator/chat-orchestrator.js tests/chat-orchestrator-fallback.test.js
git commit -m "feat(orchestrator): route uncovered button actions through generic fallback"
```

---

## 自审（Self-Review）

**1. Spec 覆盖检查：**
- §2 覆盖两类按钮（C）：✅ 前端无需改，两类都已汇聚 orchestrator（Task 4 集成测试覆盖 bff 与 knowledge 两类）。
- §3 仅 fallback（B）：✅ `SPECIAL_CASE_ACTION_KEYS` 白名单，Task 4 第三例验证 `check_weather_risk` 不走兜底。
- §4 资源清单（A）：✅ Task 1 创建 `action-resource-map.json`，含 `endpoint`+`param_sources`；`target:"knowledge"` 分支在 Task 4 第二例验证。
- §5 五要素提示词：✅ Task 2 `buildFallbackActionPrompt`，测试断言五要素与参数计数/来源。
- §6 兜底分支 + evidence 注入 + next_template_id 匹配：✅ Task 4 实现并测试（mock 用 `route_card` 渲染）。
- §6.2 接口类不真调 HTTP：✅ 提示词明确"不要求直接发 HTTP"；真取数为后续扩展，未实现（符合范围）。
- §7 降级：✅ `buildFallbackMockAnswer`（mock/无模型）、`buildFallbackMockModelResult`（modelService 无 fillFallback）、`loadActionResourceMap` 异常返回空 Map。
- §8 文件改动：✅ 全部覆盖；app.js 标注无需改（YAGNI 偏离，已说明）。

**2. Placeholder 扫描：** 无 TBD/TODO；所有代码步均含完整代码块；无"类似 Task N"引用。

**3. 类型/命名一致性：**
- `buildFallbackActionPrompt` / `loadActionResourceMap` / `getActionResource` / `SPECIAL_CASE_ACTION_KEYS` 在 Task1-4 命名一致。
- `modelService.fillFallback` 签名 `{ prompt, template_id, skill_key, evidence, business_data }` 在 Task3 定义、Task4 调用一致。
- `buildFallbackContext` / `buildFallbackMockModelResult` 在 Task4 定义并使用。
- `testModel` setter 与测试修正（`svc.testModel =`）一致。
