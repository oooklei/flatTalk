# 聊天系统全链路修复设计

> 日期: 2026-08-01
> 状态: 已确认，待实施
> 方案: 方案 B — 分层解耦

## 1. 背景与问题

全量手动测试发现 6 个系统性架构缺陷，影响全部 7 个技能的正常工作：

| # | 缺陷 | 影响范围 | 严重度 |
|---|---|---|---|
| A | **LLM 零记忆** — 主聊天 LLM 调用完全不注入对话历史，前端发了 conversationHistory 但后端丢弃 | 所有多轮对话、指代消解 | 致命 |
| B | **39/63 模板无确定性填充** — mock 模式或 LLM 超时降级时，24 个模板落入通用 answer | 6 个技能 | 高 |
| C | **SOS 检测被 request_override 静默禁用** — 携带 intent 字段的请求跳过 emergency 检测 | 紧急短路 | 致命 |
| D | **场景路由互窜** — elder-policy 阈值/权重失衡 + skill_key 黏性 + followup_source 缺失 | 所有技能交叉 | 高 |
| E | **卡片按钮无 postMessage 桥接** — 多数卡片内按钮无交互 | 卡片内操作 | 高 |
| F | **服务预约无前端闭环** — 订单表单无提交逻辑，按钮不可点击 | find_service 下单 | 中 |

### LLM 调用链路追踪结论

审计确认 LLM 有 3 种失败模式：

| 模式 | LLM 被调用? | 原因 |
|---|---|---|
| 超时/HTTP 错误 | 是 | 45s 超时或网络错误 → fallback() → 本地 mock → 24 个无 filler 模板返回"抱歉" |
| JSON 解析失败 | 是 | GLM-5.2 返回非合法 JSON（markdown 代码块、解释文字）→ 解析失败 → 丢弃 → fallback |
| 根本没调 LLM | 否 | FLATTALK_MODEL_MODE=mock 或模型注册表为空 → 直接走本地 mock |

**隐蔽问题**：即使 LLM 成功返回正确 template_id，但 data 字段与模板占位符不匹配时，渲染器不会降级到 answer（因为 template_id 在库中存在），而是渲染出空壳卡片。

### 提示词字段定义不足

当前 LLM 提示词只提供自然语言描述和 required 字段列表，没有给出 data 的精确 JSON schema。`template_fields` 仅提供 `id/layout/match/required`，`match` 是自然语言描述，模型必须从中猜测嵌套结构。`weekly_plan`、`route_card`、`health_warning_card` 有特别规则补丁，其它模板无字段类型示例。

## 2. 架构方案

采用**方案 B — 分层解耦**：新增 3 个独立模块 + 修补现有 3 个点。

### 新增模块

| 模块 | 解决的缺陷域 |
|---|---|
| ConversationContextManager | LLM 零记忆 + 技能间会话隔离 |
| SmartFallbackHandler | 24 模板无 filler + 兜底回显 |
| CardInteractionBridge | 卡片按钮无响应 + 服务预约闭环 |

### 修补点

- SOS 检测统一 + 前置
- 场景路由防窜（权重/阈值/skill_key guard）
- JSON Schema 注入到 LLM 提示词

## 3. ConversationContextManager（对话上下文管理层）

### 目标

让 LLM 拥有对话记忆，同时实现技能间物理隔离、逻辑可串。

### 架构

```
┌─────────────────────────────────────────────┐
│         ConversationContextManager           │
├─────────────────────────────────────────────┤
│  buildHistory(conversationId, skillKey)      │
│  ├─ 从 sessionStore 按 skillKey 取最近10轮   │
│  ├─ 过滤无效轮次（fallback/抱歉/空回答）      │
│  └─ 格式化为 [{role, content}] 注入 LLM prompt│
│                                              │
│  getCommonContext(conversationId)            │
│  ├─ 取 common agent 的会话历史               │
│  └─ 支持闲聊/通用问题                        │
│                                              │
│  switchAgent(conversationId, fromKey, toKey) │
│  ├─ freeze 当前 agent 上下文                  │
│  └─ restore 目标 agent 上下文                 │
└─────────────────────────────────────────────┘
```

### 关键规则

