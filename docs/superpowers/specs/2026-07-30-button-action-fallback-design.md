# 按钮动作通用兜底函数 — 设计文档

- **日期**：2026-07-30
- **状态**：设计已确认，待复审后进入实施计划
- **作者**：AI 助手（基于 brainstorming 流程）

## 1. 背景与目标

当前系统中，按钮动作（行程卡"查看天气风险"、手机端 flowup 动作栏/建议栏按钮）触发后，后端 `chat-orchestrator.run` 只针对个别 `action_key` 写了硬编码特例分支（如 `travel_route.check_weather_risk`）。每新增一个按钮/动作，都要在 orchestrator 里新写分支代码，维护成本高、易遗漏。

**目标**：创建一个**统一的按钮动作兜底函数**。当某个按钮动作**未被特例覆盖**时，依托「构造结构化提示词」让大模型自主执行该动作并合成答复，回到页面渲染即结束。

## 2. 覆盖范围（已确认：C）

兜底入口统一覆盖两类按钮：

1. **内容卡片内的按钮**：如行程卡里的 postMessage 按钮（`travel_itinerary_card.html` 内 `<button>` → `window.parent.postMessage` → `mobile.js` 桥接 → `/api/chat/action`）。
2. **flowup 按钮**：手机端原生
   - 动作栏（`appendAssistantActions` / `handleAssistantAction`，`isSupportedMobileAction` 注册的动作）
   - 建议栏（`appendFollowupSuggestions` / `handleFollowupSuggestion`，模型生成的建议标签）

两类按钮都已汇聚到 `action-dispatcher → runSkill → chat-orchestrator.run`，且都携带 `context.action_key`，因此兜底入口天然统一在 orchestrator，无需改动前端汇聚逻辑。

## 3. 定位（已确认：B — 仅作 fallback）

- **已有特例**（`travel_route.check_weather_risk` 等硬编码分支）继续走特例，保证质量。
- **未被特例覆盖**的按钮动作，才走本通用兜底流程。
- 维护一个**特例白名单**集合（`SPECIAL_CASE_ACTION_KEYS`），兜底分支先判断是否在白名单内，命中则跳过兜底。

## 4. 资源清单（已确认：A — 复用 registry 结构，新建进 src 运行时）

### 4.1 文件

新建 `src/core/actions/action-resource-map.json`，字段**复用现有 `assets/source-copies/data/action-registry.json` 的结构**（`action_key` / `label` / `skill_key` / `target` / `description` / `when` / `params_schema` / `next_template_id`），并**新增两项**缺失元数据：

- `endpoint`：接口地址（真实 HTTP 地址；纯内部能力写如「bff 内部能力，无外部 HTTP 地址」）。
- `param_sources`：每个参数的**取值来源**（如 `{"city":"从上下文 destination 抽取"}`）。

**`target` 取值与资源处理方式**：

- `"knowledge"`：**本地/远程知识库**。运行时知识库为 `data/knowledge.json`（文档分块）+ `data/embeds.json`（向量，供 `ragService.retrieveKnowledge` 检索）；远程为 `app.js` 的 `knowledgeData.remote` collections（如「膳食知识库」「广西养老办事指引知识库」「广西养老政策知识库」）。兜底分支对 `target:"knowledge"` 的动作，由 orchestrator 侧 `ragService.retrieveKnowledge({ skill_key, query })` **检索并注入 `evidence`**，模型基于证据推理，不要求模型自行发 HTTP 请求（当前 LLM 通道 `openai-compatible-client.js` 不支持 function calling）。
- `"bff"` / `"business_system"` / 真实 HTTP 地址：接口类资源，处理约定见 §6.2。

### 4.2 示例

```jsonc
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

### 4.3 初始登记动作（已确认 b）

- `travel_route` 非特例动作样板：`calculate_budget`、`check_accessibility`、`check_policy_subsidy`（其余 `travel_route.*` 可后续补）。
- `meal_plan` 样板：`check_risk`（其余可后续补）。
- 仅登记「需要兜底」的动作；特例动作（`check_weather_risk`）不在此表（走白名单）。

## 5. 兜底函数 `buildFallbackActionPrompt(action, context, resourceMap)`

纯函数（无副作用、易单测），输出**五要素结构化提示词**。输入 `action` 含 `action_key`/`label`/`skill_key`/`params`，`context` 为对话上下文（目的地、人数、天数等），`resourceMap` 为第 4 节清单。

### 5.1 提示词模板

```
你是养老助手「桂小养」大模型，负责执行用户点击的按钮动作并合成面向老人家属的答复。

