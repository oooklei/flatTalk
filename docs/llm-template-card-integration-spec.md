# LLM 与 Template Card 对接设计规范

## 1. 目标

本规范用于定义 flatTalk 后台如何把模板内容提供给大模型、大模型如何返回结构化结果、后台如何调用 `template-card` 渲染、前端如何展示。

核心原则：

```text
LLM 输出为主：
  LLM 负责选择模板语义、生成 answer、填充模板数据、生成追问和动作建议。

后台做约束和渲染：
  后台负责提供模板库、提供字段 schema、注入业务数据和知识库证据、校验 LLM JSON、调用 renderCard() 生成 HTML。

前端做容器展示：
  前端不参与业务判断，不拼业务 HTML，只把后台返回的 card.pages 放进页面容器，并接收 actions/followups。
```

本规范对接现有实现：

```text
docs/template-card-spec.md
src/template-card/discover.js
src/template-card/prompt.js
src/template-card/select.js
src/template-card/render.js
src/template-card/index.js
```

## 2. 主链路

```text
用户输入
  -> /api/chat/message
  -> 读取用户上下文、会话上下文
  -> 场景识别：meal_plan / common / 后续更多 skill
  -> 定位模板目录：src/skills/<skill>/templates/html
  -> discoverTemplates() 扫描模板库
  -> describeLibrary() 生成模板清单
  -> 把模板清单、用户问题、业务数据、远程知识库证据给 LLM
  -> LLM 返回 template_id + data/items + answer + actions + followups
  -> 后台校验 template_id 是否存在
  -> renderCard(templateDir, llm_card_json)
  -> 返回 ChatCardResult
  -> 前端把 card.pages[0] 放入卡片容器或 iframe
```

追问链路：

```text
用户点击 followup
  -> /api/chat/followup
  -> 后台读取上一轮 selected template、scene、data、knowledge
  -> 作为上下文继续给 LLM
  -> LLM 可沿用原 template_id，也可切换为新的 template_id
  -> 后台重新 renderCard()
  -> 前端追加展示新的卡片
```

动作链路：

```text
用户点击 action
  -> client_only：前端本地执行
  -> server_skill：提交 /api/chat/action 后再次运行技能
  -> external_api：后台调用第三方接口，再返回新的 ChatCardResult 或状态卡片
```

## 3. 模板如何给 LLM

后台不把完整 HTML 直接塞给 LLM。完整 HTML 太长、容易污染输出，也会诱导 LLM 生成 HTML。

后台给 LLM 的模板上下文只包含三类信息：

```json
{
  "template_library": [
    {
      "id": "plan",
      "layout": "vertical",
      "match": "展示老人膳食推荐方案、餐次、营养建议和风险提醒"
    }
  ],
  "selected_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "summary": { "type": "string" },
      "meals": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "meal_type": { "type": "string" },
            "items": { "type": "array" },
            "reason": { "type": "string" }
          }
        }
      }
    },
    "required": ["title", "summary", "meals"]
  },
  "render_contract": {
    "must_return_json": true,
    "must_not_return_html": true,
    "template_id_must_exist_in_library": true
  }
}
```

模板清单来源：

```js
import { discoverTemplates, describeLibrary } from "./src/template-card/index.js";

const templates = discoverTemplates(templateDir);
const library = describeLibrary(templates);
```

字段 schema 来源：

```js
import { jsonSchemaFor } from "./src/template-card/index.js";

const selected = templates.find((item) => item.id === templateId);
const schema = jsonSchemaFor(selected);
```

## 4. 推荐采用两阶段 LLM

### 4.1 阶段一：选择模板

输入：

```text
用户问题
场景识别结果
模板 library：id、layout、match
```

使用现有函数：

```js
import { buildSelectPrompt } from "./src/template-card/index.js";

const prompt = buildSelectPrompt(templates, userQuestion);
```

LLM 只返回一个模板 id：

```text
plan
```

后台兜底：

```text
如果 LLM 返回的 template_id 不存在：
  -> 使用 selectTemplate() 按字段覆盖率兜底
  -> 再不行使用 fallbackTemplateId 或通用模板
```

### 4.2 阶段二：填充模板数据

输入：

```text
用户问题
已选模板 id
模板字段 schema
本机 PG 表数据
远程知识库证据
上一轮上下文
```

使用现有函数：

