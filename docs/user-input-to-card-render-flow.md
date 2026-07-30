# 用户输入到页面卡片展示全链路说明

本文档说明 `flatTalk` 当前代码中，用户从手机端输入文本，到最终在页面看到模板化卡片的完整过程。说明以现有实现为准，覆盖代码模块、引用资源、模板文件、数据服务和知识库路由。

## 0. 本次流程修订结论

本次按实际运行要求做以下修正：

1. 前端等待气泡改为：

```js
this.addBubble("小养", "思考中呢...");
```

2. `createDataService(...)` 和 `createRedisStateStore(...)` 不是每次请求都创建。它们在 `createApp(...)` 执行时创建一次，随 Node 服务进程生命周期存在。
3. Redis 中保存的是当前系统的会话上下文和队列状态，不等同于完整历史对话库。当前保存最近对话轮次，用于追问、上下文延续和会话列表。
4. 数据检索顺序改为：先查知识库，再按技能需要查表数据。后续不同 skill 可定义自己的数据编排顺序。
5. 女娲知识库支持账号密码自动登录，默认环境变量为：

```env
FLATTALK_KB_USERNAME=admin@nuwax.com
FLATTALK_KB_PASSWORD=123456
```

也可直接配置：

```env
FLATTALK_KB_TICKET=...
FLATTALK_KB_API_KEY=...
```

6. 模板选择职责调整为：场景识别只负责选择 `skill_key`，模板选择前置到模型语义理解阶段。模型根据 `template_library.match` 和用户问题返回 `template_id`，渲染器只按该 `template_id` 渲染；字段覆盖率只作为兜底。
7. `renderSafeHtmlFallback(...)` 只接收后端生成的安全 HTML 容器。各技能需要制作 `templates/html/*.html` 和对应 `*.manifest.json`。
8. 动作和追问来源于模型输出以及 `interaction-composer` 过滤结果；前端只展示已经有 handler 的动作/追问。
9. 如果动作或追问没有实现 handler，前端不显示。当前已支持 `meal_plan.generate_weekly_plan`、`meal_plan.adjust_for_condition`、`meal_plan.save_preference`。

## 0.1 意图分类主流程补充

意图分类需要吸收旧项目：

```text
D:\GuiCare0717\guixiaoyang-chat-system copy\skill-packages\find_service\workflows\intent_classify.md
```

该文件只作为迁移参考，不作为 `flatTalk` 运行时依赖。新架构中，意图分类前置在 `scene-router` 之前，负责把用户输入转成稳定的 `intent_context`，再交给场景识别和技能运行链路。

标准输出结构：

```json
{
  "intent_type": "SERVICE | SOS | HEALTH | CHAT",
  "confidence": 0.86,
  "model_used": "BERT-base | TextCNN | LLM-fallback | rules",
  "entities": {
    "service_type": null,
    "time": null,
    "location": null,
    "symptom": null,
    "medication": null
  },
  "urgency_level": "P0 | P1 | P2",
  "urgency_reason": "",
  "keyword_match": [],
  "tone_analysis": {
    "speed": null,
    "volume": null,
    "duration": null,
    "urgency_score": 0
  },
  "classification_path": "normal | emergency_bypass | fallback | clarification"
}
```

分类策略：

1. 先执行紧急双保险：紧急关键词、语音语气、急迫词命中后可绕过普通分类，直接进入 `SOS/P0` 或 `HEALTH/P1`。
2. 普通分类优先使用主分类器，目标类型为 `SERVICE`、`SOS`、`HEALTH`、`CHAT`。
3. 主分类器低置信度、超时或异常时，降级到备用分类器。
4. 模型服务不可用时，降级为规则 + LLM 轻量分类。
5. 实体抽取失败不阻断主链路，只把实体字段置空。

阈值要求：

| 类型 | 阈值 | 处理 |
| --- | --- | --- |
| `SOS` | `>= 0.85` | `P0`，优先进入紧急处理 |
| `HEALTH` | `>= 0.70` | `P1`，优先查健康/膳食知识 |
| `SERVICE` | `>= 0.70` | `P1`，优先查办事服务和政策知识 |
| `CHAT` | `< 0.60` | `P2`，普通聊天 |
| 不确定 | `0.60-0.70` | 生成澄清追问 |

与后续模块关系：

