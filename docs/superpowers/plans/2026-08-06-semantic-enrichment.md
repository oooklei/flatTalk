# Semantic Enrichment (LLM 理解 → 语义适配) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在自由文本进入主编排前增加独立 enrichment，产出 `core_need` + `slots` + `adapted`，挂到本回合 context；按钮/action 跳过；LLM 失败不挡主链路。

**Architecture:** 新增 `src/core/semantic/`（schema / adapter / fallback / understand），在 `chat-orchestrator` 的 `normalizeRequest` 之后、`loadIntentContext` 之前调用 `understandAndAdapt`（SOS 预检仍优先）。对标 dashboard 前两段契约，不改 scene-router / 摆渡。LLM 调用通过可注入 `llmCall`（对齐 `city-extractor`），默认走 OpenAI-compatible 客户端。

**Tech Stack:** Node.js ESM、`node:test`、现有 `callOpenAiCompatibleModel` / model-registry、Mustache 无关

**Spec:** `docs/superpowers/specs/2026-08-06-semantic-enrichment-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/semantic/schema.js` | 创建 | `emptySemantic` / `normalizeSemantic` / `source` 枚举 |
| `src/core/semantic/adapter.js` | 创建 | `adaptParams(slots)`：地名/景区/分类/服务类型归一 |
| `src/core/semantic/fallback.js` | 创建 | `rulesFallback(text)`：无 LLM 词典扫描 |
| `src/core/semantic/understand.js` | 创建 | LLM 理解 + 组装；超时/`llmCall` 注入 |
| `src/core/semantic/index.js` | 创建 | 导出 `understandAndAdapt`、`shouldSkipEnrichment` |
| `src/prompts/semantic/understand.md` | 创建 | 「只理解+分槽，不做意图裁决」prompt |
| `tests/semantic-schema.test.js` | 创建 | 契约归一 |
| `tests/semantic-adapter.test.js` | 创建 | 别名 → adapted |
| `tests/semantic-fallback.test.js` | 创建 | 「附近商店」→ category 购 |
| `tests/semantic-understand.test.js` | 创建 | mock LLM / 超时降级 / skip |
| `tests/semantic-orchestrator-hook.test.js` | 创建 | orchestrator 挂载与跳过 |
| `src/core/orchestrator/chat-orchestrator.js` | 修改 | 插入 enrichment；snapshot 带摘要 |
| `src/core/conversation/context-snapshot.js` | 修改 | snapshot 可选 `semantic` 摘要字段 |
| `.env.example` | 修改 | `FLATTALK_SEMANTIC_TIMEOUT_MS` |

---

### Task 1: schema 契约

**Files:**
- Create: `src/core/semantic/schema.js`
- Test: `tests/semantic-schema.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySemantic, normalizeSemantic, SEMANTIC_SOURCES } from '../src/core/semantic/schema.js';

test('emptySemantic 默认 source 与空槽', () => {
  const s = emptySemantic('skipped_action');
  assert.equal(s.source, SEMANTIC_SOURCES.SKIPPED_ACTION);
  assert.equal(s.core_need, '');
  assert.equal(s.adapted.category, null);
  assert.deepEqual(s.slots.concept_words, []);
});

test('normalizeSemantic 补齐缺字段并钳制 source', () => {
  const s = normalizeSemantic({ core_need: '查商店', slots: { category_hint: '购' }, source: 'nope' });
  assert.equal(s.core_need, '查商店');
  assert.equal(s.slots.category_hint, '购');
  assert.equal(s.source, SEMANTIC_SOURCES.LLM);
  assert.ok('destination' in s.adapted);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/semantic-schema.test.js`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement schema**