```js
import { buildFillPrompt, jsonSchemaFor } from "./src/template-card/index.js";

const schema = jsonSchemaFor(selectedTemplate);
const prompt = buildFillPrompt(userQuestion, selectedTemplate, schema);
```

LLM 返回 JSON，不返回 HTML：

```json
{
  "template_id": "plan",
  "answer": "建议早餐以低糖、高纤维、易消化为主，主食控制总量。",
  "data": {
    "title": "控糖早餐建议",
    "summary": "适合糖尿病老人的早餐搭配。",
    "meals": [
      {
        "meal_type": "早餐",
        "items": ["燕麦粥", "水煮蛋", "南瓜"],
        "reason": "升糖较慢，蛋白质充足。"
      }
    ],
    "nutrition_tips": ["主食控制总量", "避免甜豆浆"],
    "risk_warnings": ["如正在使用降糖药，应避免空腹过久"]
  },
  "actions": [
    {
      "key": "meal_plan.weekly",
      "label": "生成一周计划",
      "type": "server_skill",
      "params": {
        "intent": "weekly_plan"
      }
    }
  ],
  "followups": [
    {
      "label": "换成软烂版",
      "prompt": "请把这份早餐建议调整得更软烂易咀嚼"
    }
  ]
}
```

## 5. 后台返回给前端的协议

不再强调 `Envelope`。统一使用更轻的 `ChatCardResult`。

```json
{
  "ok": true,
  "conversation_id": "conv_001",
  "turn_id": "turn_001",
  "scene": "meal_plan",
  "answer": "建议早餐以低糖、高纤维、易消化为主，主食控制总量。",
  "llm": {
    "template_id": "plan",
    "data": {}
  },
  "card": {
    "templateId": "plan",
    "layout": "vertical",
    "reason": "model-id",
    "score": 1,
    "cardCount": 1,
    "pageCount": 1,
    "pages": ["<!doctype html>..."]
  },
  "actions": [],
  "followups": [],
  "debug": {
    "scene_confidence": 0.86,
    "knowledge_status": "remote_hit",
    "model_status": "ok",
    "render_status": "ok"
  }
}
```

字段要求：

| 字段 | 必填 | 说明 |
|---|---|---|
| `ok` | 是 | 是否成功 |
| `conversation_id` | 是 | 会话 id |
| `turn_id` | 是 | 轮次 id |
| `scene` | 是 | 后台识别到的业务场景 |
| `answer` | 是 | LLM 原始回答摘要，前端可展示在气泡中 |
| `llm.template_id` | 是 | LLM 选择的模板 id |
| `llm.data` / `llm.items` | 是 | LLM 填槽数据 |
| `card.pages` | 是 | `renderCard()` 生成的完整 HTML |
| `actions` | 否 | 动作按钮 |
| `followups` | 否 | 追问建议 |
| `debug` | 开发模式 | 调测链路信息 |

## 6. 后台渲染流程

```js
import { renderCard } from "./src/template-card/index.js";

function renderLlmCard({ templateDir, llmJson }) {
  const renderInput = {
    template_id: llmJson.template_id,
    data: llmJson.data,
    items: llmJson.items,
  };

  return renderCard(templateDir, renderInput, {
    pageLimit: llmJson.page_limit || 0,
    repeatKey: llmJson.repeat_key || "items",
    fallbackTemplateId: "fallback",
  });
}
```

后台只允许 `renderCard()` 输出 HTML。LLM 输出中的 HTML 字段一律丢弃或转义。

## 7. 前端渲染要求

前端只认 `ChatCardResult.card.pages`。

单页：

```js
cardContainer.innerHTML = result.card.pages[0];
```

如果为了隔离样式，推荐 iframe：

```js
iframe.srcdoc = result.card.pages[0];
```

多页：

```js
result.card.pages.forEach((html) => {
  renderPage(html);
});
```

前端按钮来源：

```text
actions -> 渲染动作按钮
followups -> 渲染追问按钮
answer -> 可渲染为普通聊天气泡
card.pages -> 渲染为模板卡片
```

前端禁止：

```text
禁止根据业务字段自行选择模板
禁止拼接业务 HTML
禁止解释 LLM JSON 里的业务语义
```

## 8. 后台主链路模块