1. **10 轮滑动窗口**：每个 agent 独立维护最近 10 轮有效对话
2. **无效轮次过滤**：标记为 `fallback_mock` / `fallback_common_answer` / `answer` 模板且 answer_text 以"抱歉"开头的轮次被排除
3. **跨技能切换**：supervisor 检测到 boundaryTerm → freeze 当前 agent → 切换到目标 agent → 目标 agent 的历史自动加载
4. **common agent 兜底**：未命中任何技能的输入进入 common agent，支持闲聊

### 数据流示例

```
用户输入 "换成清淡点的"
  → supervisor 检测到 active_agent = meal_plan，canHandle=true
  → ConversationContextManager.buildHistory(convId, 'meal_plan')
  → 返回: [
      {role:'user', content:'帮我推荐老人食谱'},
      {role:'assistant', content:'【diet_card】今日推荐：小米粥...'},
      // 空回复已过滤
    ]
  → 注入 LLM prompt 的 conversation_history 字段
  → LLM 理解 "换" 指代上一轮的食谱 → 生成清淡版 diet_card
```

### 改动文件

| 文件 | 改动 |
|---|---|
| 新增 `src/core/conversation/context-manager.js` | 核心逻辑 |
| `src/app.js` | 读取 body.conversationHistory 传入 orchestrator |
| `chat-orchestrator.js` | 在 LLM 调用前注入 history |
| `template-card-llm-service.js` | buildMessages 接收 history 参数 |
| `src/prompts/template-card/fill-template.md` | 增加 `{{conversation_history}}` 占位符 |

## 4. SmartFallbackHandler（智能兜底层）

### 目标

当模板填充失败或 LLM 失败时，不再回显输入或返回"抱歉"，而是将用户原文 + 场景上下文发给 LLM 做免模板自然语言回答，再用统一的 answer 模板渲染。

### 架构

```
┌──────────────────────────────────────────────┐
│           SmartFallbackHandler                │
├──────────────────────────────────────────────┤
│  shouldFallback(modelResult)                  │
│  ├─ model_status === 'fallback_mock'         │
│  ├─ template_fit_notes 含 'fallback_common_answer' │
│  └─ data 字段覆盖率 < 0.3                     │
│                                               │
│  generateNaturalAnswer(input)                 │
│  ├─ 构建免模板提示词（不传 template_library） │
│  ├─ 注入: 用户原文 + 场景信息 + 对话历史      │
│  ├─ 注入: 技能意图（"膳食建议"/"旅居规划"）   │
│  ├─ 调 LLM → 返回自然语言 answer_text         │
│  └─ 用 answer 模板渲染（统一配色）            │
│                                               │
│  fillMissingTemplate(templateId, input)       │
│  ├─ 对常用模板补静态示例数据 filler           │
│  └─ 仍无匹配 → 走 generateNaturalAnswer       │
└──────────────────────────────────────────────┘
```

### 两条兜底路径

**路径 1：LLM 免模板回答（主路径）**

当 modelResult 标记为 fallback 时，不返回"抱歉"，而是用免模板提示词（不传 template_library）让 LLM 生成自然语言回答，用 answer 模板渲染。

**路径 2：常用模板补静态 filler（辅助路径）**

对高频模板补充确定性 filler，确保即使 LLM 完全不可用也能展示结构化卡片：

| 模板 | 新增 filler 逻辑 |
|---|---|
| `meal_timeline_card` | 按时间线排列一日三餐示例 |
| `meal_overview_card` | 概览统计 + 本周汇总 |
| `travel_base_card` | 康养基地列表（防城港数据） |
| `travel_plan_summary_card` | 行程摘要 + 预算 |
| `service_expand` | 扩展服务列表 |
| `dispatch_transfer` | 改派表单 |

### 关键约束

1. 免模板回答的 LLM 提示词不传 template_library，明确告诉模型"用自然语言回答即可，不需要选模板"
2. 免模板回答再超时时，才返回场景相关的降级文案（如"膳食助手暂时繁忙，您可以直接告诉我老人的饮食偏好"），而非通用"抱歉"
3. `model_status` 标记为 `smart_fallback` 而非 `fallback_mock`

