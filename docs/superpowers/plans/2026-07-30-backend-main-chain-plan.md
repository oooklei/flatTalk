# flatTalk 后台主链路实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可支撑手机端对话、场景识别、技能运行、远程知识库检索、本机表数据、本机 Redis 会话缓存和后台 CRUD 的 flatTalk 后台主链路。

**Architecture:** 前端继续复用原 `mobile.html/css/js`。后台采用 API 层、会话层、编排层、技能运行层、数据服务层分层实现；知识库检索通过远程适配器接入，表数据、配置、会话、调测态优先使用本机 PG/Redis。

**Tech Stack:** Node.js ESM HTTP 服务、本机 PostgreSQL、本机 Redis、远程知识库 HTTP API、现有 Envelope v1、现有 template-card 合约。

---

## 1. 主链路

```text
手机端 mobile.js
  -> POST /api/chat/message
    -> API 请求解析与鉴权
    -> 会话读取/创建（Redis 优先，内存兜底）
    -> 用户上下文装配（dev SSO / 后续业务 SSO）
    -> 场景识别 identifyScene()
    -> 扫描 skill templates/html，按 html + manifest match 选择模板
    -> 业务数据读取（本机 PG：老人画像、膳食规则、业务配置）
    -> 远程知识库检索（RemoteKnowledgeAdapter）
    -> 模型调用（按模板合约输出 JSON slots）
    -> 交互动作合成 composeInteractions()
    -> ChatCardResult 兼容旧字段落库/缓存
  <- 返回 ChatCardResult
手机端 mobile.js
  -> 优先展示 rendered_html/html_fallback
  -> 调测面板查看 card.pages、route、actions、followups
  -> 展示 actions / followup_suggestions

用户点击追问/动作
  -> POST /api/chat/followup 或 /api/chat/action
    -> 读取上一轮会话
    -> 注入 previous_scene / previous_template / previous_data
    -> 重新场景识别，优先走上下文延续
    -> 重复技能运行链路
  <- 返回新的 ChatCardResult
手机端追加展示
```

## 2. 后台模块边界

```text
src/app.js
  只保留 HTTP 路由注册、静态资源、兼容旧手机端接口。

src/api/*
  每个业务入口一个 handler：chat、session、admin、config、sso。

src/core/conversation/*
  会话创建、读取、追加 turn、追问上下文提取。

src/core/orchestrator/*
  对话主编排：scene -> template -> data -> knowledge -> model -> envelope。

src/core/model/*
  模型 Provider、模板化 Prompt、JSON 输出校验、失败降级。

src/services/table-data/*
  本机 PG 仓储；开发期可保留内存 seed 兜底。

src/services/knowledge-data/*
  远程知识库适配器；现有本地向量检索仅作为测试兜底。

src/services/interface-data/*
  第三方接口调用、tag_system 读取、OpenAPI 接入配置。

src/services/cache/*
  Redis 客户端、会话缓存、限流、短期检索缓存。

src/admin/*
  后台 CRUD：表数据、知识库配置、接口配置、模型配置、技能配置。
```

## 3. 必须优先实现的后台主链路

### Task 1: 环境配置统一

**Files:**
- Modify: `src/config/env.js`
- Modify: `.env.example`
- Test: `tests/env.test.js`

- [ ] 增加 PG、Redis、远程知识库、模型配置：

```js
export function loadEnv() {
  return {
    host: process.env.FLATTALK_HOST || "127.0.0.1",
    port: Number(process.env.FLATTALK_PORT || 5298),
    runtimeMode: process.env.FLATTALK_RUNTIME_MODE || "local",
    pgUrl: process.env.FLATTALK_PG_URL || "",
    redisUrl: process.env.FLATTALK_REDIS_URL || "",
    knowledgeBaseUrl: process.env.FLATTALK_KB_BASE_URL || "",
    knowledgeApiKey: process.env.FLATTALK_KB_API_KEY || "",
    knowledgeSpace: process.env.FLATTALK_KB_SPACE || "23",
    modelMode: process.env.FLATTALK_MODEL_MODE || "mock",
    openaiBaseUrl: process.env.FLATTALK_OPENAI_BASE_URL || "",
    openaiApiKey: process.env.FLATTALK_OPENAI_API_KEY || "",
    openaiModel: process.env.FLATTALK_OPENAI_MODEL || "",
  };
}
```

### Task 2: 会话服务

**Files:**
- Create: `src/core/conversation/session-store.js`
- Create: `src/services/cache/redis-client.js`
- Modify: `src/app.js`
- Test: `tests/session-store.test.js`

- [ ] 实现 `SessionStore`：`getOrCreate(conversationId)`、`appendTurn(conversationId, turn)`、`getPreviousTurn(conversationId)`。
- [ ] Redis 可用时写 Redis；Redis 不可用时使用内存 Map。
- [ ] `POST /api/chat/message` 和 `POST /api/chat/followup` 不再直接访问 `sessions` Map。

### Task 3: 对话编排器与 template-card 渲染

**Files:**
- Create: `src/core/orchestrator/chat-orchestrator.js`
- Modify: `src/runtime/local-skill-runtime.js`
- Modify: `src/app.js`
- Test: `tests/chat-orchestrator.test.js`

- [ ] 把当前 `runLocalSkill()` 内的主流程迁移到编排器：

```text
normalizeRequest
  -> loadSessionContext
  -> identifyScene
  -> selectTemplate
  -> loadBusinessData
  -> retrieveKnowledge
  -> callModel
  -> composeInteractions
  -> buildEnvelope
  -> persistTurn
```

- [ ] `runLocalSkill()` 保留为兼容入口，内部调用 `chatOrchestrator.run()`。
- [x] 当前最小联调版本已在 `runLocalSkill()` 内接入 `renderCard()`，返回 `llm`、`card`、`rendered_html` 和 `html_fallback`，同时保留旧字段兼容手机端。