【谁】你（桂小养大模型）。
【做什么】按钮标签：{label}；说明：{description}。
【怎么做】
- 执行时间：立刻（用户点击即触发）。
- 使用资源：{target} / {endpoint}。
- 接口地址：{endpoint}。
- 参数个数：{N} 个。
- 第1个参数：{p1}（含义：{schema.p1}）；取值：{param_sources.p1}。
- 第2个参数：{p2}（含义：{schema.p2}）；取值：{param_sources.p2}。
- 参数取值原则：优先从下方上下文已有信息抽取；缺失时向用户追问，不得臆造。
【有什么资源】本技能（{skill_key}）可用资源清单：
  {同 skill_key 的所有 resourceMap 条目，列出 target/endpoint/说明}
【每个动作的资源】本动作（{action_key}）专用资源：{endpoint} + 上述参数。

当前上下文：{context 摘要，如目的地/人数/天数/老人慢病}

请基于以上资源与上下文执行该动作：
- 若【有什么资源】含「知识库」类（target=knowledge），已为你注入相关证据（evidence），请基于证据推理作答；
- 若含接口类资源（target=bff/business_system/HTTP），请依据接口地址与参数说明，结合上下文给出可执行方案与要点（真实取数约定见 §6.2，当前不要求你直接发起 HTTP 请求）；
最终以结构化 JSON 返回，匹配模板 {next_template_id} 的字段结构
（含 title、summary、要点列表、风险提示、后续建议）。
```

五要素对应：**谁**（大模型）、**做什么**（label）、**怎么做**（时间+接口+地址+参数个数+各参数含义与来源）、**有什么资源**（同 skill 资源清单）、**每个动作的资源**（该 action 的 endpoint+参数）。

## 6. 兜底分支执行（调大模型 + 渲染）

在 `chat-orchestrator.run` 新增兜底分支（位于现有 `weatherActionCity` 特例判断之后、`else` 之前）：

1. 取 `actionKey = request.context.action_key`。
2. 若在 `SPECIAL_CASE_ACTION_KEYS`（特例白名单）内 → 跳过兜底，沿用现有逻辑。
3. 否则：`resourceMap` 查 `actionKey`（查不到仍兜底，仅缺接口细节）。
4. **证据注入（知识库类）**：若命中条目的 `target === 'knowledge'`，先 `ragService.retrieveKnowledge({ skill_key, query: label })` 取 `evidence`；否则 `evidence` 为空（接口类见 §6.2）。
5. `buildFallbackActionPrompt(...)` 生成 `fallbackPrompt`（提示词含 §4.1 的资源清单与 §4 步骤4 的 evidence 摘要）。
6. 调 `modelService` 的**真实 LLM 通道**：新增 `modelService.fillFallback({ prompt, template_id, skill_key, business_data, evidence })`，它**强制绕过 `shouldUseDeterministicTemplate`**（不走本地确定性模板），用 `fallbackPrompt` 作为 user message 调 `callOpenAiCompatibleModel`，让模型真正合成。
7. `template_id` 取 `resourceMap[actionKey].next_template_id`（存在且模板已注册则用之；否则回退通用 `answer` 卡片——**已确认 a：兜底渲染匹配原 next_template_id 卡片**）。
8. `renderTemplateCardResult` 渲染 → 返回 envelope → 页面展示，流程结束。

### 6.2 接口类动作（target=bff/business_system/HTTP）的真实取数约定

当前 LLM 通道 `openai-compatible-client.js` **不支持 function calling**，模型无法自行发起外部 HTTP 请求。因此：

- **本次兜底范围**：对接口类动作，模型仅依据提示词中声明的 `endpoint` + `params_schema` + `param_sources`，结合上下文与已注入知识库证据，产出「可执行方案 / 要点 / 调用建议」，而非真实取数。提示词已明确告知模型「当前不要求你直接发起 HTTP 请求」。
- **预留扩展点**：若需真正取数，有两种落地路径（不在本次实施范围，列为后续增强）：
  1. **orchestrator 侧通用预调用**：对只读 GET 接口，由兜底分支先用从上下文抽取的参数发起请求（需 `action-resource-map.json` 标注 `method`/`authEnv`/`responseShape`），把返回数据塞入提示词后再调 LLM。
  2. **接入工具调用**：扩展 `openai-compatible-client.js` 支持 `tools`，让模型自主选择调用接口。
- 无论哪种路径，资源元数据都已在 `action-resource-map.json` 的 `endpoint`/`params_schema`/`param_sources` 中备齐，切换成本低。

> 注：`shouldUseDeterministicTemplate` 对 `travel_route`/`meal_plan` 等默认走本地模板；兜底分支必须强制 LLM，故 `fillFallback` 不调用 `fillTemplateSlots` 的确定性短路，而是直接构造 messages 调 LLM 并复用 `sanitizeShape`。

## 7. 错误处理 / 降级

- **LLM 不可用**（mock 模式 / 无可用模型）：`fillFallback` 返回基于 `resourceMap` 资源信息生成的**可读说明文本**（说明「该动作会调用 XX 接口、需要 XX 参数」），不崩。
- **action 不在 resourceMap**：仍生成通用兜底提示词（缺接口细节），交给模型用知识库推理。
- **接口调用失败 / 参数缺失**：提示词已声明「缺失时追问」，模型返回追问式答复。
- **next_template_id 模板不存在**：渲染回退通用 `answer` 卡片（Markdown）。

## 8. 文件改动清单

| 文件 | 改动 |
| --- | --- |
| `src/core/actions/action-resource-map.json` | 新建：按钮动作→接口/参数资源清单（含 `endpoint` + `param_sources`） |
| `src/core/actions/fallback-prompt-builder.js` | 新建：`buildFallbackActionPrompt`（五要素提示词纯函数）+ 特例白名单 + resourceMap 加载 |
| `src/core/model-runtime/template-card-llm-service.js` | 新增 `fillFallback`（强制 LLM、接收 prompt 与 target template_id） |
| `src/core/orchestrator/chat-orchestrator.js` | run() 新增兜底分支：查白名单→查 resourceMap→buildFallbackActionPrompt→modelService.fillFallback→渲染 |
| `src/app.js` | 将 `fallbackPromptBuilder` / `actionResourceMap` 注入 orchestrator 选项（与 weatherService 同机制） |

前端两类按钮**无需改动**（已汇聚到 orchestrator）；`mobile.js` 的 postMessage 桥接与 `handleAssistantAction` 已能触发带 `action_key` 的请求。

## 9. 测试

- **单测 `buildFallbackActionPrompt`**：五要素齐全；参数计数正确（N 个）；`param_sources` 正确注入到第1/第2参数；`next_template_id` 正确透传；无 resourceMap 条目时不崩。
- **单测 resourceMap 加载/查表**：命中、缺失 action 降级、JSON 合法。
- **单测 `fillFallback`**：mock 模式下返回可读说明；非 mock 调 LLM 并 `sanitizeShape`；target template_id 不存在时回退 answer。
- **集成**：构造一个未特例化的 `travel_route.calculate_budget` 按钮动作（经 `/api/chat/action`），验证走兜底分支、匹配 `route_card` 渲染、返回 envelope。

## 10. 实施顺序（概要）

1. 建 `action-resource-map.json`（含初始登记动作）。
2. 建 `fallback-prompt-builder.js`（纯函数 + 白名单 + 加载器）。
3. 在 `template-card-llm-service.js` 加 `fillFallback`。
4. orchestrator 接兜底分支。
5. app.js 注入。
6. 单测 + 集成测试 + lint。

---

## 自审（spec self-review）

- **占位符扫描**：无 TBD/TODO；示例 JSON 为说明性，非未完成。
- **内部一致性**：§3 白名单与 §6 步骤2 一致；§4 初始登记与 §8/§10 一致；§6 强制 LLM 与 §7 mock 降级不冲突（fillFallback 内部处理）。
- **范围检查**：聚焦单一功能（按钮动作兜底），适合一个实施计划。
- **歧义检查**：
  - "匹配 next_template_id 卡片"已明确（§6 步骤6）：存在则用，否则回退 answer。
  - "参数怎么取"已明确为 `param_sources` 字段（§4.1）。
  - 特例白名单初始仅 `check_weather_risk`（§3），后续可扩展。
  - **约束已落实**：当前 LLM 通道不支持 function calling（§6.2），故接口类动作兜底为「声明+推理」而非真实取数，已写清并预留扩展点；知识库类动作经 `ragService` 注入 `evidence`（§4.1/§6 步骤4），可真实推理。