- `intent-classifier`：只输出意图、紧急等级、实体和置信度。
- `scene-router`：基于 `intent_context`、用户问题和历史上下文确定 `skill_key`。
- `knowledge-data`：基于 `skill_key` 和 `intent_type` 选择知识库集合。
- `table-data`：基于 `intent_context.entities` 和 `skill_key` 查询业务表。
- `model-service`：基于模板库、知识证据、表数据和 `intent_context` 输出 `template_id + data + answer_text + actions + followups`。
- `mobile.js`：只展示后端结果，不做业务意图判断。

## 1. 前端输入入口

手机端页面资源：

- `src/public/mobile.html`
- `src/public/mobile.css`
- `src/public/mobile.js`

用户在聊天输入框输入文本并提交后，进入：

- `src/public/mobile.js`
- 方法：`sendMessage(text)`

核心流程：

```js
this.addBubble("user", message);
this.addBubble("小养", "思考中呢...");
fetchJson("/api/chat/message", ...);
```

前端请求地址：

```text
POST /api/chat/message
```

请求体主要字段：

```json
{
  "message": "用户输入文本",
  "conversationId": "当前会话ID",
  "conversationHistory": [],
  "roleKey": "当前用户角色",
  "channel": "mobile",
  "userToken": "用户令牌",
  "elderScope": "老人范围",
  "terminal": "终端类型",
  "authLevel": "认证等级",
  "userName": "用户名",
  "orgName": "组织名",
  "presetKey": "开发预制用户key"
}
```

## 2. 后端聊天网关

后端入口：

- `src/app.js`
- 路由：`POST /api/chat/message`
- 方法：`handleChat(...)`

`createApp(...)` 初始化时会创建运行对象：

```js
const dataService = createDataService(...);
const stateStore = createRedisStateStore(...);
```

这些对象在 `createApp(...)` 执行时创建一次，通常也就是 Node 服务启动时创建一次；不是每次 HTTP 请求都创建。

其中：

- `dataService` 负责表数据、知识库、第三方接口数据。
- `stateStore` 负责会话和队列状态，配置 Redis 时使用 160 Redis DB7。

生命周期：

- 服务进程启动：创建 `dataService`、`stateStore`、PG/Redis/知识库适配器。
- 普通请求：复用这些对象。
- 浏览器关闭：不会销毁后端对象，只是不再有该浏览器继续请求。
- 会话 Redis TTL：当前会话保存 7 天。
- 服务进程停止：对象销毁，PG/Redis 连接随进程关闭。

`handleChat(...)` 的主要步骤：

1. 读取请求 JSON。
2. 确定 `conversationId`。
3. 从 Redis 读取会话。
4. 生成 `turnId`。
5. 组装技能运行请求。
6. 调用 `runLocalSkill(...)`。
7. 将本轮结果写回 Redis 会话。
8. 返回 Envelope 给前端。

核心调用：

```js
const envelope = await runLocalSkill({
  request_id: body.request_id,
  conversation_id: conversationId,
  turn_id: turnId,
  skill_key: body.skill_key || body.skillKey,
  message,
  role: body.role || body.roleKey || "elder_family",
  elder_id: body.elder_id,
  context: { ... }
}, { dataService });
```

## 3. 技能运行时

核心文件：

- `src/runtime/local-skill-runtime.js`
- 方法：`runLocalSkill(request, options)`

运行时主流程：

```text
用户请求
 -> 场景识别
 -> 确定技能
 -> 读取技能模板库
 -> 查询表数据
 -> 查询知识库
 -> 调模型填槽
 -> 渲染 HTML 卡片
 -> 封装 Envelope
```

关键模块：

- 场景识别：`src/core/scene-router/index.js`
- 膳食规则：`src/core/scene-router/rules/meal-plan.js`
- 模型填槽：`src/core/model-service.js`
- 交互动作：`src/core/interaction-composer.js`
- 模板渲染：`src/core/render/template-card-renderer.js`
- Envelope：`src/contracts/envelope.js`

如果请求显式传入：

```json
{
  "skill_key": "meal_plan"
}
```

则运行时会强制使用该技能，避免完全依赖自然语言场景识别。

## 4. 场景识别和技能选择

场景识别入口：

- `src/core/scene-router/index.js`

膳食场景规则：

- `src/core/scene-router/rules/meal-plan.js`

典型命中 `meal_plan` 的输入：

```text
推荐今日膳食
糖尿病老人早餐怎么吃
高血压老人晚餐怎么安排
生成一周膳食计划
```