### 改动文件

| 文件 | 改动 |
|---|---|
| 新增 `src/core/fallback/smart-fallback-handler.js` | 核心逻辑 |
| `model-service.js` L82-108 | 兜底块改为调用 SmartFallbackHandler |
| `template-card-llm-service.js` L149 | `fallback()` 改为调用 SmartFallbackHandler |
| 新增 `src/prompts/template-card/free-answer.md` | 免模板提示词模板 |
| `fill-template.md` | 增加 `{{conversation_history}}` 占位 |

## 5. CardInteractionBridge（卡片交互桥接层）

### 目标

实现卡片内所有按钮的点击响应，采用 HTML 模板统一注入 + MutationObserver 兜底的混合方案。

### 架构

```
┌───────────────────────────────────────────────────┐
│              CardInteractionBridge                  │
├───────────────────────────────────────────────────┤
│  [HTML 模板侧] 注入统一脚本（确定性主路径）         │
│  ├─ 所有按钮统一用 data-action-key 属性             │
│  ├─ data-user-prompt / data-params 序列化在属性中   │
│  ├─ 模板渲染时自动注入 bridge.js 点击监听脚本        │
│  └─ 点击 → postMessage({ type:'flattalk_card_action'│
│       action_key, user_prompt, params, skill_key }) │
│                                                     │
│  [前端 mobile.js 侧] 通用分发 + Observer 兜底        │
│  ├─ message 监听器已改为通用分发（不限于白名单）     │
│  ├─ handleCardAction(payload) → 统一入口             │
│  │   ├─ execute_action=true → handleAssistantAction  │
│  │   ├─ 纯文本类 → handleFollowupSuggestion          │
│  │   └─ 导航类 → 卡片内 iframe 打开（不外跳）        │
│  └─ MutationObserver: 扫描渲染后卡片的 .action-btn   │
│      补绑点击（对动态渲染/未注入脚本的模板兜底）      │
└───────────────────────────────────────────────────┘
```

### 按钮交互分类

| data-action-type | 示例 | 处理方式 |
|---|---|---|
| `dispatch` | 查看完整方案、查看详情 | handleAssistantAction → POST /api/chat/action |
| `navigate` | 分类切换（全部/住/吃/游） | handleFollowupSuggestion → POST /api/chat/followup |
| `external_map` | 点击导航 | 卡片内 iframe 打开腾讯地图 URL，不外跳 |
| `form_submit` | 确认预约、提交预定 | handleAssistantAction 带 form_data → 后端处理 |
| `form_edit` | 修改信息 | 前端切换表单为编辑状态 |
| `cancel` | 取消 | 前端关闭当前卡片/表单 |

### 服务预约闭环

```
用户: "我要预约上门护理助浴服务"
  → service_order_form 卡片渲染
  → 用户填写表单
  → 点击"确认预约" (data-action-type="form_submit")
  → postMessage → handleCardAction
  → handleAssistantAction:
       action_key: 'find_service.order_submit'
       form_data: { service_name, contact_name, phone, time_slot }
  → 后端 action-dispatcher → runSkill → order-service SDK
  → 返回 order_status 卡片
```

### 改动文件

| 文件 | 改动 |
|---|---|
| 新增 `src/public/card-bridge.js` | 注入到所有卡片 iframe 的通用点击脚本 |
| 新增 `src/core/render/bridge-injector.js` | 渲染时自动将 bridge.js 注入 iframe srcdoc |
| `src/template-card/index.js` | renderCard 时调 bridge-injector |
| `mobile.js` | postMessage 监听改为通用 handleCardAction；新增 MutationObserver |
| 所有 HTML 模板 | 按钮统一加 data-* 属性，移除内联 onclick |
| `service_order_form.html` | 表单增加"确认预约"按钮 data-action-type="form_submit" |

### 关键约束

1. bridge.js 在卡片 iframe 内执行，通过 `window.parent.postMessage` 与主应用通信
2. MutationObserver 只处理 `.action-btn[data-action-key]` 选择器，不监听所有点击
3. 导航按钮（external_map）改为卡片内 iframe 打开腾讯地图 URL（`https://apis.map.qq.com/...`）
4. 表单提交前做前端校验（必填字段），校验失败显示 inline 错误提示

