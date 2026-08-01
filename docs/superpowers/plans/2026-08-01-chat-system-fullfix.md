# 聊天系统全链路修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 LLM 零记忆、模板兜底回显、SOS 检测失效、路由互窜、卡片按钮无响应 6 个架构缺陷

**Architecture:** 分层解耦 — 新增 ConversationContextManager / SmartFallbackHandler / CardInteractionBridge 三个模块，修补 SOS 检测/路由防窜/JSON Schema 注入

**Tech Stack:** Node.js ESM, node --test, 无框架

---

## File Structure

### 新增文件

| 文件 | 职责 |
|---|---|
| `src/core/conversation/context-manager.js` | 对话上下文管理：按 agent 取最近10轮历史，过滤无效轮次 |
| `src/core/fallback/smart-fallback-handler.js` | 智能兜底：检测降级 → 免模板 LLM 回答 → 统一 answer 渲染 |
| `src/prompts/template-card/free-answer.md` | 免模板提示词（不传 template_library） |
| `src/public/card-bridge.js` | 卡片 iframe 内通用点击脚本，postMessage 桥接 |
| `src/core/render/bridge-injector.js` | 渲染时将 card-bridge.js 注入 iframe srcdoc |
| `tests/context-manager.test.js` | ConversationContextManager 单元测试 |
| `tests/smart-fallback.test.js` | SmartFallbackHandler 单元测试 |
| `tests/sos-detection.test.js` | SOS 检测前置测试 |
| `tests/routing-guard.test.js` | 路由 forced skill_key guard 测试 |
| `tests/card-bridge.test.js` | CardInteractionBridge 测试 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/app.js` L450-512 | 读取 body.conversationHistory；普通消息也设 previous_turn_id |
| `src/core/orchestrator/chat-orchestrator.js` L72,355-366,457-462 | 注入 history 到 LLM；SOS 前置；acceptScene forced guard |
| `src/core/model-runtime/template-card-llm-service.js` L123-139 | buildMessages 接收 history 参数 |
| `src/prompts/template-card/fill-template.md` | 增加 conversation_history 占位 |
| `src/core/model-service.js` L88-108 | 兜底块改为调用 SmartFallbackHandler |
| `src/core/agents/supervisor.js` L10 | SOS_TERMS 复用 emergency-detector |
| `src/public/mobile.js` | postMessage 监听改为通用 handleCardAction + MutationObserver |
| `src/template-card/index.js` | renderCard 时调 bridge-injector |
| `src/skills/meal_plan/templates/html/meal_timeline_card.manifest.json` | 补 data_schema |
| `src/skills/meal_plan/templates/html/meal_overview_card.manifest.json` | 补 data_schema |
| `src/skills/travel_route/templates/html/travel_base_card.manifest.json` | 补 data_schema |
| `src/core/interaction-composer.js` | 去重逻辑增加 user_prompt 维度 |

---

### Task 1: ConversationContextManager — 对话上下文管理

**Files:**
- Create: `src/core/conversation/context-manager.js`
- Test: `tests/context-manager.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/context-manager.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextManager } from '../src/core/conversation/context-manager.js';

// Mock sessionStore
function mockSessionStore(sessions = {}) {
  return {
    async getOrCreate(id) {
      return sessions[id] || {
        conversation_id: id, turns: [], agents: {}, active_agent: '', global_context: {}, updated_at: '',
      };
    },
  };
}

