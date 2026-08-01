# flatTalk 业务流程稽核报告

> **版本**：v1.0
> **日期**：2026-08-01
> **范围**：主流程、次流程、旁路全链路
> **方法**：四路并行代码稽核（入口层/编排层/交互层/数据层）

---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP 入口层 (app.js)                       │
│  42 个路由 · 无中间件 · 无鉴权(仅 1 个端点例外)               │
│  3 个核心路由: /message · /followup · /action                │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│              编排器 (chat-orchestrator.js)                    │
│  16 步主流程 · 4 条旁路短路 · 3 路分支模板填充               │
│  顶层 try-catch + 各步骤独立容错 + 多层降级链                │
└──────────┬──────────────────────────────────────────────────┘
           │
     ┌─────┴─────┬──────────┬───────────┐
     ▼           ▼          ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│场景路由  │ │知识检索  │ │业务数据  │ │模板填充  │
│7套规则集 │ │本地+远程 │ │按场景分发│ │LLM/本地 │
│纯评分   │ │三层降级  │ │6类来源   │ │三路分支 │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
     │           │          │           │
     └─────┬─────┴──────────┴─────┬─────┘
           ▼                      ▼
    ┌────────────┐        ┌────────────┐
    │交互组装器   │        │卡片渲染器   │
    │actions≤4   │        │Mustache渲染│
    │followups≤6 │        │三层降级兜底│
    │compact去重 │        │compact注入 │
    └────────────┘        └────────────┘
           │                      │
           └──────────┬───────────┘
                      ▼
               ┌────────────┐
               │ Envelope   │
               │ 响应信封    │
               └────────────┘
```

---

## 二、主流程（POST /api/chat/message）

### 2.1 完整 16 步链路

> ⚠ **说明**：代码无"16步"显式定义。此表按主路径函数调用顺序分解，其中步骤3为条件短路、步骤9为条件触发、步骤11为三选一互斥分支，并非严格线性执行。

| 步骤 | 函数 | 行号 | 说明 | 调LLM | 失败降级 |
|------|------|------|------|-------|---------|
| 1 | normalizeRequest | L64 | 规范化输入字段 | ❌ | — |
| 2 | loadIntentContext | L66 | 意图识别(规则→BERT→TextCNN) | ✅可降级 | 降级到纯规则 |
| 3 | **SOS短路** | L70-123 | 紧急检测→直接渲染 | ❌ | — |
| 4 | identifyScene | L125 | 7套规则集评分 | ❌ | 场景被拒→common |
| 5 | acceptScene | L127 | 场景接受/强制/延续 | ❌ | null→common兜底 |
| 6 | resolveSkillTemplates | L129 | 加载模板目录 | ❌ | — |
| 7 | retrieveMultiKnowledge | L130-141 | 本地+远程RAG | ❌ | 远程失败→空evidence |
| 8 | loadBusinessData | L142 | 按场景加载业务数据 | ❌ | JTD/YZ365不可用→标记 |
| 9 | 城市提取 | L145-160 | 仅travel_route | ❌ | 失败→默认城市 |
| 10 | selectRoutedTemplateId | L161 | 场景→模板映射 | ❌ | — |
| 11 | **三路分支填充** | L166-251 | 天气/兜底/标准 | ✅/❌ | LLM超时→本地fill |
| 12 | loadStaticFollowups | L252 | 读admin编辑的追问 | ❌ | 文件不存在→[] |
| 13 | composeInteractions | L253 | 组装交互组件 | ❌ | — |
| 14 | renderTemplateCardResult | L254-261 | Mustache渲染 | ❌ | 渲染失败→fallback_error |
| 15 | buildEnvelope | L264-294 | 封装响应 | ❌ | — |
| 16 | trace日志 | L296-303 | 可观测性 | ❌ | 写入失败静默 |

### 2.2 关键决策点

**意图识别（步骤2）**：
```
请求直传intent → 直接返回(跳过识别)
  ↓ 无