命中后：

```text
skill_key = meal_plan
```

如果未命中膳食场景，则默认进入：

```text
skill_key = common
```

## 5. 表数据服务

数据服务入口：

- `src/services/data-service.js`

表数据模块：

- `src/services/table-data/index.js`
- `src/services/table-data/repository.js`
- `src/services/table-data/repository-pg.js`
- `src/services/table-data/schemas.js`

当前表数据优先使用 160 标签系统 PG：

```env
FLATTALK_PG_URL=postgresql://tag_system:***@192.168.1.160:5432/tag_system
```

逻辑独立表：

```text
flattalk_table_rows
```

膳食技能读取的数据：

```text
elder_profile
meal_rules
diet_contraindications
```

运行时调用：

```js
dataService.tableData.getMealPlanTables({
  elder_id
});
```

这些数据会作为 `business_data` 输入模型填槽。

## 6. Redis 会话和队列

Redis 状态模块：

- `src/services/cache/redis-state-store.js`

默认配置：

```env
FLATTALK_REDIS_URL=redis://192.168.1.160:6379/7
```

用途：

- 保存会话：`conversation:{conversationId}`
- 保存会话索引：`conversations:index`
- 保存输入队列：`chat:queue`

这里的“会话”是当前系统运行态会话，不是完整历史对话归档库。它保存每轮：

```json
{
  "turn_id": "...",
  "user_message": "...",
  "envelope": {}
}
```

用途：

- 支撑追问时读取上一轮 `skill_key`、`template_id`、`turn_id`。
- 支撑前端会话列表。
- 支撑输入排队和运行状态。

后续如果要做长期历史对话，应单独建 PG 历史表，例如：

```text
flattalk_dialogue_history
```

相关接口：

```text
GET  /api/conversation/list
GET  /api/chat/queue
POST /api/chat/queue/action
GET  /api/chat/running
```

## 7. 知识库检索

知识库服务入口：

- `src/services/rag-service.js`

远程知识库适配器：

- `src/services/knowledge-data/remote-knowledge-adapter.js`

当前知识库地址：

```env
FLATTALK_KB_BASE_URL=http://43.138.143.130:9015
FLATTALK_KB_SEARCH_PATH=/api/knowledge/query
FLATTALK_KB_SPACE=23
FLATTALK_KB_AGENT_ID=373
```

知识库需要女娲登录态。当前支持三种方式：

方式一：直接配置 ticket。

```env
FLATTALK_KB_TICKET=你的ticket
```

方式二：配置 Bearer key。

```env
FLATTALK_KB_API_KEY=你的BearerKey
```

方式三：配置账号密码，运行时自动登录 `/api/user/passwordLogin` 并缓存 ticket。

```env
FLATTALK_KB_USERNAME=admin@nuwax.com
FLATTALK_KB_PASSWORD=123456
```

### 7.1 知识库分流规则

配置：

```env
FLATTALK_KB_MEAL_PLAN_COLLECTIONS=膳食知识库
FLATTALK_KB_DEFAULT_COLLECTIONS=广西养老办事指引知识库,广西养老政策知识库
```

分流逻辑：

```text
meal_plan -> 膳食知识库
common / 其他问题 -> 广西养老办事指引知识库 + 广西养老政策知识库
```

检索请求体形态：

```json
{
  "collection": "膳食知识库",
  "query": "用户问题",
  "top_k": 3,
  "filter": {},
  "min_score": 0,
  "spaceId": 23,
  "agentId": "373"
}
```

检索结果会归一化为：

```json
{
  "chunk_id": "...",
  "title": "...",
  "text": "...",
  "score": 0.9,
  "source": "remote_knowledge",
  "collection": "膳食知识库",
  "metadata": {}
}
```

这些结果作为 `evidence` 输入模型。

## 8. 模板资源和语义选择

技能目录：

```text
src/skills/meal_plan/
```

技能 manifest：

```text
src/skills/meal_plan/manifest.json
```

当前默认模板：

```json
{
  "default_template": "diet_card"
}
```

膳食模板资源：

```text
src/skills/meal_plan/templates/html/diet_card.html
src/skills/meal_plan/templates/html/diet_card.manifest.json
src/skills/meal_plan/templates/data/diet_card.sample.json
src/skills/meal_plan/templates/followups/diet_card.json
```

模板扫描代码：