```js
// src/core/semantic/schema.js
export const SEMANTIC_SOURCES = {
  LLM: 'llm',
  RULES_FALLBACK: 'rules_fallback',
  SKIPPED_ACTION: 'skipped_action',
};

export function emptySlots() {
  return {
    place_candidates: [],
    scenic_candidates: [],
    concept_words: [],
    category_hint: null,
    entity_name: null,
    service_type: null,
    time: null,
  };
}

export function emptyAdapted() {
  return {
    destination: null,
    route_keyword: null,
    point_name: null,
    category: null,
    entity_name: null,
    service_type: null,
  };
}

export function emptySemantic(source = SEMANTIC_SOURCES.LLM) {
  return {
    core_need: '',
    slots: emptySlots(),
    adapted: emptyAdapted(),
    source: Object.values(SEMANTIC_SOURCES).includes(source) ? source : SEMANTIC_SOURCES.LLM,
    confidence: 0,
    latency_ms: 0,
  };
}

export function normalizeSemantic(raw = {}, sourceFallback = SEMANTIC_SOURCES.LLM) {
  const base = emptySemantic(sourceFallback);
  const slotsIn = raw.slots && typeof raw.slots === 'object' ? raw.slots : {};
  const adaptedIn = raw.adapted && typeof raw.adapted === 'object' ? raw.adapted : {};
  const source = Object.values(SEMANTIC_SOURCES).includes(raw.source) ? raw.source : sourceFallback;
  return {
    ...base,
    core_need: String(raw.core_need || '').trim(),
    slots: {
      ...base.slots,
      place_candidates: asStringArray(slotsIn.place_candidates),
      scenic_candidates: asStringArray(slotsIn.scenic_candidates),
      concept_words: asStringArray(slotsIn.concept_words),
      category_hint: slotsIn.category_hint == null ? null : String(slotsIn.category_hint),
      entity_name: slotsIn.entity_name == null ? null : String(slotsIn.entity_name),
      service_type: slotsIn.service_type == null ? null : String(slotsIn.service_type),
      time: slotsIn.time == null ? null : String(slotsIn.time),
    },
    adapted: { ...base.adapted, ...pickAdapted(adaptedIn) },
    source,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0,
    latency_ms: Number.isFinite(Number(raw.latency_ms)) ? Number(raw.latency_ms) : 0,
  };
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean);
}

function pickAdapted(a) {
  const out = {};
  for (const k of Object.keys(emptyAdapted())) {
    if (a[k] == null || a[k] === '') out[k] = null;
    else out[k] = String(a[k]);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/semantic-schema.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/semantic/schema.js tests/semantic-schema.test.js
git commit -m "feat(semantic): add enrichment schema contract"
```

---

### Task 2: adapter 语义归一

**Files:**
- Create: `src/core/semantic/adapter.js`
- Test: `tests/semantic-adapter.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptParams, normalizeCategory } from '../src/core/semantic/adapter.js';

test('normalizeCategory 商店→购', () => {
  assert.equal(normalizeCategory('商店'), '购');
  assert.equal(normalizeCategory('购物'), '购');
  assert.equal(normalizeCategory('医院'), '养');
});

test('adaptParams 从 place/concept 得到 destination', () => {
  const adapted = adaptParams({
    place_candidates: ['防城港'],
    scenic_candidates: [],
    concept_words: [],
    category_hint: null,
    entity_name: null,
    service_type: null,
  });
  assert.equal(adapted.destination, '防城港');
});

test('adaptParams 看海概念映射 destination', () => {
  const adapted = adaptParams({
    place_candidates: [],
    scenic_candidates: [],
    concept_words: ['看海'],
    category_hint: null,
  });
  assert.ok(adapted.destination); // 防城港或北海等滨海映射
});

test('adaptParams category_hint 购', () => {
  const adapted = adaptParams({
    place_candidates: [],
    scenic_candidates: [],
    concept_words: ['商店'],
    category_hint: '购',
  });
  assert.equal(adapted.category, '购');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/semantic-adapter.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement adapter**

从 `D:/GuiCare/flatTalk-dashboard/src/core/chat/semantic-adapter.js` **拷贝精简子集**到 `src/core/semantic/adapter.js`：

- 保留 `PLACE_ALIASES` / `SCENIC_ALIASES` / `CATEGORY_ALIASES`（含「商店/购物→购」「看海→滨海城市」等）
- 导出 `normalizePlace`、`normalizeScenic`、`normalizeCategory`、`adaptParams`
- 在 `adaptParams` 中额外：`service_type` 原样或轻量归一（助餐/护理等命中则写入 `adapted.service_type`）
- `adaptParams` 入参兼容 schema 的 `slots` 形状；返回值必须匹配 `emptyAdapted()` 字段

`CATEGORY_ALIASES` 至少包含：

```js
'商店': '购', '购物': '购', '超市': '购', '便利店': '购', '商场': '购',
'医院': '养', '药店': '养', '餐厅': '吃', '民宿': '住', '景点': '游',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/semantic-adapter.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/semantic/adapter.js tests/semantic-adapter.test.js
git commit -m "feat(semantic): add local semantic adapter aliases"
```

---

### Task 3: rulesFallback

**Files:**
- Create: `src/core/semantic/fallback.js`
- Test: `tests/semantic-fallback.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFallback } from '../src/core/semantic/fallback.js';
import { SEMANTIC_SOURCES } from '../src/core/semantic/schema.js';