```text
src/api/chat.js
  处理 /api/chat/message、/api/chat/followup、/api/chat/action。

src/core/orchestrator/chat-card-orchestrator.js
  主编排器，串联场景、模板、知识库、模型、渲染。

src/core/model/template-card-model.js
  两阶段 LLM：选择模板、填槽输出 JSON。

src/core/render/template-card-renderer.js
  调用 renderCard()，处理 render 结果和错误兜底。

src/services/knowledge-data/remote-knowledge-adapter.js
  接远程知识库。

src/services/table-data/pg-repository.js
  接本机 PG 表数据。

src/core/conversation/session-store.js
  Redis/内存会话。
```

## 9. 错误和兜底

### 9.1 LLM 选错模板

```text
template_id 不存在
  -> selectTemplate() 字段覆盖率兜底
  -> fallback 模板兜底
```

### 9.2 LLM JSON 不合法

```text
JSON 解析失败
  -> 重试一次，提示“只返回 JSON”
  -> 仍失败则返回 common fallback 卡片
```

### 9.3 字段缺失

```text
required 字段缺失
  -> 使用模板 defaultData 补齐
  -> debug.required_missing 记录缺失字段
```

### 9.4 远程知识库失败

```text
知识库失败
  -> evidence = []
  -> 继续调用 LLM
  -> debug.knowledge_status = "remote_failed"
```

### 9.5 renderCard 失败

```text
渲染失败
  -> fallback template
  -> answer 仍返回
  -> debug.render_status = "failed"
```

## 10. meal_plan 对接样例

模板目录：

```text
src/skills/meal_plan/templates/html
```

后台输入：

```json
{
  "conversation_id": "conv_001",
  "message": "糖尿病老人早餐怎么吃？",
  "roleKey": "elder_family",
  "elder_id": "elder_huang_xiuying"
}
```

后台装配给 LLM：

```json
{
  "scene": "meal_plan",
  "template_library": [
    {
      "id": "plan",
      "layout": "vertical",
      "match": "展示膳食方案、餐次、营养建议、风险提醒"
    }
  ],
  "business_data": {
    "elder_profile": {},
    "meal_rules": [],
    "diet_contraindications": []
  },
  "knowledge": [
    {
      "title": "糖尿病老人早餐建议",
      "text": "控制精制碳水，优先选择低 GI 主食和优质蛋白。"
    }
  ]
}
```

LLM 输出：

```json
{
  "template_id": "plan",
  "answer": "建议早餐以低 GI 主食、优质蛋白和少量蔬菜为主。",
  "data": {
    "title": "糖尿病老人早餐建议",
    "summary": "控制精制碳水，保证蛋白质和膳食纤维。",
    "meals": [
      {
        "meal_type": "早餐",
        "items": ["燕麦粥", "水煮蛋", "清炒青菜"],
        "reason": "升糖速度较慢，营养更均衡。"
      }
    ],
    "nutrition_tips": ["主食定量", "避免甜豆浆和油条"],
    "risk_warnings": ["如服用降糖药，应避免空腹过久"]
  },
  "actions": [
    {
      "key": "meal_plan.weekly",
      "label": "生成一周计划",
      "type": "server_skill"
    }
  ],
  "followups": [
    {
      "label": "换成软烂版",
      "prompt": "请把这份早餐建议调整得更软烂易咀嚼"
    }
  ]
}
```

后台调用：

```js
const card = renderCard("src/skills/meal_plan/templates/html", {
  template_id: llmJson.template_id,
  data: llmJson.data,
});
```

返回：

```json
{
  "ok": true,
  "scene": "meal_plan",
  "answer": "建议早餐以低 GI 主食、优质蛋白和少量蔬菜为主。",
  "llm": {
    "template_id": "plan",
    "data": {}
  },
  "card": {
    "templateId": "plan",
    "pages": ["<!doctype html>..."]
  },
  "actions": [],
  "followups": []
}
```

## 11. 与旧 Envelope 的关系

`Envelope` 不作为新主协议名称。后续可保留一个兼容转换层：

```text
ChatCardResult -> legacy Envelope
```

但新后台主链路、模型输出和前端渲染都以 `ChatCardResult + template-card` 为准。

## 12. 验收标准

```text
1. 后台不会要求 LLM 输出 HTML。
2. 后台会把 template library 和 selected schema 提供给 LLM。
3. LLM 返回 template_id + data/items。
4. 后台调用 renderCard() 生成 card.pages。
5. 前端只展示 card.pages、actions、followups。
6. 模板样式不由 LLM 生成，始终来自原 html 原型。
7. 知识库远程失败不影响模板渲染主链路。
8. 任意 LLM 输出错误均有 fallback 卡片兜底。
```