- `src/template-card/discover.js`
- `src/template-card/index.js`

运行时读取模板库：

```js
const templates = discoverTemplates(templateDir);
const library = describeLibrary(templates);
```

模板库描述示例：

```json
[
  {
    "id": "diet_card",
    "layout": "vertical",
    "match": "展示一日三餐完整膳食推荐..."
  }
]
```

`diet_card.manifest.json` 中的 `match` 是大模型理解模板适用场景的重要语义描述。

职责划分：

- `scene-router`：只判断 `skill_key`，例如 `meal_plan`。
- `template_library`：列出该技能下所有可用模板及语义描述。
- 大模型：根据用户问题、知识库证据、业务数据和 `template_library.match` 返回 `template_id`。
- 渲染器：只按模型返回的 `template_id` 渲染。
- 字段覆盖率：只作为模型未返回有效 `template_id` 时的兜底，不作为主选择链路。

因此不存在两次主选择冲突。旧流程里的“默认模板选择”已降级为兜底。

## 9. 模型填槽

模型服务：

- `src/core/model-service.js`

调用方式：

```js
modelService.fillTemplateSlots({
  message,
  template_id,
  template_library,
  evidence,
  business_data
});
```

当前 `diet_card` 输出结构：

```json
{
  "template_id": "diet_card",
  "answer_text": "文字答复",
  "data": {
    "dateBadge": "今日推荐",
    "suitable": "适用人群",
    "totalCal": "总热量",
    "salt": "控盐建议",
    "meals": [
      {
        "mealName": "早餐",
        "mealEmoji": "图标",
        "mealTotal": "热量",
        "foods": [
          {
            "foodIcon": "图标",
            "foodName": "食物名称",
            "cal": "热量",
            "calNote": "备注"
          }
        ]
      }
    ],
    "ratioText": "营养比例说明",
    "tags": [],
    "related": []
  },
  "actions": [],
  "followups": []
}
```

后续接真实大模型时，仍应遵守这个约定：

```text
大模型负责输出 template_id + data + answer_text + actions + followups
前端负责展示、模板容器、按钮、追问和动作接收
```

注意：模板选择发生在模型输出阶段。模型需要看到 `template_library`，并在输出中明确给出：

```json
{
  "template_id": "diet_card"
}
```

## 10. HTML 卡片渲染

渲染入口：

- `src/core/render/template-card-renderer.js`

核心调用：

```js
renderCard(templateDir, {
  template_id: llmJson.template_id,
  data: buildRenderData(llmJson)
});
```

模板渲染核心：

- `src/template-card/index.js`
- `src/template-card/render.js`
- `src/template-card/select.js`
- `src/template-card/discover.js`

渲染过程：

1. 扫描 `templates/html`。
2. 找到 `diet_card.html`。
3. 读取 `diet_card.manifest.json`。
4. 读取 HTML 中的默认示例数据。
5. 用模型返回的 `data` 覆盖默认数据。
6. 使用轻量 Mustache 子集替换变量。
7. 生成完整 HTML 页面。
8. 包装成 iframe fallback。

返回结构：

```json
{
  "llm": {
    "template_id": "diet_card",
    "answer": "...",
    "data": {}
  },
  "card": {
    "templateId": "diet_card",
    "layout": "vertical",
    "reason": "model-id",
    "score": 0,
    "cardCount": 1,
    "pageCount": 1,
    "pages": ["<!doctype html>..."]
  },
  "rendered_html": "<article class=\"gxy-html-fallback\">...</article>",
  "html_fallback": "<article class=\"gxy-html-fallback\">...</article>",
  "render_status": "ok"
}
```

`rendered_html` 的形态：

```html
<article class="gxy-html-fallback" data-renderer="template-card-renderer">
  <style>...</style>
  <iframe
    class="gxy-template-card-frame"
    title="template-card"
    sandbox=""
    srcdoc="完整模板HTML">
  </iframe>
</article>
```

`renderSafeHtmlFallback(...)` 不负责制作业务模板，它只负责从后端响应中取安全 HTML 容器并做基础清理。

真正需要制作的是每个技能下的模板文件：

```text
src/skills/<skill>/templates/html/<template>.html
src/skills/<skill>/templates/html/<template>.manifest.json
src/skills/<skill>/templates/data/<template>.sample.json
src/skills/<skill>/templates/followups/<template>.json
```

## 11. Envelope 返回

Envelope 构造：