## 6. 路由与 SOS 修复层

### 6.1 SOS 检测统一

**当前问题**：存在 3 套不一致的关键词表，且 `loadIntentContext` 的 request_override 分支跳过 emergency 检测。

**修复**：

```
loadIntentContext (chat-orchestrator.js L457-462)
  → 在 request_override 分支之前，强制执行 detectEmergency
  → 若检测到 SOS → 立即返回 intent_type='SOS', urgency_level='P0'
  → 否则才走 request_override
```

同时统一关键词表：supervisor.js 的 `SOS_TERMS` 复用 `emergency-detector.js` 的 `LEVEL_1` + `LEVEL_2`，不再维护两份。

### 6.2 场景路由防窜

| 问题 | 修复 |
|---|---|
| **elder-policy 权重失衡** | service_intent 降权 2.5→1.5（已修），threshold 6→8（已修） |
| **skill_key 黏性覆盖** | acceptScene 的 forced 路径增加 guard：若 matchScore < 0.2 则放弃 forced，走正常路由 |
| **previous_scene 延续** | 在 app.js 的普通消息路径也设置 `previous_turn_id`，让场景延续逻辑对所有消息生效 |

### 6.3 JSON Schema 注入

每个模板的 `.manifest.json` 新增 `data_schema` 字段，包含字段类型、嵌套结构、示例值。

`buildTemplateFields` 读取 `data_schema` 注入提示词，LLM 拿到精确字段类型和示例值。

优先补 24 个高频/缺失模板，其余分批补齐。

### 改动文件

| 文件 | 改动 |
|---|---|
| `chat-orchestrator.js` L457 | loadIntentContext 在 override 前强制跑 detectEmergency |
| `supervisor.js` L10 | SOS_TERMS 改为复用 emergency-detector 的 LEVEL_1+LEVEL_2 |
| `chat-orchestrator.js` acceptScene | forced skill_key 增加 matchScore guard |
| `app.js` | 普通消息也设置 previous_turn_id |
| 63 个 `.manifest.json` | 分批补 data_schema（优先 24 个高频模板） |
| `template-card-llm-service.js` buildTemplateFields | 读取 data_schema 注入 |

## 7. 模板完善与追问去重

### 7.1 前导图片为空修复

每个 skill 的 manifest 新增 `default_images` 配置，模板渲染时若 `image_url` 为空自动补默认图。

### 7.2 追问去重强化

`interaction-composer.js` 的去重逻辑从仅匹配 `action_key` 升级为双维度去重：
- 维度 1：`action_key` 精确匹配（现有）
- 维度 2：`user_prompt` 文本相似度匹配（新增）— 归一化后完全相同则过滤

### 7.3 模板配色统一

所有模板引用统一色板常量，确保兜底模板配色与主应用一致。

### 改动文件

| 文件 | 改动 |
|---|---|
| 7 个 `manifest.json` | 新增 `default_images` 字段 |
| `template-card-renderer.js` | 渲染前 image 空值补默认 |
| `interaction-composer.js` L288 | 去重逻辑增加 user_prompt 维度 |
| 3-5 个 HTML 模板 | 配色统一 |

## 8. 统一色板

| 用途 | 色值 |
|---|---|
| 主色 | `#2f6f4e` |
| 辅助色 | `#6B9B7A` |
| 背景色 | `#FAF8F5` |
| 强调色 | `#3a7d5c` |
| 边框色 | `#e0e0e0` |

## 9. 测试策略

### 单元测试（确定性）

- ConversationContextManager: buildHistory/过滤/switchAgent
- SmartFallbackHandler: shouldFallback/generateNaturalAnswer
- CardInteractionBridge: postMessage 分发/MutationObserver
- SOS 检测: request_override 不跳过 emergency
- 路由防窜: forced skill_key guard/margin check

### 集成测试（mock 模式）

- 全部 7 个技能的多轮对话场景
- LLM 失败 → smart fallback 链路
- 卡片按钮点击 → 后端 dispatch
- SOS 输入 → 应急卡片

### 手动验收

- 按用户提供的完整测试清单逐项验证
