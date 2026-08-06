# LLM 理解 → 语义适配（编排前置 enrichment）设计

**日期：** 2026-08-06  
**状态：** 已落地  
**对标：** `flatTalk-dashboard` 三阶段 NLU 的前两段（理解 + 语义适配）；**不**照搬意图匹配 / 会话临时查询 / 接口摆渡整包。

**实现说明：** Tasks 1–5 已合入 `feat/semantic-enrichment`：`src/core/semantic/`（schema / adapter / fallback / understand）、`chat-orchestrator` 编排挂载、`context-snapshot` 摘要字段，以及可配置超时 `FLATTALK_SEMANTIC_TIMEOUT_MS`（见 `.env.example`）。

## 1. 问题与目标

用户输入后，flatTalk 现有链路以意图分类、场景关键词评分、填槽为主，缺少显式的「关键要素摘要 + 接口可消费槽位」契约层。口语（如「看海」「附近商店」）到 API/检索字段的归一化偏弱，下游只能各自猜。

**目标：** 在自由文本进入主编排前，增加独立 enrichment：

1. LLM 理解 → `core_need` + 原始 `slots`
2. 本地语义适配 → `adapted`（规范可消费槽位）

产出挂到本回合 context，供后续分拣/摆渡**可选消费**；本期不改造下游架构。

## 2. 已确认约束

| 项 | 决定 |
|----|------|
| 范围 | 仅 **LLM 理解 → 语义适配**；与下游解耦 |
| 触发 | **仅自由文本**；追问按钮 / `action` 短路跳过 |
| 落地形态 | 编排前置独立模块（方案 1），不并进 `classifyIntent`，暂不抽跨仓 shared |
| 会话 | 不新建 dashboard 式临时查询引擎；本回合挂载即可（可写入 snapshot 便于调试） |

## 3. 架构：插入点

```
normalizeRequest(request)
  │
  ├─ 若为 followup 按钮 / action → semantic = { source: 'skipped_action', ...空槽 }
  │
  └─ 若为自由文本 → semantic = await understandAndAdapt(text, hints?)
        │
        ├─ Stage A: LLM 理解（结构化 JSON）
        └─ Stage B: adaptParams（别名表 / 词典归一）
  │
  ▼
loadIntentContext / scene-router / fillTemplateSlots / render …
  （只读 context.semantic，不强制改现有决策树）
```

建议挂载位置：`src/core/orchestrator/chat-orchestrator.js` 在 `loadIntentContext` 之前（SOS 紧急预检仍可最先短路；命中 SOS 后 enrichment 可跳过或仅规则摘要）。

### 模块边界

| 单元 | 职责 | 依赖 |
|------|------|------|
| `understandAndAdapt(text, hints)` | 编排入口，组装 semantic | LLM client、adapter |
| LLM understand prompt | 只理解+分槽，**不做意图裁决** | 模型运行时 |
| `adaptParams(slots)` | 口语/别名 → 接口字段 | 本地别名表（可先从 dashboard 拷贝旅居/周边子集） |
| `rulesFallback(text)` | LLM 失败时的词典扫描 | 词表 |

## 4. 数据契约

本回合对象（建议字段名 `context.semantic` 或 `request.semantic`）：

```json
{
  "core_need": "用户想查附近有什么商店",
  "slots": {
    "place_candidates": [],
    "scenic_candidates": [],
    "concept_words": ["附近", "商店"],
    "category_hint": "购",
    "entity_name": null,
    "service_type": null,
    "time": null
  },
  "adapted": {
    "destination": null,
    "route_keyword": null,
    "point_name": null,
    "category": "购",
    "entity_name": null,
    "service_type": null
  },
  "source": "llm",
  "confidence": 0.82,
  "latency_ms": 340
}
```

`source` 枚举：`llm` | `rules_fallback` | `skipped_action`。

**约定：**

- `core_need`：一句话关键要素摘要（日志 / 可解释 / 人工抽检）
- `slots`：LLM 原始桶（可含口语）
- `adapted`：归一后供接口/检索消费的字段
- 下游未接线时系统行为与今天一致；接线后优先读 `adapted`

首期 `adapted` 字段以旅居/周边/找服务常用槽为主；健康、膳食等可后续扩展同构字段，不必一次做全技能。

## 5. 降级与超时

- LLM 超时或失败 → `rules_fallback`，**不阻塞**主对话
- 硬超时可配置，建议默认 ≤ 800ms～1.2s
- 失败时仍挂载 semantic 空壳（空槽 + `source`），编排继续
- 按钮 / action：零 LLM，直接 `skipped_action`

## 6. 非目标（本期不做）

- 不重写 `scene-router` / agent 分拣逻辑
- 不建 session 临时查询 / 消歧状态机（dashboard `pending_clarification` 整套）
- 不强制 HTTP 自调用或 action-executor 式摆渡
- 不抽 `flatTalk` / `flatTalk-dashboard` 跨仓 shared 包（别名表可后置对齐）
- 不把意图分类与槽提取并成同一次 LLM 调用

## 7. 测试与验收

1. 自由文本「附近有什么商店」→ 存在 `core_need`，`adapted.category` 为购（或等价映射） — **已通过**（`semantic-fallback.test.js`、`semantic-understand.test.js`、orchestrator hook）
2. 点击追问按钮 → enrichment 跳过，无额外 LLM 调用 — **已通过**（`shouldSkipEnrichment` + `semantic-orchestrator-hook.test.js`，`source=skipped_action`）
3. 模拟 LLM 失败 → 对话仍返回，`source=rules_fallback` — **已通过**（`semantic-understand.test.js`、`semantic-fallback.test.js`）
4. 回归：既有场景路由与模板渲染在未消费 semantic 时行为不变 — **已通过**（semantic 全套件 29 用例 + `city-extractor.test.js` 回归；`nearby-map-template-js.test.js` 本分支未包含，未跑）

**2026-08-06 回归：** `node --test tests/semantic-*.test.js tests/city-extractor.test.js` → 29 pass / 0 fail。

## 8. 实现提示（供 writing-plans）

- 新目录建议：`src/core/semantic/`（`understand.js`、`adapter.js`、`fallback.js`、`schema.js`）
- Prompt 放 `src/prompts/semantic/understand.md`（对齐 dashboard「只理解不分意图」原则）
- 在 envelope / `context_snapshot` 中可选带上 `semantic` 摘要便于 admin 日志抽检
- 观测：打点 `latency_ms`、`source`、是否超时

## 9. 决策记录

- 对标 dashboard 的价值在**契约**（摘要 + 可消费槽），不是整条三阶段网关照搬
- 选方案 1（编排前置）而非并进意图分类 / 跨仓抽包，是为了边界清晰、可单独降级与评测