### Task 4: 远程知识库适配器

**Files:**
- Create: `src/services/knowledge-data/remote-knowledge-adapter.js`
- Modify: `src/services/knowledge-data/index.js`
- Modify: `src/services/rag-service.js`
- Test: `tests/remote-knowledge-adapter.test.js`

- [ ] 当 `FLATTALK_KB_BASE_URL` 存在时启用远程知识库。
- [ ] 请求形态统一为：

```json
{
  "space": "23",
  "skill_key": "meal_plan",
  "query": "用户问题",
  "limit": 3,
  "filters": {
    "elder_id": "elder_huang_xiuying",
    "role_key": "elder_family"
  }
}
```

- [ ] 返回统一映射为：

```json
{
  "chunk_id": "remote-id",
  "skill_key": "meal_plan",
  "title": "标题",
  "text": "知识片段",
  "score": 0.82,
  "source": "remote_knowledge"
}
```

- [ ] 远程失败时返回 `matches: []`，但 Envelope `route` 写入 `knowledge_status: "remote_failed"`。

### Task 5: 本机 PG 表数据仓储

**Files:**
- Create: `src/services/table-data/pg-repository.js`
- Create: `src/services/table-data/migrations/001_init.sql`
- Create: `src/services/table-data/seeds/meal_plan.sql`
- Modify: `src/services/table-data/index.js`
- Test: `tests/pg-table-data.test.js`

- [ ] 首批表：

```text
flattalk_elder_profile
flattalk_meal_rules
flattalk_diet_contraindications
flattalk_model_configs
flattalk_skill_configs
flattalk_interface_configs
flattalk_conversation_turns
```

- [ ] `getMealPlanTables()` 优先读 PG；PG 未配置时保留当前内存 seed。

### Task 6: 模型配置与模型调用

**Files:**
- Create: `src/core/model/model-provider.js`
- Create: `src/core/model/template-prompt-builder.js`
- Modify: `src/core/model-service.js`
- Create: `src/api/model-config.js`
- Test: `tests/model-provider.test.js`

- [ ] 模型配置来源顺序：

```text
请求级 override
  -> PG flattalk_model_configs 当前启用配置
  -> .env
  -> mock model
```

- [ ] 对大模型只允许输出 JSON slots，不允许输出 HTML。
- [ ] Prompt 必须包含 `template_id`、字段 contract、业务数据、知识证据、输出 schema。

### Task 7: 后台 CRUD API

**Files:**
- Create: `src/api/admin-table-data.js`
- Create: `src/api/admin-knowledge-data.js`
- Create: `src/api/admin-interface-data.js`
- Create: `src/api/admin-skill-config.js`
- Modify: `src/app.js`
- Test: `tests/admin-crud.test.js`

- [ ] 表数据 CRUD：

```text
GET    /api/admin/table/:table
POST   /api/admin/table/:table
PATCH  /api/admin/table/:table/:id
DELETE /api/admin/table/:table/:id
```

- [ ] 知识库配置 CRUD：只管理远程知识库连接、空间、索引配置，不在本机落向量数据。
- [ ] 接口配置 CRUD：OpenAPI、第三方系统、tag_system 连接配置。
- [ ] 技能配置 CRUD：技能启停、场景规则阈值、模板启停、默认模板。

### Task 8: 动作和追问主链路

**Files:**
- Create: `src/core/actions/action-dispatcher.js`
- Modify: `src/core/interaction-composer.js`
- Modify: `src/app.js`
- Test: `tests/action-followup-flow.test.js`

- [ ] `followup_suggestions` 继续由后端 Envelope 返回，前端只负责展示和再次提交。
- [ ] `actions` 分三类：

```text
client_only：前端本地动作，如复制、展开、切换模板视图
server_skill：再次调用技能，如生成一周计划
external_api：调用第三方接口，如创建工单、下单、同步档案
```

- [ ] 新增 `POST /api/chat/action`，统一接收 action_key、conversation_id、turn_id、params。

### Task 9: 观测、调测和自动化验证

**Files:**
- Create: `src/core/observability/logger.js`
- Create: `src/api/debug.js`
- Modify: `src/app.js`
- Test: `tests/debug-api.test.js`

- [ ] 每轮写入 request_id、conversation_id、scene、template_id、knowledge_status、model_status、latency_ms。
- [ ] 保留手机端热键调测入口需要的 `/api/health`、`/api/client-config`、`/api/mobile-bootstrap`。
- [ ] `npm run check` 必须覆盖主链路、远程知识库失败兜底、PG 未配置兜底、Redis 未配置兜底。

## 4. 实施顺序

```text
第一阶段：不破坏现有手机端
  Task 1 -> Task 2 -> Task 3

第二阶段：接入真实数据源
  Task 4 -> Task 5

第三阶段：接入真实模型和后台配置
  Task 6 -> Task 7

第四阶段：动作化、追问、观测闭环
  Task 8 -> Task 9
```

## 5. 验收标准

```text
1. 打开 http://127.0.0.1:5298/ 能进入原手机首页。
2. 开发用户热键能看到 8 个原版预制用户。
3. 输入膳食问题后，后台能完成场景识别、模板选择、远程知识库检索、本机表数据读取、模型填槽、Envelope 返回。
4. 前端只做模板渲染、动作展示和追问提交，不承担业务判断。
5. 点击追问后，后台能读取上一轮上下文并返回新 Envelope。
6. 远程知识库不可用时，对话仍可降级返回，且调测信息能看到失败原因。
7. PG/Redis 未配置时开发环境仍可使用内存兜底。
8. `npm run check` 全部通过。
```