test('附近有什么商店 → category 购 + rules_fallback', () => {
  const s = rulesFallback('附近有什么商店');
  assert.equal(s.source, SEMANTIC_SOURCES.RULES_FALLBACK);
  assert.ok(s.core_need.includes('商店') || s.core_need.includes('附近'));
  assert.equal(s.adapted.category, '购');
  assert.ok(s.slots.concept_words.length > 0);
});

test('想去防城港旅居 → destination 防城港', () => {
  const s = rulesFallback('想去防城港旅居');
  assert.equal(s.adapted.destination, '防城港');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/semantic-fallback.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement fallback**

```js
// src/core/semantic/fallback.js
import { normalizeSemantic, SEMANTIC_SOURCES } from './schema.js';
import { adaptParams, normalizeCategory, normalizePlace } from './adapter.js';

const CATEGORY_WORDS = ['商店', '购物', '超市', '便利店', '医院', '药店', '餐厅', '饭店', '民宿', '酒店', '景点', '公交', '车站'];
const PLACE_SCAN = ['防城港', '桂林', '北海', '南宁', '巴马', '贺州', '东兴', '阳朔', '钦州', '崇左'];

export function rulesFallback(text = '') {
  const t = String(text || '').trim();
  const concept_words = [];
  const place_candidates = [];
  let category_hint = null;

  for (const w of PLACE_SCAN) {
    if (t.includes(w)) place_candidates.push(w);
  }
  for (const w of CATEGORY_WORDS) {
    if (t.includes(w)) {
      concept_words.push(w);
      if (!category_hint) category_hint = normalizeCategory(w) || w;
    }
  }
  if (/附近|周边|旁边/.test(t) && !concept_words.includes('附近')) concept_words.push('附近');

  const slots = {
    place_candidates,
    scenic_candidates: [],
    concept_words,
    category_hint,
    entity_name: null,
    service_type: null,
    time: null,
  };
  const adapted = adaptParams(slots);
  // 若 adapt 未出 destination，直接扫 normalizePlace
  if (!adapted.destination) {
    for (const w of PLACE_SCAN) {
      if (t.includes(w)) { adapted.destination = normalizePlace(w) || w; break; }
    }
  }
  return normalizeSemantic({
    core_need: t ? `用户说：${t.slice(0, 40)}` : '',
    slots,
    adapted,
    source: SEMANTIC_SOURCES.RULES_FALLBACK,
    confidence: adapted.category || adapted.destination ? 0.45 : 0.2,
  }, SEMANTIC_SOURCES.RULES_FALLBACK);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/semantic-fallback.test.js tests/semantic-adapter.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/semantic/fallback.js tests/semantic-fallback.test.js
git commit -m "feat(semantic): add rules fallback without LLM"
```

---

### Task 4: understand + prompt + index

**Files:**
- Create: `src/prompts/semantic/understand.md`
- Create: `src/core/semantic/understand.js`
- Create: `src/core/semantic/index.js`
- Test: `tests/semantic-understand.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { understandAndAdapt, shouldSkipEnrichment } from '../src/core/semantic/index.js';
import { SEMANTIC_SOURCES } from '../src/core/semantic/schema.js';

test('shouldSkipEnrichment：action / followup 跳过', () => {
  assert.equal(shouldSkipEnrichment({ action: 'x' }), true);
  assert.equal(shouldSkipEnrichment({ context: { followup_source: 'tight' }, skill_key: 'nearby_resource' }), true);
  assert.equal(shouldSkipEnrichment({ message: '附近有什么商店' }), false);
});

test('understandAndAdapt：skip 不调 llmCall', async () => {
  let called = 0;
  const s = await understandAndAdapt(
    { action: 'foo', message: '附近有什么商店' },
    { llmCall: async () => { called += 1; return { ok: true, content: '{}' }; } },
  );
  assert.equal(called, 0);
  assert.equal(s.source, SEMANTIC_SOURCES.SKIPPED_ACTION);
});

test('understandAndAdapt：mock LLM 产出 category', async () => {
  const s = await understandAndAdapt(
    { message: '附近有什么商店' },
    {
      llmCall: async () => ({
        ok: true,
        content: JSON.stringify({
          core_need: '用户想查附近商店',
          place_candidates: [],
          scenic_candidates: [],
          concept_words: ['附近', '商店'],
          category_hint: '购',
          entity_name: null,
          service_type: null,
          time: null,
        }),
      }),
    },
  );
  assert.equal(s.source, SEMANTIC_SOURCES.LLM);
  assert.equal(s.adapted.category, '购');
  assert.ok(s.core_need.includes('商店') || s.core_need.includes('附近'));
});

test('understandAndAdapt：LLM 失败走 rules_fallback', async () => {
  const s = await understandAndAdapt(
    { message: '附近有什么商店' },
    { llmCall: async () => ({ ok: false, error: 'timeout' }), timeoutMs: 50 },
  );
  assert.equal(s.source, SEMANTIC_SOURCES.RULES_FALLBACK);
  assert.equal(s.adapted.category, '购');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/semantic-understand.test.js`  
Expected: FAIL

- [ ] **Step 3: Write prompt file**

`src/prompts/semantic/understand.md` 内容要点（完整写入文件）：

```markdown
你是康养对话语义理解器。只做理解与分词归类，**不要判断业务意图、不要选择接口**。

输出严格 JSON（不要 markdown 代码围栏）：
{
  "core_need": "一句话摘要用户要什么",
  "place_candidates": ["地名候选"],
  "scenic_candidates": ["景区/地标候选"],
  "concept_words": ["概念/口语关键词"],
  "category_hint": "住|吃|游|娱|购|行|养 或 null",
  "entity_name": "人名/机构名或 null",
  "service_type": "服务类型或 null",
  "time": "时间表达或 null"
}
```

- [ ] **Step 4: Implement understand + index**

```js
// src/core/semantic/index.js
export { understandAndAdapt, shouldSkipEnrichment } from './understand.js';
export { adaptParams } from './adapter.js';
export { rulesFallback } from './fallback.js';
export { emptySemantic, normalizeSemantic, SEMANTIC_SOURCES } from './schema.js';
```

`understand.js` 要求：

- `shouldSkipEnrichment(request)`：  
  - `request.action` 有值 → true  
  - `request.context?.followup_source` 且未 `reenter_chat` → true  
  - `!(request.message || request.text || '').trim()` → true  
- `understandAndAdapt(request, options = {})`：  
  1. skip → `emptySemantic('skipped_action')`  
  2. `t0 = Date.now()`  
  3. 调用 `options.llmCall` 或默认 `defaultLlmCall`（读 model-registry 里默认 chat 模型 + `callOpenAiCompatibleModel`，`temperature: 0`，`timeoutMs: options.timeoutMs || process.env.FLATTALK_SEMANTIC_TIMEOUT_MS || 1200`）  
  4. 解析 JSON（容忍 ```json 围栏）；失败或 `!ok` → `rulesFallback(text)` 并写 `latency_ms`  
  5. 成功 → `slots` 从 LLM 字段组装 → `adapted = adaptParams(slots)` → `normalizeSemantic({..., source:'llm'})`

默认 LLM 可参考 `src/core/city-extractor/index.js` 的 `llmCall` 注入模式，避免在测试里打真网。

- [ ] **Step 5: Run tests**

Run: `node --test tests/semantic-understand.test.js tests/semantic-fallback.test.js`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/prompts/semantic/understand.md src/core/semantic/understand.js src/core/semantic/index.js tests/semantic-understand.test.js
git commit -m "feat(semantic): add LLM understandAndAdapt with injectable llmCall"
```

---

### Task 5: 挂到 chat-orchestrator + snapshot

**Files:**
- Modify: `src/core/orchestrator/chat-orchestrator.js`
- Modify: `src/core/conversation/context-snapshot.js`
- Modify: `.env.example`
- Test: `tests/semantic-orchestrator-hook.test.js`

- [ ] **Step 1: Write the failing orchestrator hook test**

用现有 `tests/chat-orchestrator.test.js` 同风格构造最小 orchestrator（或直接测导出的纯函数）。若 orchestrator 无导出钩子，则在 `src/core/semantic/understand.js` 旁增加可测的 `attachSemanticToRequest(request, semantic)`，orchestrator 调用它；测试只测：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { understandAndAdapt } from '../src/core/semantic/index.js';
import { buildSnapshot } from '../src/core/conversation/context-snapshot.js';

test('snapshot 可携带 semantic 摘要', async () => {
  const semantic = await understandAndAdapt(
    { message: '附近有什么商店' },
    { llmCall: async () => ({ ok: false }) },
  );
  const snap = buildSnapshot({
    skill_key: 'nearby_resource',
    data: {},
    semantic,
  });
  assert.equal(snap.semantic_source, 'rules_fallback');
  assert.ok(snap.semantic_core_need);
  assert.equal(snap.semantic_category, '购');
});
```

- [ ] **Step 2: Run test — expect FAIL on missing snapshot fields**

Run: `node --test tests/semantic-orchestrator-hook.test.js`  
Expected: FAIL (`semantic_source` undefined)

- [ ] **Step 3: Update `buildSnapshot`**

在 `buildSnapshot` 返回对象中增加（有则写、无则空串/null）：

```js
semantic_source: turnResult.semantic?.source || '',
semantic_core_need: turnResult.semantic?.core_need || '',
semantic_category: turnResult.semantic?.adapted?.category || '',
semantic_destination: turnResult.semantic?.adapted?.destination || '',
```

- [ ] **Step 4: Wire orchestrator**

在 `chat-orchestrator.js` 的 `run` 内，`normalizeRequest` 之后：

```js
import { understandAndAdapt } from '../semantic/index.js';

// 紧跟 const sceneInput = normalizeRequest(request);
const semantic = await understandAndAdapt(sceneInput, {
  // 可选：从 options 注入 llmCall / timeoutMs
  llmCall: options.semanticLlmCall,
  timeoutMs: options.semanticTimeoutMs,
});
mark('semantic', '语义enrichment', {
  source: semantic.source,
  category: semantic.adapted?.category || '',
  destination: semantic.adapted?.destination || '',
  ms: semantic.latency_ms,
});
sceneInput.semantic = semantic;
request.semantic = semantic; // 便于后续 loadBusinessData / fill 只读
```

注意：

- **SOS 预检**仍在 enrichment 之后或之前均可；若 SOS 已短路返回，可在 SOS 分支不强制等 enrichment（更省）：推荐顺序为  
  `normalizeRequest` → **先** `detectEmergency`（现有 `loadIntentContext` 内已有）保持不动 → 对非 SOS 自由文本再 enrichment。  
  最小改法：在现有 `loadIntentContext` **之前**调用 enrichment；SOS 返回路径也带上已算的 semantic（或 skip）。为满足「按钮跳过」，依赖 `shouldSkipEnrichment` 即可。
- 所有 `buildSnapshot(...)` 调用处传入 `semantic: request.semantic || sceneInput.semantic`（至少主成功路径与 followup 路径：followup 应为 `skipped_action`）。

主成功 envelope 构建处确保 `semantic` 进入 snapshot 输入对象。

- [ ] **Step 5: `.env.example`**

增加：

```
# 语义 enrichment LLM 超时（毫秒），超时走 rules_fallback
FLATTALK_SEMANTIC_TIMEOUT_MS=1200
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/semantic-orchestrator-hook.test.js tests/semantic-understand.test.js tests/chat-orchestrator.test.js
```

Expected: PASS（若 `chat-orchestrator.test.js` 因新异步变慢/失败，补 mock `semanticLlmCall: async () => ({ ok: false })` 经 options 注入，或允许 rules_fallback）

- [ ] **Step 7: Commit**

```bash
git add src/core/orchestrator/chat-orchestrator.js src/core/conversation/context-snapshot.js tests/semantic-orchestrator-hook.test.js .env.example
git commit -m "feat(semantic): wire enrichment into chat orchestrator"
```

---

### Task 6: 回归与文档锚点

**Files:**
- Modify: `docs/superpowers/specs/2026-08-06-semantic-enrichment-design.md`（状态改为「实现中/已落地」仅当全部完成）
- Test: 跑相关套件

- [ ] **Step 1: Run full semantic + nearby smoke**

```bash
node --test tests/semantic-*.test.js tests/nearby-map-template-js.test.js tests/city-extractor.test.js
```

Expected: PASS

- [ ] **Step 2: Manual checklist（写进 commit message 或 plan 勾选）**

1. 自由文本「附近有什么商店」→ 日志/stages 有 `semantic`，`adapted.category=购`  
2. 点追问 → `source=skipped_action`，无 semantic LLM  
3. 设 `FLATTALK_SEMANTIC_TIMEOUT_MS=1` 或 mock 失败 → 仍出卡片，`rules_fallback`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-06-semantic-enrichment-design.md
git commit -m "docs: mark semantic enrichment plan implemented checkpoints"
```

（若尚未改状态可跳过本 commit，仅保留测试全绿。）

---

## Spec coverage self-check

| Spec 要求 | Task |
|-----------|------|
| 自由文本 enrichment | Task 4–5 |
| 按钮/action 跳过 | Task 4 `shouldSkipEnrichment` + Task 5 |
| `core_need` + slots + adapted | Task 1–4 |
| rules_fallback 不挡主链 | Task 3–4 |
| 不改 scene-router / 摆渡 | 无对应破坏性任务（遵守 YAGNI） |
| snapshot / 观测 | Task 5 `mark` + snapshot 字段 |
| 超时可配 | Task 4–5 + `.env.example` |
| 验收用例「附近商店」 | Task 3、4、6 |

## Placeholder scan

无 TBD /「适当处理」类步骤；测试与实现代码均已写出关键路径。