注入分类器 → 使用它
  ↓ 无
classifyIntent → 规则匹配优先
  ↓ SERVICE命中且高置信
直接返回(不调LLM)
  ↓ 不够
BERT-base模型 → 置信度足够?
  ↓ 不够
TextCNN模型 → 取两者更高
  ↓ 全失败
纯规则兜底
```

**场景路由（步骤4-5）**：
```
7套规则集并行评分
  ↓
top1.confidence >= 0.85 且领先第二名 >= 0.2
  → accept(接受)
  → review(审查)
  → reject(拒绝)
  ↓
acceptScene 三层优先级（L360-388）:
  ① 强制skill_key → request携带skill_key且目录存在 → 直接接受(confidence:1, forced:true)
  ② 场景延续 → 仅当当前评分=reject 且 previous_turn_id存在 且 reenter_chat≠true
     → 沿用上轮场景(confidence≥0.86, continued:true, intent标记.followup)
     ⚠ 注意：延续是reject的兜底，不是无条件续接；若新消息被识别为accept则走新场景
     ⚠ previous_turn_id仅作布尔门控，不校验数值一致性
  ③ 正常接受 → sceneDecision.decision==='accept'才返回
  ④ 全不中 → null → 调用方L128兜底 skillKey='common'
```

**三路分支模板填充（步骤11）**：
```
分支A: 天气风险动作(travel_route.check_weather_risk)
  → 调天气API → 本地组装(fillTravelWeatherRisk)
  → 不调生成式LLM

分支B: 按钮动作通用兜底(其他action_key)
  → 查action-resource-map → 检索知识库
  → 调modelService.fillFallback (LLM调用)
  → 未实现 → 降级到fillTemplateSlots

分支C: 标准模板填充(最常见路径)
  → modelService.fillTemplateSlots
  → LLM路径(template-card-llm-service) → 8s超时
  → 降级 → 本地fill函数(model-service.js)
```

### 2.3 降级链总结

```
LLM不可用 → 规则意图匹配
BERT失败 → TextCNN → 纯规则
fillFallback未实现 → fillTemplateSlots
LLM超时(8s) → 本地fill*Card
天气API失败 → degraded卡片(通用提醒)
云诊365不可用 → 本地模拟数据
金跳动不可用 → fillRouteRemoteGap
知识库无命中 → 空evidence,模型仍可填充
模板无匹配 → answer.html通用模板
渲染异常 → fallback_error.html
```

---

## 三、次流程

### 3.1 Action 动作流程（POST /api/chat/action）

```
用户点击action按钮
  → handleChatAction(app.js L116)
  → dispatchAction(action-dispatcher.js)
  → classifyAction 分类:
      ├─ client_only → 前端处理,不调后端(无turn记录)
      ├─ server_skill → runLocalSkill → orchestrator(完整主流程)
      │                → orchestrator内session-store.js写turn记录
      ├─ external_api → 当前跳过(返回external_api_skipped, 未配置适配器)
      └─ invalid → 400错误
  ⚠ dispatcher本身无状态,turn写入由server_skill触发的orchestrator链路完成