- `src/contracts/envelope.js`

运行时最终返回给前端：

```json
{
  "schema": "gxy.envelope.v1",
  "ok": true,
  "request_id": "...",
  "conversation_id": "...",
  "turn_id": "...",
  "skill_key": "meal_plan",
  "intent": "meal_plan_advice",
  "template_id": "diet_card",
  "template_key": "diet_card",
  "render_mode": "frontend_template",
  "answer_text": "...",
  "data": {},
  "actions": [],
  "followup_suggestions": [],
  "evidence": [],
  "route": {
    "source": "flatTalk.local_skill_runtime",
    "scene_key": "meal_plan",
    "confidence": 0.9,
    "knowledge_status": "remote_hit",
    "knowledge_source": "remote_knowledge",
    "render_status": "ok"
  },
  "rendered_html": "...",
  "html_fallback": "...",
  "debug": {
    "knowledge_status": "...",
    "knowledge_source": "...",
    "knowledge_error": null,
    "model_status": "ok",
    "render_status": "ok"
  }
}
```

## 12. 前端接收和展示

前端接收入口：

- `src/public/mobile.js`
- 方法：`handleRemoteResult(body)`

主要步骤：

```js
const normalizedBody = this.normalizeDebugResult(body);
const answer = sanitizeAssistantText(...);
const fallbackHtml = renderSafeHtmlFallback(normalizedBody);

this.updateLastAiBubble(answer, {
  markdown: !fallbackHtml,
  html: fallbackHtml,
  error: normalizedBody.ok === false
});

this.appendAssistantActions(normalizedBody);
this.appendFollowupSuggestions(normalizedBody);
this.upsertTemplateTab(normalizedBody);
this.renderTemplatePanel(normalizedBody);
```

其中：

- `renderSafeHtmlFallback(...)` 优先使用 `result.rendered_html`。
- `updateLastAiBubble(...)` 将 HTML 插入最后一个 AI 气泡。
- `appendAssistantActions(...)` 渲染动作按钮。
- `appendFollowupSuggestions(...)` 渲染追问按钮。
- `renderTemplatePanel(...)` 更新调试模板面板。

最终页面结构：

```text
AI 气泡
  └─ gxy-html-fallback
      └─ iframe
          └─ diet_card.html 渲染后的完整卡片
  └─ 动作按钮
  └─ 追问按钮
```

## 13. 追问链路

追问按钮来源：

1. 大模型输出中的 `followup_suggestions`。
2. 技能模板目录中的 `templates/followups/<template>.json`，后续可作为默认追问资源接入。
3. `interaction-composer` 会根据 `sceneDecision.actions_allowed` 过滤不允许的追问。

当前前端只显示满足以下条件的追问：

- 有 `label`。
- 有 `user_prompt`。
- 如果带 `action_key`，该 `action_key` 必须已有前端 handler。

追问按钮示例：

```json
{
  "label": "生成一周计划",
  "user_prompt": "请基于这份膳食建议生成一周三餐计划",
  "action_key": "meal_plan.generate_weekly_plan"
}
```

模板资源：

```text
src/skills/meal_plan/templates/followups/diet_card.json
```

前端点击追问后进入：

- `src/public/mobile.js`
- 方法：`handleFollowupSuggestion(...)`

请求：

```text
POST /api/chat/followup
```

请求体包含：

```json
{
  "user_prompt": "追问文本",
  "conversation_id": "当前会话",
  "skill_key": "meal_plan",
  "source_template_id": "diet_card",
  "next_template_id": "diet_card",
  "roleKey": "当前角色",
  "userToken": "用户令牌"
}
```

后端仍然进入：

```js
handleChat(..., { followup: true })
```

并带上上一轮上下文：

```js
previous_scene
previous_turn_id
followup_source
```

之后重复：

```text
场景/技能
 -> 表数据
 -> 知识库
 -> 模型填槽
 -> 模板渲染
 -> Envelope
 -> 前端卡片展示
```

## 14. 动作链路

动作按钮来源：

1. 大模型输出中的 `actions`。
2. `src/core/interaction-composer.js` 中的默认动作。
3. `sceneDecision.actions_allowed` 白名单过滤。

当前前端只显示已有 handler 的动作。支持：

```text
meal_plan.generate_weekly_plan
meal_plan.adjust_for_condition
meal_plan.save_preference
```

前端点击动作后：