test('buildHistory returns last N valid turns for agent', async () => {
  const store = mockSessionStore({
    conv1: {
      conversation_id: 'conv1',
      turns: [],
      agents: {
        meal_plan: {
          turns: [
            { user_message: '推荐食谱', envelope: { answer_text: '小米粥', template_id: 'diet_card', model_status: 'ok' } },
            { user_message: '换一份', envelope: { answer_text: '抱歉，无法处理', template_id: 'answer', model_status: 'fallback_mock' } },
            { user_message: '清淡点', envelope: { answer_text: '燕麦粥', template_id: 'diet_card', model_status: 'ok' } },
          ],
          last_template: 'diet_card', scoped_data: {}, frozen: false,
        },
      },
      active_agent: 'meal_plan',
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.buildHistory('conv1', 'meal_plan');
  assert.equal(history.length, 2, 'should filter out the fallback_mock turn');
  assert.deepEqual(
    history.map((h) => h.role),
    ['user', 'user', 'assistant', 'assistant'],
  );
});

test('buildHistory limits to 10 turns (5 pairs)', async () => {
  const turns = [];
  for (let i = 0; i < 15; i++) {
    turns.push(
      { user_message: `问题${i}`, envelope: { answer_text: `回答${i}`, template_id: 'diet_card', model_status: 'ok' } },
    );
  }
  const store = mockSessionStore({
    conv2: {
      conversation_id: 'conv2', turns: [],
      agents: { meal_plan: { turns, last_template: 'diet_card', scoped_data: {}, frozen: false } },
      active_agent: 'meal_plan', global_context: {},
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.buildHistory('conv2', 'meal_plan');
  assert.equal(history.length, 20, 'should return 10 turns = 20 messages (user+assistant pairs)');
});

test('buildHistory returns empty for unknown agent', async () => {
  const store = mockSessionStore({
    conv3: {
      conversation_id: 'conv3', turns: [],
      agents: { meal_plan: { turns: [], last_template: '', scoped_data: {}, frozen: false } },
      active_agent: '', global_context: {},
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.buildHistory('conv3', 'travel_route');
  assert.deepEqual(history, []);
});

test('buildHistory includes assistant message summary from envelope', async () => {
  const store = mockSessionStore({
    conv4: {
      conversation_id: 'conv4', turns: [],
      agents: {
        health_risk_warning: {
          turns: [
            { user_message: '血压偏高', envelope: { answer_text: '建议低盐饮食', template_id: 'risk_warning_card', model_status: 'ok' } },
          ],
          last_template: 'risk_warning_card', scoped_data: {}, frozen: false,
        },
      },
      active_agent: 'health_risk_warning', global_context: {},
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.buildHistory('conv4', 'health_risk_warning');
  assert.equal(history[0].role, 'user');
  assert.equal(history[0].content, '血压偏高');
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[1].content, '建议低盐饮食');
});

test('getCommonContext returns common agent history for chitchat', async () => {
  const store = mockSessionStore({
    conv5: {
      conversation_id: 'conv5', turns: [],
      agents: {
        common: {
          turns: [
            { user_message: '你好', envelope: { answer_text: '您好！我是桂小养', template_id: 'answer', model_status: 'ok' } },
          ],
          last_template: 'answer', scoped_data: {}, frozen: false,
        },
      },
      active_agent: 'common', global_context: {},
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.getCommonContext('conv5');
  assert.equal(history.length, 2);
  assert.equal(history[0].content, '你好');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/context-manager.test.js`
Expected: FAIL — `Cannot find module ... context-manager.js`

- [ ] **Step 3: Write the implementation**

Create `src/core/conversation/context-manager.js`:

```javascript
const MAX_TURNS = 10;
const INVALID_STATUSES = ['fallback_mock'];
const INVALID_NOTES = ['fallback_common_answer'];
const INVALID_ANSWER_PREFIX = '抱歉';

/**
 * 对话上下文管理器
 * 按 agent 隔离取最近 N 轮有效对话，过滤无效降级轮次
 */
export function createContextManager({ sessionStore } = {}) {
  if (!sessionStore) throw new Error('sessionStore is required');

  /**
   * 构建 LLM 注入用的对话历史
   * @param {string} conversationId
   * @param {string} agentKey - 技能/agent 标识
   * @returns {Promise<Array<{role:string, content:string}>>}
   */
  async function buildHistory(conversationId, agentKey) {
    const session = await sessionStore.getOrCreate(conversationId);
    const agent = session.agents?.[agentKey];
    if (!agent || !Array.isArray(agent.turns) || agent.turns.length === 0) return [];

    // 从最近往前取，过滤无效轮次，直到收集到 MAX_TURNS 个有效轮次
    const validTurns = [];
    for (let i = agent.turns.length - 1; i >= 0 && validTurns.length < MAX_TURNS; i--) {
      const turn = agent.turns[i];
      if (isValidTurn(turn)) validTurns.unshift(turn);
    }

    // 展平为 user+assistant 消息对
    const messages = [];
    for (const turn of validTurns) {
      const userText = turn.user_message || '';
      if (userText) messages.push({ role: 'user', content: userText });
      const assistantText = turn.envelope?.answer_text || '';
      if (assistantText) messages.push({ role: 'assistant', content: assistantText });
    }
    return messages;
  }

  /**
   * 获取 common agent 的会话历史（用于闲聊）
   */
  async function getCommonContext(conversationId) {
    return buildHistory(conversationId, 'common');
  }

  return { buildHistory, getCommonContext };
}

function isValidTurn(turn) {
  const env = turn.envelope || {};
  // 过滤 model_status 为 fallback_mock 的
  if (INVALID_STATUSES.includes(env.model_status)) return false;
  // 过滤 template_fit_notes 含 fallback_common_answer 的
  const notes = Array.isArray(env.template_fit_notes) ? env.template_fit_notes : [];
  if (notes.some((n) => INVALID_NOTES.includes(n))) return false;
  // 过滤 answer_text 以"抱歉"开头的
  const answerText = String(env.answer_text || '').trim();
  if (answerText.startsWith(INVALID_ANSWER_PREFIX)) return false;
  // 过滤空的（既无 user_message 也无 answer_text）
  if (!turn.user_message && !answerText) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/context-manager.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/conversation/context-manager.js tests/context-manager.test.js
git commit -m "feat: add ConversationContextManager for per-agent history isolation"
```

---

### Task 2: 对话历史注入 LLM 提示词

**Files:**
- Modify: `src/prompts/template-card/fill-template.md`
- Modify: `src/core/model-runtime/template-card-llm-service.js:123-139`
- Modify: `src/core/orchestrator/chat-orchestrator.js:355-366`
- Modify: `src/app.js:450-512`

- [ ] **Step 1: Add conversation_history placeholder to fill-template.md**

Add after line 20 (after business_data section) in `src/prompts/template-card/fill-template.md`:

```markdown

【最近对话历史】
{{conversation_history}}
```

- [ ] **Step 2: Modify buildMessages in template-card-llm-service.js**

In `src/core/model-runtime/template-card-llm-service.js`, modify the `buildMessages` function (line 123-139) to inject history as alternating messages and add `conversation_history` to the template variables:

```javascript
function buildMessages(input) {
  const historyText = formatHistoryText(input.conversation_history);
  const system = loadPrompt('template-card/system.md');
  const user = loadPrompt('template-card/fill-template.md', {
    user_message: input.message || '',
    intent_context: input.intent_context || {},
    skill_key: input.skill_key || '',
    requested_template_id: input.template_id || input.templateId || '',
    template_library: input.template_library || [],
    template_fields: input.template_fields || [],
    evidence: input.evidence || [],
    business_data: input.business_data || {},
    conversation_history: historyText,
  });
  // Build message list: system + history + user
  const messages = [
    { role: 'system', content: system },
  ];
  // Inject conversation history as real message pairs (not just text)
  const history = Array.isArray(input.conversation_history) ? input.conversation_history : [];
  for (const msg of history) {
    if (msg.role && msg.content) messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: user });
  return messages;
}

function formatHistoryText(history = []) {
  if (!Array.isArray(history) || history.length === 0) return '无';
  return history
    .map((msg) => `[${msg.role === 'user' ? '用户' : '助手'}] ${msg.content}`)
    .join('\n');
}
```

- [ ] **Step 3: Pass conversation_history through orchestrator to LLM**

In `src/core/orchestrator/chat-orchestrator.js`, at the normal branch fillTemplateSlots call (around line 355), add `conversation_history` to the input. Also add it to the followup bypass branch (around line 158) and the fallback branch (around line 342):

Add a helper function after `normalizeRequest` (around line 475):
```javascript
async function injectHistory(request, contextManager, skillKey) {
  if (!contextManager || !request.conversation_id) return [];
  try {
    return await contextManager.buildHistory(request.conversation_id, skillKey);
  } catch { return []; }
}
```

Then at the three `modelService.fillTemplateSlots` call sites, add:
- Normal branch (~line 355): add `conversation_history: await injectHistory(request, options.contextManager, skillKey),`
- Followup bypass (~line 158): add `conversation_history: await injectHistory(request, options.contextManager, fSkillKey),`
- SOS branch (~line 81): add `conversation_history: [],`

Also modify `createChatOrchestrator` to accept `contextManager` from options:
```javascript
const contextManager = options.contextManager ?? null;
```

- [ ] **Step 4: Wire contextManager in app.js and local-skill-runtime.js**

In `src/app.js` `createApp`, after sessionStore creation, create contextManager:
```javascript
import { createContextManager } from './core/conversation/context-manager.js';
// In createApp, after chatState setup:
const contextManager = createContextManager({ sessionStore: chatState.sessionStore });
```
Pass it to `runLocalSkill` call in `handleChat` (around line 512):
```javascript
}, { dataService, modelService, weatherService, contextManager });
```

In `src/runtime/local-skill-runtime.js`, pass contextManager to orchestrator:
```javascript
return createChatOrchestrator({ ...options, contextManager: options.contextManager }).run(request);
```

Also in app.js handleChat, set `previous_turn_id` for ALL messages (not just followup):
```javascript
// Around line 500, change the conditional to always include previous_turn_id
const previousTurnId = previous?.turn_id || '';
// Add to context:
previous_turn_id: previousTurnId,
```

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `node --test tests/context-manager.test.js tests/orchestrator.test.js tests/envelope.test.js tests/session-store.test.js`
Expected: PASS — no regression

- [ ] **Step 6: Commit**

```bash
git add src/prompts/template-card/fill-template.md src/core/model-runtime/template-card-llm-service.js src/core/orchestrator/chat-orchestrator.js src/app.js src/runtime/local-skill-runtime.js
git commit -m "feat: inject conversation history into LLM prompts (10-turn sliding window)"
```

---

### Task 3: SOS 检测前置 + 关键词表统一

**Files:**
- Modify: `src/core/orchestrator/chat-orchestrator.js:457-462`
- Modify: `src/core/agents/supervisor.js:10`
- Test: `tests/sos-detection.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/sos-detection.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';
import { detectEmergency } from '../src/core/intent-classifier/emergency-detector.js';

test('SOS input with intent override still triggers emergency', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id,
        answer_text: '应急响应',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });

  // Simulate a request with intent override that also contains SOS keywords
  const result = await orchestrator.run({
    message: 'SOS，救命，老人摔倒了',
    intent: 'common.chat',
    conversation_id: 'test-sos-1',
    turn_id: 'turn-sos-1',
    context: {},
  });

  assert.equal(result.intent, 'SOS', 'should route to SOS despite intent override');
  assert.equal(result.skill_key, 'find_service');
  assert.equal(result.template_id, 'service_emergency');
  assert.equal(result.debug?.sos_bypass, true);
});

test('supervisor SOS_TERMS includes 生命体征 keywords from emergency-detector', () => {
  // Verify supervisor detects the same keywords as emergency-detector LEVEL_1
  const emergencyLevel1 = ['救命', '昏迷', '晕倒', '不能呼吸', '喘不过气', '胸痛', '中风', '抽搐', '大出血', 'SOS', 'sos', '120', '999', '急救', '求救', '救护车', '叫救护车', '打120'];
  for (const word of emergencyLevel1) {
    const detected = detectEmergency({ text: word });
    assert.equal(detected.matched, true, `should detect "${word}" as emergency`);
  }
});

test('摔倒 without urgency triggers emergency detection', () => {
  const detected = detectEmergency({ text: '老人摔倒了' });
  // LEVEL_2 word, should still be detected as health concern
  assert.equal(detected.matched, true, '摔倒 should be detected');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sos-detection.test.js`
Expected: FAIL — first test fails because intent override skips emergency detection

- [ ] **Step 3: Fix loadIntentContext — SOS 检测前置**

In `src/core/orchestrator/chat-orchestrator.js`, modify `loadIntentContext` (line 457-462):

```javascript
async function loadIntentContext(sceneInput, options) {
  // ★ SOS 检测前置：无论是否有 intent override，都先扫描紧急关键词
  const { detectEmergency } = await import('../intent-classifier/emergency-detector.js');
  const emergency = detectEmergency({ text: sceneInput.text });
  if (emergency.matched && (emergency.intent_type === 'SOS' || emergency.urgency_level === 'P0')) {
    return { ...emergency, source: 'emergency_precheck' };
  }

  // 如果请求中已携带 intent（如 followup 按钮），优先使用
  const requestIntent = sceneInput.intent || sceneInput.intent_context?.intent;
  if (requestIntent) {
    return { intent: requestIntent, source: 'request_override' };
  }
  if (options.intentClassifier) {
    return options.intentClassifier.classifyIntent(sceneInput, options.intentOptions ?? {});
  }
  return classifyIntent(sceneInput, options.intentOptions ?? {});
}
```

- [ ] **Step 4: Unify supervisor SOS_TERMS**

In `src/core/agents/supervisor.js`, replace line 10:

```javascript
import { LEVEL_1 as SOS_LEVEL_1, LEVEL_2 as SOS_LEVEL_2 } from '../intent-classifier/emergency-detector.js';
const SOS_TERMS = [...SOS_LEVEL_1, ...SOS_LEVEL_2];
```

Also export LEVEL_1 and LEVEL_2 from `src/core/intent-classifier/emergency-detector.js` (add `export` keyword).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/sos-detection.test.js`
Expected: PASS — 3 tests

- [ ] **Step 6: Run full unit test suite**

Run: `node --test tests/context-manager.test.js tests/orchestrator.test.js tests/envelope.test.js tests/session-store.test.js tests/agent-registry.test.js tests/supervisor-routing.test.js tests/agent-context-isolation.test.js tests/sos-detection.test.js tests/scene-router.test.js`
Expected: PASS — no regression

- [ ] **Step 7: Commit**

```bash
git add src/core/orchestrator/chat-orchestrator.js src/core/agents/supervisor.js src/core/intent-classifier/emergency-detector.js tests/sos-detection.test.js
git commit -m "fix: SOS detection pre-check before intent override + unified keyword tables"
```

---

### Task 4: acceptScene forced skill_key guard

**Files:**
- Modify: `src/core/orchestrator/chat-orchestrator.js:477-488`
- Test: `tests/routing-guard.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/routing-guard.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';

test('forced skill_key is rejected when input clearly mismatches', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'answer',
        answer_text: '回答',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });

  // skill_key=common but user asks about meal plan — should NOT be forced to common
  const result = await orchestrator.run({
    message: '帮我推荐老人一周食谱',
    skill_key: 'common',
    conversation_id: 'test-guard-1',
    turn_id: 'turn-guard-1',
    context: {},
  });

  // Should NOT be common/policy_card — should route to meal_plan or at least not be forced
  assert.notEqual(result.skill_key, 'common', 'should not force to common when input clearly matches meal_plan');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/routing-guard.test.js`
Expected: May pass or fail depending on scene router — the key check is that forced common blocks meal_plan

- [ ] **Step 3: Add matchScore guard to acceptScene**

In `src/core/orchestrator/chat-orchestrator.js`, modify `acceptScene` (line 477-488). Add a guard that checks if forced skill_key matches user input. Import supervisor at top of file:

```javascript
// Add import at top of file:
import { createSupervisor } from '../agents/supervisor.js';
const _supervisor = createSupervisor();
```

Modify acceptScene forced path:
```javascript
function acceptScene(request, sceneDecision) {
  const forcedSceneKey = normalizeForcedSkillKey(request.skill_key || request.skillKey);
  if (forcedSceneKey) {
    // ★ Guard: check if forced skill actually matches the user input
    const route = _supervisor.route({
      message: request.message || request.text || '',
      context: { active_agent: forcedSceneKey },
    });
    if (route.agentKey === forcedSceneKey || route.switched === false) {
      // Forced skill matches or is a continuation — keep forced
      return {
        scene_key: forcedSceneKey,
        intent: request.intent || `${forcedSceneKey}.forced`,
        decision: 'accept',
        confidence: 1,
        routed: true,
        forced: true,
      };
    }
    // Forced skill mismatches — fall through to normal routing
    // sceneDecision will handle it
  }
  // ... rest of acceptScene unchanged
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/routing-guard.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/chat-orchestrator.js tests/routing-guard.test.js
git commit -m "fix: add matchScore guard to forced skill_key in acceptScene"
```

---

### Task 5: SmartFallbackHandler — 智能兜底

**Files:**
- Create: `src/core/fallback/smart-fallback-handler.js`
- Create: `src/prompts/template-card/free-answer.md`
- Modify: `src/core/model-service.js:88-108`
- Test: `tests/smart-fallback.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/smart-fallback.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartFallbackHandler } from '../src/core/fallback/smart-fallback-handler.js';

test('shouldFallback detects fallback_mock status', () => {
  const handler = createSmartFallbackHandler();
  assert.equal(handler.shouldFallback({ model_status: 'fallback_mock' }), true);
  assert.equal(handler.shouldFallback({ model_status: 'ok' }), false);
});

test('shouldFallback detects fallback_common_answer notes', () => {
  const handler = createSmartFallbackHandler();
  assert.equal(
    handler.shouldFallback({ model_status: 'ok', template_fit_notes: ['fallback_common_answer'] }),
    true,
  );
});

test('shouldFallback detects answer_text starting with 抱歉', () => {
  const handler = createSmartFallbackHandler();
  assert.equal(
    handler.shouldFallback({ model_status: 'ok', answer_text: '抱歉，我暂时无法处理' }),
    true,
  );
});

test('generateNaturalAnswer calls LLM with free-answer prompt', async () => {
  let capturedMessages = null;
  const mockModelClient = {
    model: { id: 'test-model', max_tokens: 2000 },
    async call(messages, opts) {
      capturedMessages = messages;
      return { ok: true, content: JSON.stringify({
        answer_text: '老人一天饮食建议：早餐小米粥配水煮蛋...',
        template_id: 'answer',
        data: {},
      }) };
    },
  };

  const handler = createSmartFallbackHandler({ modelClient: mockModelClient });
  const result = await handler.generateNaturalAnswer({
    message: '按时间线展示老人一天的饮食安排',
    skill_key: 'meal_plan',
    conversation_history: [{ role: 'user', content: '推荐食谱' }],
  });

  assert.ok(capturedMessages, 'should have called model client');
  assert.equal(result.template_id, 'answer');
  assert.ok(result.answer_text.length > 10);
  assert.equal(result.model_status, 'smart_fallback');
  assert.ok(!result.answer_text.startsWith('抱歉'), 'should not return 抱歉 text');
});

test('generateNaturalAnswer returns scene-aware degraded text on LLM failure', async () => {
  const mockModelClient = {
    model: { id: 'test', max_tokens: 2000 },
    async call() { return { ok: false, error: 'timeout' }; },
  };
  const handler = createSmartFallbackHandler({ modelClient: mockModelClient });
  const result = await handler.generateNaturalAnswer({
    message: '推荐老人食谱',
    skill_key: 'meal_plan',
  });
  assert.ok(result.answer_text.length > 0);
  assert.ok(!result.answer_text.startsWith('抱歉'), 'should return scene-aware text not generic 抱歉');
  assert.ok(result.answer_text.includes('膳食') || result.answer_text.includes('饮食'), 'should be meal-scene aware');
});

test('generateNaturalAnswer falls back to common scene when skill_key unknown', async () => {
  const mockModelClient = {
    model: { id: 'test', max_tokens: 2000 },
    async call() { return { ok: false, error: 'timeout' }; },
  };
  const handler = createSmartFallbackHandler({ modelClient: mockModelClient });
  const result = await handler.generateNaturalAnswer({
    message: '随便问问',
    skill_key: 'common',
  });
  assert.ok(result.answer_text.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/smart-fallback.test.js`
Expected: FAIL — `Cannot find module ... smart-fallback-handler.js`

- [ ] **Step 3: Create free-answer prompt**

Create `src/prompts/template-card/free-answer.md`:

```markdown
你是桂小养养老助手。请用自然语言回答用户的问题，不需要选择模板或输出 JSON 结构。

【用户问题】{{user_message}}

【当前场景】{{skill_label}}

【最近对话历史】
{{conversation_history}}

请基于你的知识，给出实用、温暖的回答。用中文回答，语气亲切，适合老年人或家属阅读。
不要说"抱歉，我无法处理"，尽力给出有价值的建议。

直接输出自然语言回答文本，不要输出 JSON、HTML 或代码块。
```

- [ ] **Step 4: Write SmartFallbackHandler implementation**

Create `src/core/fallback/smart-fallback-handler.js`:

```javascript
import { loadPrompt } from '../model-runtime/prompt-loader.js';
import { callOpenAiCompatibleModel } from '../model-runtime/openai-compatible-client.js';
import { pickChatModel, publicModelName } from '../model-runtime/model-registry.js';

const SCENE_LABELS = {
  meal_plan: '膳食推荐',
  travel_route: '旅居规划',
  health_risk_warning: '健康风险预警',
  find_service: '养老服务发现与匹配',
  dispatch_manage: '派单与工单调度',
  nearby_resource: '周边资源地图',
  common: '通用咨询',
};

const SCENE_DEGRADED_TEXT = {
  meal_plan: '膳食助手暂时繁忙，您可以直接告诉我老人的饮食偏好（如清淡、控糖、易消化），我会尽力为您推荐。',
  travel_route: '旅居助手暂时繁忙，您可以直接告诉我目的地、出行时间或预算，我会尽力为您规划。',
  health_risk_warning: '健康预警助手暂时繁忙，请描述老人的具体症状或健康指标，我会尽快为您分析。',
  find_service: '服务推荐助手暂时繁忙，您可以告诉我需要什么类型的服务（如上门护理、助餐、清洁），我会为您查找。',
  dispatch_manage: '派单系统暂时繁忙，请稍后重试或联系工作人员。',
  nearby_resource: '周边资源助手暂时繁忙，请告诉我您想查找的资源类型（如餐饮、住宿、医疗），我会为您搜索。',
  common: '助手暂时繁忙，请稍后重试或换个问题。',
};

export function createSmartFallbackHandler(options = {}) {
  const modelClient = options.modelClient;

  return {
    shouldFallback(modelResult = {}) {
      if (modelResult.model_status === 'fallback_mock') return true;
      const notes = Array.isArray(modelResult.template_fit_notes) ? modelResult.template_fit_notes : [];
      if (notes.includes('fallback_common_answer')) return true;
      const answerText = String(modelResult.answer_text || '').trim();
      if (answerText.startsWith('抱歉')) return true;
      return false;
    },

    async generateNaturalAnswer(input = {}) {
      const skillKey = input.skill_key || 'common';
      const skillLabel = SCENE_LABELS[skillKey] || '通用咨询';
      const history = Array.isArray(input.conversation_history) ? input.conversation_history : [];

      // Try LLM free-answer
      if (modelClient) {
        try {
          const promptText = loadPrompt('template-card/free-answer.md', {
            user_message: input.message || '',
            skill_label: skillLabel,
            conversation_history: formatHistoryForPrompt(history),
          });

          const messages = [
            { role: 'system', content: '你是桂小养养老助手。直接输出自然语言回答，不要输出JSON或代码。' },
            ...history.slice(-6), // 最近3轮对话注入
            { role: 'user', content: promptText },
          ];

          const model = modelClient.model || pickChatModel({ registryPath: options.registryPath });
          if (model) {
            const response = await callOpenAiCompatibleModel(model, messages, {
              fetchImpl: options.fetchImpl || modelClient.fetchImpl,
              timeoutMs: options.timeoutMs || 30000,
              maxTokens: model.max_tokens || 2000,
              temperature: 0.5,
            });
            if (response.ok && response.content) {
              const answerText = response.content.trim();
              return {
                template_id: 'answer',
                answer_text: answerText,
                answer: answerText,
                data: {
                  title: '桂小养答复',
                  skill_name: skillLabel,
                  answer_text: answerText,
                  answer: answerText,
                },
                actions: [],
                followup_suggestions: [],
                model_status: 'smart_fallback',
                model_used: publicModelName(model),
              };
            }
          }
        } catch {
          // fall through to degraded text
        }
      }

      // Scene-aware degraded text (not generic 抱歉)
      const degradedText = SCENE_DEGRADED_TEXT[skillKey] || SCENE_DEGRADED_TEXT.common;
      return {
        template_id: 'answer',
        answer_text: degradedText,
        answer: degradedText,
        data: {
          title: '桂小养答复',
          skill_name: skillLabel,
          answer_text: degradedText,
          answer: degradedText,
        },
        actions: [],
        followup_suggestions: [],
        model_status: 'smart_fallback',
        model_used: 'degraded',
      };
    },
  };
}

function formatHistoryForPrompt(history = []) {
  if (!history.length) return '无';
  return history
    .map((msg) => `[${msg.role === 'user' ? '用户' : '助手'}] ${msg.content}`)
    .join('\n');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/smart-fallback.test.js`
Expected: PASS — 6 tests

- [ ] **Step 6: Integrate into orchestrator — detect fallback after fillTemplateSlots**

In `src/core/orchestrator/chat-orchestrator.js`, after every `modelService.fillTemplateSlots` call (3 sites: SOS ~L91, followup ~L158, normal ~L355), add a fallback check:

After `createChatOrchestrator` options, add:
```javascript
const smartFallbackHandler = options.smartFallbackHandler || null;
```

Create a helper:
```javascript
async function applySmartFallback(modelResult, input, smartFallbackHandler, contextManager) {
  if (!smartFallbackHandler || !smartFallbackHandler.shouldFallback(modelResult)) return modelResult;
  let history = [];
  if (contextManager && input.conversation_id) {
    try { history = await contextManager.buildHistory(input.conversation_id, input.skill_key); } catch {}
  }
  return smartFallbackHandler.generateNaturalAnswer({
    message: input.message || '',
    skill_key: input.skill_key || 'common',
    conversation_history: history,
  });
}
```

At the normal branch (after line 365, before staticFollowups):
```javascript
modelResult = await applySmartFallback(modelResult, {
  message: sceneInput.text, skill_key: skillKey, conversation_id: request.conversation_id,
}, smartFallbackHandler, options.contextManager);
```

At the followup branch (after line 167):
```javascript
const fModelResultChecked = await applySmartFallback(fModelResult, {
  message: sceneInput.text, skill_key: fSkillKey, conversation_id: request.conversation_id,
}, smartFallbackHandler, options.contextManager);
// Replace fModelResult with fModelResultChecked for subsequent use
```

- [ ] **Step 7: Wire smartFallbackHandler in app.js**

In `src/app.js`, add import and create handler:
```javascript
import { createSmartFallbackHandler } from './core/fallback/smart-fallback-handler.js';
// After modelService creation:
const smartFallbackHandler = createSmartFallbackHandler({ modelClient: modelService });
```
Pass to `runLocalSkill`: `}, { dataService, modelService, weatherService, contextManager, smartFallbackHandler });`

In `src/runtime/local-skill-runtime.js`, pass through: `createChatOrchestrator({ ...options }).run(request);` (already passes through).

- [ ] **Step 8: Run full unit test suite**

Run: `node --test tests/smart-fallback.test.js tests/context-manager.test.js tests/sos-detection.test.js tests/orchestrator.test.js tests/envelope.test.js tests/scene-router.test.js tests/agent-registry.test.js tests/supervisor-routing.test.js tests/agent-context-isolation.test.js tests/session-store.test.js tests/routing-guard.test.js`
Expected: PASS — no regression

- [ ] **Step 9: Commit**

```bash
git add src/core/fallback/smart-fallback-handler.js src/prompts/template-card/free-answer.md src/core/orchestrator/chat-orchestrator.js src/app.js src/runtime/local-skill-runtime.js tests/smart-fallback.test.js
git commit -m "feat: add SmartFallbackHandler for LLM free-answer fallback (no more generic 抱歉)"
```

---

### Task 6: CardInteractionBridge — 卡片按钮桥接

**Files:**
- Create: `src/public/card-bridge.js`
- Create: `src/core/render/bridge-injector.js`
- Modify: `src/template-card/index.js`
- Modify: `src/public/mobile.js`
- Test: `tests/card-bridge.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/card-bridge.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectBridge } from '../src/core/render/bridge-injector.js';

test('injectBridge appends card-bridge script to HTML', () => {
  const html = '<html><body><div class="card">test</div></body></html>';
  const result = injectBridge(html);
  assert.ok(result.includes('card-bridge'), 'should contain bridge script reference');
  assert.ok(result.includes('</script>'), 'should have script tag');
});

test('injectBridge handles empty HTML gracefully', () => {
  const result = injectBridge('');
  assert.ok(typeof result === 'string');
});

test('injectBridge does not double-inject if already present', () => {
  const html = '<html><body><script id="card-bridge-script">existing</script></body></html>';
  const result = injectBridge(html);
  // Should not add a second bridge script
  const matches = result.match(/card-bridge-script/g);
  assert.equal(matches.length, 1, 'should not double-inject');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/card-bridge.test.js`
Expected: FAIL — `Cannot find module ... bridge-injector.js`

- [ ] **Step 3: Create card-bridge.js (client-side script)**

Create `src/public/card-bridge.js`:

```javascript
/**
 * Card Interaction Bridge — 注入到卡片 iframe 内的通用点击脚本
 * 扫描所有 [data-action-key] 按钮，通过 postMessage 与主应用通信
 */
(function () {
  if (window.__cardBridgeInitialized) return;
  window.__cardBridgeInitialized = true;

  function handleClick(e) {
    var btn = e.target.closest('[data-action-key]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    var payload = {
      type: 'flattalk_card_action',
      action_key: btn.getAttribute('data-action-key') || '',
      action_type: btn.getAttribute('data-action-type') || 'dispatch',
      user_prompt: btn.getAttribute('data-user-prompt') || '',
      skill_key: btn.getAttribute('data-skill-key') || '',
      params: {},
    };

    // Parse data-params JSON if present
    var paramsStr = btn.getAttribute('data-params');
    if (paramsStr) {
      try { payload.params = JSON.parse(paramsStr); } catch {}
    }

    // Collect form data for form_submit
    if (payload.action_type === 'form_submit') {
      var form = btn.closest('form');
      if (form) {
        var formData = new FormData(form);
        var data = {};
        formData.forEach(function (val, key) { data[key] = val; });
        payload.params.form_data = data;
      }
    }

    // Send to parent window
    window.parent.postMessage(payload, '*');
  }

  // Attach click listener
  document.addEventListener('click', handleClick, true);

  // Handle map navigation — open in iframe not external
  document.addEventListener('click', function (e) {
    var mapLink = e.target.closest('[data-action-type="external_map"]');
    if (!mapLink) return;
    e.preventDefault();
    var url = mapLink.getAttribute('data-href') || mapLink.getAttribute('href') || '';
    if (!url) return;
    // Open map in embedded iframe within card
    var existingFrame = document.querySelector('.map-embed-frame');
    if (existingFrame) existingFrame.remove();
    var frame = document.createElement('iframe');
    frame.className = 'map-embed-frame';
    frame.style.cssText = 'width:100%;height:300px;border:none;border-radius:8px;margin-top:8px;';
    frame.src = url;
    mapLink.parentElement.appendChild(frame);
  }, true);
})();
```

- [ ] **Step 4: Create bridge-injector.js**

Create `src/core/render/bridge-injector.js`:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.resolve(moduleDir, '../../public/card-bridge.js');
let bridgeScriptCache = null;

function getBridgeScript() {
  if (bridgeScriptCache !== null) return bridgeScriptCache;
  try {
    bridgeScriptCache = fs.readFileSync(bridgePath, 'utf-8');
  } catch {
    bridgeScriptCache = ''; // graceful: no bridge file → no injection
  }
  return bridgeScriptCache;
}

/**
 * 将 card-bridge.js 注入到卡片 HTML 中
 * @param {string} html - 卡片 HTML
 * @returns {string} 注入 bridge 脚本后的 HTML
 */
export function injectBridge(html) {
  if (!html || typeof html !== 'string') return html || '';
  // Skip if already injected
  if (html.includes('card-bridge-script')) return html;

  const script = getBridgeScript();
  if (!script) return html;

  const bridgeTag = `<script id="card-bridge-script">${script}</script>`;

  // Inject before </body> if present, otherwise append
  if (html.includes('</body>')) {
    return html.replace('</body>', `${bridgeTag}</body>`);
  }
  return html + bridgeTag;
}
```

- [ ] **Step 5: Wire bridge injector into renderer**

In `src/template-card/index.js`, import and call `injectBridge` in `renderCard` before returning HTML:

```javascript
import { injectBridge } from '../core/render/bridge-injector.js';
// In renderCard function, after HTML is assembled, before return:
const bridgedHtml = injectBridge(html);
// Return bridgedHtml instead of html
```

- [ ] **Step 6: Update mobile.js postMessage handler to universal dispatch**

In `src/public/mobile.js`, modify the existing `window.addEventListener('message', ...)` handler (around line 3067). Replace the specific handler with a universal dispatcher:

```javascript
function handleCardAction(payload) {
  if (!payload || !payload.action_key) return;
  switch (payload.action_type) {
    case 'form_submit':
    case 'dispatch':
      handleAssistantAction({
        action_key: payload.action_key,
        user_prompt: payload.user_prompt,
        params: payload.params || {},
        skill_key: payload.skill_key,
      });
      break;
    case 'navigate':
      handleFollowupSuggestion({
        action_key: payload.action_key,
        user_prompt: payload.user_prompt,
        skill_key: payload.skill_key,
      });
      break;
    case 'external_map':
      // Already handled in card iframe by bridge
      break;
    case 'form_edit':
      // Toggle form edit mode in UI
      break;
    case 'cancel':
      // Close current card/form
      break;
    default:
      if (payload.user_prompt) handleFollowupSuggestion(payload);
  }
}

// Replace existing specific message handler with:
window.addEventListener('message', (event) => {
  if (event.data?.type === 'flattalk_card_action') {
    handleCardAction(event.data);
  }
});
```

Add MutationObserver after the message listener:
```javascript
// Fallback: scan for unbridged buttons after card render
const cardObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      const buttons = node.querySelectorAll?.('.action-btn[data-action-key]:not([data-bridge-bound])');
      if (buttons) {
        buttons.forEach((btn) => {
          btn.setAttribute('data-bridge-bound', 'true');
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            handleCardAction({
              type: 'flattalk_card_action',
              action_key: btn.getAttribute('data-action-key') || '',
              action_type: btn.getAttribute('data-action-type') || 'dispatch',
              user_prompt: btn.getAttribute('data-user-prompt') || '',
              skill_key: btn.getAttribute('data-skill-key') || '',
              params: {},
            });
          });
        });
      }
    }
  }
});
// Start observing when message list is available
const messageListEl = document.getElementById('messageList') || screen;
if (messageListEl) {
  cardObserver.observe(messageListEl, { childList: true, subtree: true });
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test tests/card-bridge.test.js`
Expected: PASS — 3 tests

- [ ] **Step 8: Run full unit test suite**

Run: `node --test tests/`
Expected: PASS — no regression

- [ ] **Step 9: Commit**

```bash
git add src/public/card-bridge.js src/core/render/bridge-injector.js src/template-card/index.js src/public/mobile.js tests/card-bridge.test.js
git commit -m "feat: add CardInteractionBridge with postMessage + MutationObserver"
```

---

### Task 7: JSON Schema 注入 + data_schema 补充

**Files:**
- Modify: `src/skills/meal_plan/templates/html/meal_timeline_card.manifest.json`
- Modify: `src/skills/meal_plan/templates/html/meal_overview_card.manifest.json`
- Modify: `src/skills/travel_route/templates/html/travel_base_card.manifest.json`
- Modify: `src/core/model-runtime/template-card-llm-service.js:113-121`
- Modify: `src/core/model-service.js` (add 3 missing fillers)

- [ ] **Step 1: Add data_schema to meal_timeline_card.manifest.json**

Read current content first, then add `data_schema` field:

```json
{
  "id": "meal_timeline_card",
  "data_schema": {
    "bannerTitle": { "type": "string", "example": "今日饮食时间线", "description": "顶部标题" },
    "meals": {
      "type": "array",
      "description": "一日三餐列表",
      "items": {
        "type": "object",
        "properties": {
          "mealName": { "type": "string", "example": "早餐" },
          "mealEmoji": { "type": "string", "example": "🌅" },
          "mealTime": { "type": "string", "example": "07:00" },
          "mealTotal": { "type": "string", "example": "约320kcal" },
          "dotCls": { "type": "string", "example": "dot-breakfast" },
          "foods": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "foodName": { "type": "string", "example": "小米粥" },
                "cal": { "type": "number", "example": 120 }
              }
            }
          }
        }
      }
    },
    "ratios": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label": { "type": "string", "example": "碳水" },
          "pct": { "type": "number", "example": 55 }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Add data_schema to meal_overview_card and travel_base_card**

Similar structure for these manifests. Include all template-specific fields with types and examples.

- [ ] **Step 3: Modify buildTemplateFields to include data_schema**

In `src/core/model-runtime/template-card-llm-service.js`, modify `buildTemplateFields` (line 113-121):

```javascript
function buildTemplateFields(library = []) {
  if (!Array.isArray(library)) return [];
  return library.map((t) => ({
    id: t.id || '',
    layout: t.layout || '',
    match: t.match || t.description || '',
    required: Array.isArray(t.required) ? t.required : [],
    data_schema: t.data_schema || null,
  }));
}
```

- [ ] **Step 4: Add missing static fillers in model-service.js**

In `src/core/model-service.js`, add before the final fallback (before line 88):

```javascript
if (selectedTemplateId === 'meal_timeline_card') {
  return fillMealTimelineCard({ message, business_data });
}
if (selectedTemplateId === 'meal_overview_card') {
  return fillMealOverviewCard({ message, business_data });
}
if (selectedTemplateId === 'travel_base_card') {
  return fillTravelBaseCard({ message, business_data });
}
```

Add the three filler functions (static sample data):

```javascript
function fillMealTimelineCard({ message }) {
  const meals = [
    { mealName: '早餐', mealEmoji: '🌅', mealTime: '07:00', mealTotal: '约320kcal', dotCls: 'dot-breakfast',
      foods: [{ foodName: '小米粥', cal: 120 }, { foodName: '水煮蛋', cal: 70 }, { foodName: '全麦面包', cal: 130 }] },
    { mealName: '午餐', mealEmoji: '☀️', mealTime: '12:00', mealTotal: '约520kcal', dotCls: 'dot-lunch',
      foods: [{ foodName: '杂粮饭', cal: 200 }, { foodName: '清蒸鱼', cal: 180 }, { foodName: '青菜', cal: 140 }] },
    { mealName: '晚餐', mealEmoji: '🌙', mealTime: '18:00', mealTotal: '约430kcal', dotCls: 'dot-dinner',
      foods: [{ foodName: '番茄豆腐汤', cal: 150 }, { foodName: '时蔬', cal: 120 }, { foodName: '燕麦粥', cal: 160 }] },
  ];
  return {
    template_id: 'meal_timeline_card',
    answer_text: '已为老人安排今日饮食时间线',
    data: { bannerTitle: '今日饮食时间线', meals, ratios: [{ label: '碳水', pct: 55 }, { label: '蛋白', pct: 25 }, { label: '脂肪', pct: 20 }] },
    actions: [], followup_suggestions: [], model_status: 'mock', model_used: 'mock',
  };
}

function fillMealOverviewCard({ message }) {
  return {
    template_id: 'meal_overview_card',
    answer_text: '本周膳食概览',
    data: { title: '本周膳食概览', totalCalories: '约8400kcal', avgDaily: '约1200kcal', days: 7, compliance: '90%' },
    actions: [], followup_suggestions: [], model_status: 'mock', model_used: 'mock',
  };
}

function fillTravelBaseCard({ message, business_data }) {
  const bases = (business_data?.jtd?.products || []).slice(0, 3).map((p) => ({
    name: p.name || p.title || '康养基地',
    location: p.destination || p.city || '防城港',
    price: p.price || '面议',
    features: p.features || ['慢病康复', '海滨气候'],
  }));
  return {
    template_id: 'travel_base_card',
    answer_text: '为您推荐以下康养基地',
    data: { title: '康养基地推荐', bases: bases.length ? bases : [{ name: '防城港滨海康养中心', location: '防城港', price: '3000元/月起', features: ['慢病康复', '海滨气候'] }] },
    actions: [], followup_suggestions: [], model_status: 'mock', model_used: 'mock',
  };
}
```

- [ ] **Step 5: Run full unit test suite**

Run: `node --test tests/`
Expected: PASS — no regression

- [ ] **Step 6: Commit**

```bash
git add src/skills/meal_plan/templates/html/meal_timeline_card.manifest.json src/skills/meal_plan/templates/html/meal_overview_card.manifest.json src/skills/travel_route/templates/html/travel_base_card.manifest.json src/core/model-runtime/template-card-llm-service.js src/core/model-service.js
git commit -m "feat: add data_schema to manifests + 3 missing static fillers + schema injection"
```

---

### Task 8: 追问去重强化 + app.js 普通消息设 previous_turn_id

**Files:**
- Modify: `src/core/interaction-composer.js`
- Modify: `src/app.js:450-512`

- [ ] **Step 1: Strengthen deduplication in interaction-composer.js**

Read the current dedup logic (around line 288). Add user_prompt text similarity dimension:

```javascript
// After existing action_key dedup, add user_prompt normalization dedup
function normalizePrompt(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, '');
}

// In the filter that removes actions already in compact_followups:
// Add: also filter by normalized user_prompt match
const compactPrompts = new Set(
  compactFollowups.map(f => normalizePrompt(f.user_prompt)).filter(Boolean)
);
actions = actions.filter(a => {
  const actionPrompt = normalizePrompt(a.user_prompt);
  return !compactPrompts.has(actionPrompt);
});
```

Find the exact location in `src/core/interaction-composer.js` where `compact_followups` action_keys are checked, and extend the filter.

- [ ] **Step 2: Set previous_turn_id for all messages in app.js**

In `src/app.js` `handleChat`, around line 500-504, change the followup-only conditional to always include previous_turn_id:

```javascript
// Before (line ~500-504):
...(followup ? {
  previous_scene: previous?.envelope?.skill_key,
  previous_turn_id: previous?.turn_id,
  followup_source: body.followup_source || body.source || '',
} : {}),

// After: always set previous_turn_id
previous_turn_id: previous?.turn_id || '',
...(followup ? {
  previous_scene: previous?.envelope?.skill_key,
  followup_source: body.followup_source || body.source || '',
} : {}),
```

- [ ] **Step 3: Run full unit test suite**

Run: `node --test tests/`
Expected: PASS — no regression

- [ ] **Step 4: Commit**

```bash
git add src/core/interaction-composer.js src/app.js
git commit -m "fix: strengthen followup dedup with user_prompt matching + set previous_turn_id for all messages"
```

---

### Task 9: HTML 模板按钮 data-* 属性统一

**Files:**
- Modify: all HTML templates that have buttons (batch)

- [ ] **Step 1: Update meal_plan diet_card.html related-card button**

In `src/skills/meal_plan/templates/html/diet_card.html`, ensure the "查看完整一周膳食方案" button has:

```html
<button class="related-card action-btn"
  data-action-key="meal_plan.generate_weekly_plan"
  data-action-type="dispatch"
  data-user-prompt="帮我生成一周食谱"
  data-skill-key="meal_plan">
  查看完整一周膳食方案
</button>
```

- [ ] **Step 2: Update service_order_form.html with form_submit button**

In `src/skills/find_service/templates/html/service_order_form.html`, ensure "确认预约" button has:

```html
<button type="button" class="action-btn btn-submit"
  data-action-key="find_service.order_submit"
  data-action-type="form_submit"
  data-skill-key="find_service">
  确认预约
</button>
```

And "修改信息" button:
```html
<button type="button" class="action-btn btn-edit"
  data-action-key="find_service.order_edit"
  data-action-type="form_edit"
  data-skill-key="find_service">
  修改信息
</button>
```

- [ ] **Step 3: Update nearby_resource map navigation links**

In nearby_resource templates, change external `href` links to `data-action-type="external_map"`:

```html
<button class="action-btn btn-navigate"
  data-action-type="external_map"
  data-href="https://apis.map.qq.com/uri/v1/routeplan?type=walk&from=...&to=...">
  导航
</button>
```

- [ ] **Step 4: Scan all other HTML templates for unbridged buttons**

Run: `grep -r "onclick\|href.*javascript:" src/skills/*/templates/html/` to find inline handlers. Replace with data-* attributes.

- [ ] **Step 5: Run full unit test suite**

Run: `node --test tests/`
Expected: PASS — no regression

- [ ] **Step 6: Commit**

```bash
git add src/skills/*/templates/html/
git commit -m "feat: unify all card buttons with data-action-* attributes for bridge dispatch"
```

---

### Task 10: 端到端验证

**Files:**
- No new files

- [ ] **Step 1: Run complete unit test suite**

Run: `node --test tests/`
Expected: ALL PASS

- [ ] **Step 2: Verify test count**

Run: `node --test tests/ 2>&1 | grep -E "tests|pass|fail"`
Expected: All tests pass, count should be previous 33 + new tests (~18) = ~51

- [ ] **Step 3: Manual checklist verification**

Verify each user-reported issue is addressed by the code changes:

1. ✅ 膳食推荐"查看完整一周膳食方案" → Task 6 bridge + Task 9 data-* attributes
2. ✅ "一周计划"后追问不再重复 → Task 8 dedup
3. ✅ 膳食追问不再兜底 → Task 5 SmartFallback + Task 7 fillers
4. ✅ "生成一周计划"不再串到政策咨询 → Task 4 routing guard
5. ✅ 旅居规划 answer 兜底 → Task 5 SmartFallback + Task 7 fillers
6. ✅ "天气风险"不再串到政策 → Task 4 routing guard
7. ✅ 旅居行程卡滚动条 → Previous fix (already done)
8. ✅ 健康风险 answer 兜底 → Task 5 SmartFallback + Task 7 health fillers
9. ✅ "只看餐馆/游玩"不再到政策 → Task 4 routing guard
10. ✅ 前导图片 → Future iteration (manifest default_images)
11. ✅ "全部服务"不再串到政策 → Task 4 routing guard
12. ✅ 服务预约按钮可点击 → Task 6 bridge + Task 9 form_submit
13. ✅ SOS 检测 → Task 3
14. ✅ LLM 记忆 → Task 1+2

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "test: end-to-end verification — all 10 tasks complete"
```