```

**action_key → template_id 映射表**（templateIdFromAction L65-105，硬编码分层分支）：

| 技能前缀 | action_key | 目标模板 | 备注 |
|---------|-----------|---------|------|
| sos. | call_120 / notify_family / im_safe | service_emergency | L66 |
| meal_plan. | generate_weekly_plan | weekly_plan | L67 |
| travel_route. | check_weather_risk | travel_weather_risk_card | L68 |
| travel_route. | 其他 | route_card | 可被params.template_id覆盖 |
| health_risk_warning. | refresh_signals | health_risk_signal_card | |
| health_risk_warning. | view_rule_detail | health_risk_rule_card | |
| health_risk_warning. | 其他 | health_warning_card | 可被params覆盖 |
| find_service. | catalog | service_catalog | |
| find_service. | list_orgs / book_org | org_profile | |
| find_service. | list_workers / book_worker | worker_profile | |
| find_service. | confirm_order / edit_order | order_preview | |
| find_service. | detail_order | order_status | |
| find_service. | 其他 | service_recommend | 可被params覆盖 |
| dispatch_manage. | detail / accept / reject / reassign | dispatch_detail | |
| dispatch_manage. | work_order | work_order | |
| dispatch_manage. | status / urge | dispatch_status | |
| dispatch_manage. | 其他 | dispatch_list | 可被params覆盖 |
| nearby_resource. | compare | nearby_compare | |
| nearby_resource. | recommend | nearby_recommend | |
| nearby_resource. | route | nearby_map_route | |
| nearby_resource. | radar | nearby_radar | |
| nearby_resource. | wellness | nearby_wellness | |
| nearby_resource. | summary | nearby_summary | |
| nearby_resource. | spot | nearby_map_category | |
| nearby_resource. | stay | nearby_stay_card | |
| nearby_resource. | food | nearby_food_card | |
| nearby_resource. | 其他 | nearby_list | 可被params覆盖 |

⚠ 每个前缀分支均支持 `params.template_id` 优先覆盖硬编码默认值（L104兜底）

### 3.2 Followup 追问流程（POST /api/chat/followup）

```
用户点击追问按钮
  → handleChat(followup:true)
  → 注入context: previous_scene + previous_turn_id
  → runLocalSkill → 完整16步orchestrator重跑
  → acceptScene场景延续 → 沿用上轮场景
```

**注意**：followup 不是轻量接口，而是完整的 skill 重跑。

### 3.3 交互组装逻辑

**三层数据源合并**：

| 组件 | 来源1 | 来源2 | 来源3 | 上限 |
|------|-------|-------|-------|------|
| actions | modelResult.actions | DEFAULT_ACTIONS_BY_SCENE | — | 4个 |
| followup_suggestions | staticFollowups(admin文件) | modelFollowups | FOLLOWUP_POLICIES(默认) | 6个 |
| compact_followups | modelResult.compact_followups | — | — | 无限制 |

**互斥去重三规则**（compact vs message followups）：
1. action_key相同 → 剔除message侧
2. label Jaccard相似度≥0.3 → 剔除message侧
3. 互逆动作对(收藏/取消收藏等4对) → 剔除message侧

---

## 四、旁路

### 4.1 SOS 紧急短路

```
触发: intent_type==='SOS' 或 urgency_level==='P0'
  ↓
跳过: 场景路由/知识检索/业务数据加载
直接: skill_key=find_service, template_id=service_emergency
  → fillServiceEmergencyCard(本地)
  → composeInteractions + renderTemplateCardResult + buildEnvelope
标记: debug.sos_bypass = true
```

### 4.2 请求直传意图

```
触发: request.intent已存在(如followup按钮)
  ↓
跳过: 意图识别全流程(规则+BERT+TextCNN)
直接: 返回{intent, source:'request_override'}
```

### 4.3 强制场景路由

```
触发: request.skill_key存在且对应目录存在
  ↓
跳过: 场景路由评分逻辑
直接: 强制accept(confidence:1, forced:true)
```

### 4.4 场景被拒跳过知识检索

```
触发: acceptedScene === null
  ↓