- `src/public/mobile.js`
- 方法：`handleAssistantAction(...)`

当前前端会发到：

```text
POST /api/chat/action
```

动作接口位置：

- `src/app.js`
- 方法：`handleChatAction(...)`

对于已支持的 `meal_plan.*` 动作，后端会再次进入 `runLocalSkill(...)`，生成新的模板卡片。

没有实现 handler 的动作不应出现在前端。

## 15. 总结流程图

```text
用户输入文本
  ↓
src/public/mobile.js sendMessage()
  ↓
POST /api/chat/message
  ↓
src/app.js handleChat()
  ↓
Redis 读取会话
  ↓
src/runtime/local-skill-runtime.js runLocalSkill()
  ↓
intent-classifier 意图分类
  ↓
输出 intent_context
  ↓
scene-router 基于 intent_context 场景识别
  ↓
确定 skill_key
  ↓
读取 src/skills/<skill>/templates/html
  ↓
43 女娲知识库按 skill 分流检索
  ↓
按 skill 需要读取 PG 业务表数据
  ↓
model-service 根据 template_library 语义输出 template_id + data + answer_text
  ↓
template-card 渲染 HTML 模板
  ↓
buildEnvelope 封装结果
  ↓
返回 rendered_html / html_fallback
  ↓
mobile.js handleRemoteResult()
  ↓
updateLastAiBubble()
  ↓
用户看到 iframe 模板卡片
```

## 16. 意图分类代码文件清单

意图分类落地时，建议按以下文件拆分，保证分类、紧急识别、实体抽取、场景路由和模板渲染互相独立。

新增核心文件：

```text
src/core/intent-classifier/index.js
src/core/intent-classifier/schema.js
src/core/intent-classifier/thresholds.js
src/core/intent-classifier/emergency-detector.js
src/core/intent-classifier/entity-extractor.js
src/core/intent-classifier/model-router.js
src/core/intent-classifier/tone-analysis.js
```

修改场景识别文件：

```text
src/core/scene-router/index.js
src/core/scene-router/rules/meal-plan.js
```

新增场景规则文件：

```text
src/core/scene-router/rules/find-service.js
src/core/scene-router/rules/health-risk.js
src/core/scene-router/rules/policy-consult.js
src/core/scene-router/rules/common-chat.js
```

修改主链路文件：

```text
src/runtime/local-skill-runtime.js
src/core/model-service.js
src/app.js
```

修改数据服务文件：

```text
src/services/knowledge-data/remote-knowledge-adapter.js
src/services/table-data/repository-pg.js
src/services/interface-data/tag-system-adapter.js
```

新增模型适配文件：

```text
src/services/model-intent/bert-intent-client.js
src/services/model-intent/textcnn-intent-client.js
src/services/model-intent/entity-extract-client.js
```

修改前端调测文件：

```text
src/public/mobile.js
```

修改配置文件：

```text
src/config/env.js
.env.example
```

新增资源文件：

```text
data/intent/thresholds.json
data/intent/emergency-keywords.seed.json
data/intent/service-types.seed.json
reference/source-copies/find_service/workflows/intent_classify.md
```

新增测试文件：

```text
tests/intent-classifier.test.js
tests/emergency-detector.test.js
tests/entity-extractor.test.js
tests/scene-router-intent-integration.test.js
tests/local-skill-runtime-intent-context.test.js
tests/app-intent-api.test.js
```

## 17. 当前关键运行依赖

标签系统 API：

```text
http://192.168.1.160:8010
```

标签系统 PG：

```text
192.168.1.160:5432/tag_system
```

Redis：

```text
192.168.1.160:6379/7
```

女娲知识库：

```text
http://43.138.143.130:9015/space/23/agent/373
```

知识库 collection：

```text
膳食知识库
广西养老办事指引知识库
广西养老政策知识库
```

## 18. 当前注意事项

1. 女娲知识库接口需要登录态，未配置 `FLATTALK_KB_TICKET` 或 `FLATTALK_KB_API_KEY` 时会返回 `4010 Not signed in or session expired`。
2. PG 表数据已经不是纯内存，配置 PG 后会使用 `flattalk_table_rows` 做逻辑独立存储。
3. Redis 配置后，会话和队列写入 Redis DB7。
4. 模板样式不由大模型生成，大模型只返回结构化数据。
5. 前端负责将 `rendered_html` 放入页面容器，并负责动作按钮和追问按钮交互。