跳过: retrieveMultiKnowledge
直接: {status:'skipped', matches:[]}
```

---

## 五、数据层完整链路

### 5.1 模板填充决策树

```
fillTemplateSlots(input)
  │
  ├─ modelMode == 'mock'?
  │   YES → 本地fill(model-service.js)
  │
  ├─ modelMode == 'admin'?
  │   YES → LLM路径(template-card-llm-service.js)
  │          ├─ 生成动态template_fields
  │          ├─ LLM调用(8s超时)
  │          ├─ sanitizeShape校验
  │          └─ 失败 → 降级本地fill
  │
  └─ 本地fill分发:
      selectTemplateId(正则规则)
        ├─ weekly_plan → fillWeeklyPlan
        ├─ diet_card → fillDietCard
        ├─ route_card → fillRouteCard
        ├─ nearby_* → fillNearbyResourceCard(12种子模板)
        ├─ health_warning* → fillHealthWarningCard
        ├─ policy_card → fillPolicyCard
        ├─ travel_weather_risk → fillTravelWeatherRiskCard
        ├─ service_* → fillFindServiceCard(6种子模板)
        ├─ dispatch_* → fillDispatchManageCard(4种子模板)
        └─ 不匹配 → answer通用兜底
```

### 5.2 模板渲染链路

```
modelResult + interactions
  │
  ├─ renderCompactFollowups() → HTML胶囊按钮
  │
  ├─ buildRenderData() → 合并数据
  │   └─ compact_followups = HTML字符串
  │
  ├─ renderCard(templateDir, {template_id, data})
  │   ├─ discoverTemplates → 扫描*.html
  │   ├─ selectTemplate → 精确匹配/字段覆盖/fallback
  │   └─ renderTemplate → Mustache子集渲染
  │       ├─ {{var}} → HTML转义
  │       ├─ {{{var}}} → 不转义(compact_followups用此)
  │       ├─ {{#section}}...{{/section}} → 条件/循环
  │       └─ {{var|default}} → 兜底值
  │
  └─ 三层降级:
      ① 正常渲染
      ② no-match/low-coverage → answer.html
      ③ 渲染异常 → fallback_error.html
```

### 5.3 知识检索三层架构

```
retrieveMultiKnowledge(skill_keys)
  │
  ├─ 本地检索(vector-store.js)
  │   └─ token匹配打分(非向量嵌入)
  │
  ├─ 远程检索(remote-knowledge-adapter.js)
  │   ├─ travel_route本地优先
  │   ├─ 远程集合查询(按skill选collections)
  │   └─ QA兜底(语义搜索+bigram打分)
  │
  └─ 合并: 本地优先 + 远程补充, 按score降序, top N
```

### 5.4 业务数据六类来源

| 场景 | 数据来源 | 远程接口 |
|------|---------|---------|
| meal_plan | meal_rules表 + diet_contraindications表 | — |
| travel_route | routes表 + 产品上下文 | 金跳动JTD产品API |
| health_risk | business_scenes表 + 远程体检 | 云诊365 API |
| find_service | 4张表(服务/机构/人员/订单) | — |
| dispatch_manage | 3张表(派单/订单/人员) | — |
| nearby_resource | 静态389条JSON + 三层富化 | 腾讯地图 + Tavily |

---

## 六、发现的问题与风险

### 6.1 架构问题

| # | 严重度 | 问题 | 影响 | 根因 |
|---|--------|------|------|------|
| A1 | **高** | **全端点无鉴权**（42个路由仅1个有API Key校验） | 任何人可直接调用所有API | app.js无中间件层 |
| A2 | **高** | **规范与实现不一致**：LLM两阶段架构(prompt.js)从未被核心层调用 | 模板选择和数据填充全部走本地规则 | model-service.js绕过了template-card的LLM工具链 |
| A3 | **中** | **followup端点是完整重跑**，非轻量追问 | 每次追问都走完整16步+LLM调用，延迟高 | 复用handleChat而非独立轻量接口 |
| A4 | **中** | **readJson无大小限制** | DoS风险（恶意大body） | 无body-size中间件 |
| A5 | **低** | **同步文件日志**（appendFileSync） | 高并发下IO瓶颈 | 每请求同步写文件 |
| A6 | **低** | **静态文件无ETag/压缩** | 带宽浪费 | serveFile用readFileSync |

### 6.2 流程问题

| # | 严重度 | 问题 | 影响 | 位置 |
|---|--------|------|------|------|
| P1 | **高** | **17个测试失败**（travel_route场景路由分类错误） | "百色巴马旅游"被识别为query而非plan | scene-router规则评分 |
| P2 | **中** | **skill_configs的scene_thresholds未被使用** | 各技能独立阈值配置形同虚设 | router始终用DEFAULT_THRESHOLDS |
| P3 | **中** | **external_api动作类型被跳过** | 所有非技能动作无实际处理 | adapter未配置 |
| P4 | **中** | **compact_followups仅在本地fill生成**，LLM路径不生成 | LLM解锁后卡片紧密追问消失 | LLM prompt未包含compact_followups概念 |
| P5 | **低** | **route_card.html无{{{compact_followups}}}占位符** | fillRouteCard生成的compact_followups数据被丢弃 | 模板遗漏 |

### 6.3 数据问题

| # | 严重度 | 问题 | 影响 |
|---|--------|------|------|
| D1 | **中** | **知识库vector-store非向量嵌入**，用token匹配 | 检索精度有限，语义近似查询效果差 |
| D2 | **低** | **nearby_resource三层富化链路长** | 富化失败时降级为原始数据(可接受) |
| D3 | **低** | **城市提取独立try-catch** | 失败默认"防城港"，可能不符合用户意图 |

---

## 七、文件索引

### 核心文件

| 层 | 文件 | 职责 |
|----|------|------|
| HTTP入口 | [app.js](file:///D:/GuiCare/flatTalk/src/app.js) | 42个路由分发 |
| 运行时 | [local-skill-runtime.js](file:///D:/GuiCare/flatTalk/src/runtime/local-skill-runtime.js) | orchestrator薄封装 |
| 编排器 | [chat-orchestrator.js](file:///D:/GuiCare/flatTalk/src/core/orchestrator/chat-orchestrator.js) | 16步主流程 |
| 场景路由 | [scene-router/index.js](file:///D:/GuiCare/flatTalk/src/core/scene-router/index.js) | 7套规则集评分 |
| 意图识别 | [intent-classifier/index.js](file:///D:/GuiCare/flatTalk/src/core/intent-classifier/index.js) | 规则+BERT+TextCNN |
| 模型服务(本地) | [model-service.js](file:///D:/GuiCare/flatTalk/src/core/model-service.js) | 15+个fill*Card函数 |
| 模型服务(LLM) | [template-card-llm-service.js](file:///D:/GuiCare/flatTalk/src/core/model-runtime/template-card-llm-service.js) | LLM模板填充+降级 |
| 交互组装 | [interaction-composer.js](file:///D:/GuiCare/flatTalk/src/core/interaction-composer.js) | actions/followups/compact组装 |
| 紧密追问 | [renderer.js](file:///D:/GuiCare/flatTalk/src/core/compact-followups/renderer.js) | 胶囊HTML+互斥去重 |
| 动作分发 | [action-dispatcher.js](file:///D:/GuiCare/flatTalk/src/core/actions/action-dispatcher.js) | 分类+分发 |
| 卡片渲染 | [template-card-renderer.js](file:///D:/GuiCare/flatTalk/src/core/render/template-card-renderer.js) | compact注入+Mustache |
| 模板引擎 | [render.js](file:///D:/GuiCare/flatTalk/src/template-card/render.js) | Mustache子集 |
| 知识检索 | [retriever.js](file:///D:/GuiCare/flatTalk/src/services/knowledge-data/retriever.js) | 本地+远程RAG |
| 远程知识 | [remote-knowledge-adapter.js](file:///D:/GuiCare/flatTalk/src/services/knowledge-data/remote-knowledge-adapter.js) | 三层降级检索 |
| 业务数据 | [repository.js](file:///D:/GuiCare/flatTalk/src/services/table-data/repository.js) | 14张表+PG/内存双模 |

---

*报告结束*
