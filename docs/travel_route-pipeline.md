# travel_route 技能全链路说明（用户数据 → 手机端展示）

> 适用范围：旅居养老路线规划技能 `src/skills/travel_route`
> 目标：从「用户数据来源」到「手机端最终展示」逐环节拆解，并列出所有涉及的模块、模板、数据文件与外部服务资源。
> 阅读对象：开发、联调、运维、产品。

---

## 1. 链路总览

```text
[手机端 mobile.js]
    │  用户输入（消息 / 动作）
    │  POST /api/chat/message
    ▼
[后端 app.js / admin] handleChat → runLocalSkill
    │
    ▼
[local-skill-runtime.js] 装配依赖（ragService / dataService / modelService / scene）
    │
    ▼
[chat-orchestrator.js] run()
    ├─ ① 意图识别   loadIntentContext / normalizeRequest
    ├─ ② 场景路由   identifyScene → acceptScene  (scene_key = travel_route)
    ├─ ③ 技能解析   resolveSkillTemplates  (加载 8 个 HTML 模板库)
    ├─ ④ 知识检索   retrieveKnowledge（本地知识库优先：技能专属+common 兜底在前，远程补充）
    ├─ ⑤ 业务数据   loadBusinessData → getTravelRouteTables + jtd.buildRouteProductContext
    ├─ ⑥ 模板填充   modelService.fillTemplateSlots → fillTravelItineraryCard / 通用渲染
    └─ ⑦ 卡片渲染   renderTemplateCardResult → template-card-renderer → buildHtmlFallback
    │
    ▼  返回 envelope.rendered_html
[后端] fallbackHtml = env.rendered_html
    │
    ▼
[手机端 mobile.js] fetchJson → handleRemoteResult → renderSafeHtmlFallback
    │  sanitizeHtmlCard（校验 marker / 剥离 <script> / on*）
    │  updateLastAiBubble → html-card-bubble 注入 <iframe srcdoc>
    ▼
[手机浏览器] 沙箱 iframe 内渲染行程卡（tab 切换交互生效）
```

| 环节 | 入口函数 | 主要输入 | 主要输出 | 关键资源 |
|---|---|---|---|---|
| ① 意图识别 | `loadIntentContext` / `normalizeRequest` | 用户消息、角色、elderScope | `intent_context`、归一化文本 | `assets/source-copies/data/*`（tag/keyword/role-skill 等） |
| ② 场景路由 | `identifyScene` → `acceptScene` | intent_context | `scene_key=travel_route`、confidence | scene 配置、规则 |
| ③ 技能解析 | `resolveSkillTemplates` | skill_key | 模板库（8 卡）、defaultTemplateId | `src/skills/travel_route/templates/html/*` |
| ④ 知识检索 | `retrieveKnowledge` → `retrieveMultiKnowledge` | skill_key(+required_knowledge)、query、filters | 本地优先合并的 knowledge.matches（标注 origin） | `knowledge-data/retriever.js`（本地向量库）+ 远程 RAG（启用时） |
| ⑤ 业务数据 | `loadBusinessData` | sceneDecision、request | 康养线路表 + jtd 产品上下文 | `data-service` + `jtd-service`（金通道） |
| ⑥ 模板填充 | `fillTemplateSlots` | message、library、evidence、business_data | `template_id` + `data{}` | `model-service` / 模型 |
| ⑦ 卡片渲染 | `renderTemplateCardResult` | templateDir、modelResult | `rendered_html`（`<article><iframe>`） | `template-card-renderer` / `render.js` |
| ⑧ 手机展示 | `sanitizeHtmlCard` | rendered_html | 沙箱 iframe 内卡片 | `src/public/mobile.js` |

---

## 2. 环节 0：用户数据来源

travel_route 的「用户数据」由三类组成：

### 2.1 请求上下文（入口）
来自手机端 `mobile.js` 的对话/动作请求，结构体（`chat-orchestrator.js` `run(request)`）：

```text
request = {
  message,            // 自然语言：用户偏好 / 需求
  action,             // 若为动作型请求（如“查看 D3 详情”），kind = 'action'
  role, roleKey,      // 角色：家属 / 长者 / 管家
  elder_id, elderScope, // 长者范围（用于过滤知识库 / 业务数据）
  conversation_id, turn_id, request_id,
  template_id,        // 可强制指定模板
  context             // 历史上下文（elder_id 等）
}
```

### 2.2 用户画像 / 业务数据
- **康养线路表**：`loadBusinessData`（`chat-orchestrator.js` L240-268）对 `travel_route` 调用 `dataService.tableData.getTravelRouteTables()`，返回本地康养线路静态表。
- **旅居产品（金通道）**：`dataService.travelData.jtd.buildRouteProductContext(request)` 从「金通道(jintiaodong)」接口或 mock 拉取旅居产品（巴马/北海等），按 `request.region` / `elder_id` 选词匹配。
- **长者健康档案**：`loadBusinessData` 中 `meal_plan` 才用 `getMealPlanTables`；travel_route 当前不直接消费 elderProfile，仅在模型 `answer_text` 中可被引用。

> 数据服务装配见 `src/services/data-service.js`：
> `tableData` / `knowledgeData` / `interfaceData` / `travelData.jtd`。

### 2.3 知识库（本地优先检索）
各技能在知识检索环节**统一插入「本地知识库优先」检索**：
- 入口 `retrieveKnowledge`（`chat-orchestrator.js`）→ 多技能合并 `retrieveMultiKnowledge` → `ragService.retrieveKnowledge` → `knowledge-data/retriever.js`。
- **本地优先策略**（`retriever.retrieve`）：先按「技能专属 `skill_key` + `common` 通用」检索本地向量库（`chunkStore` / `vectorStore`），命中结果排在前面；远程知识库（`remote-knowledge-adapter`）**仅在启用时**作为补充，排在本地的后面。
- 多技能合并（`retrieveMultiKnowledge`）仍保持本地优先：`origin=local` 在前、`origin=remote` 在后，同类按 score 降序；最终 `source='local_first'`，并汇总 `local_status` / `remote_status` / `remote_error`。
- 本地知识来源：`assets/source-copies/data/kb/knowledge.json`（按 `skill_key` 归属，如 `policy_consult` / `find_service` / `dispatch_manage` 等），以及 `skill-packages/.../knowledge_docs/{business,dialogue,trace_route}` 的 markdown 文档（`common` / `trace_route`）。
- 远程知识库：由 `FLATTALK_KB_*` 配置，默认 `enabled=false`（即纯本地优先）；启用后按技能选择 collections（如 `meal_plan` → 膳食知识库）。

---

## 3. 环节 ②：场景识别与路由

- `identifyScene`（规则 + intent_context）→ 返回 `sceneDecision { scene_key, decision, confidence, routed }`。
- `acceptScene(request, sceneDecision)` 落定 `acceptedScene`，`skillKey = acceptedScene.scene_key || 'common'`。
- travel_route 在 scene / intent 配置中通过关键词（旅居、路线、巴马、防城港…）被识别为 `travel_route`。
- 路由结果进入 `envelope.route`（场景、决策、置信度、是否 routed、模板原因、知识/模型/渲染状态），并被写入 trace 日志。

---

## 4. 环节 ③：技能解析与模板库

`resolveSkillTemplates(skillKey)`（`chat-orchestrator.js` L276-297）：
- 定位 `src/skills/travel_route/templates/html/` 下的 HTML 模板。
- `discoverTemplates()` 扫描得到 **8 个模板**，`manifest.default_template = 'travel_itinerary_card'`。
- 返回 `library = describeLibrary(templates)` 供模型选型。

### 模板清单（`src/skills/travel_route/templates/html/`）

| 模板 id | 用途 | layout | 填充方式 |
|---|---|---|---|
| `route_card` | 旅居路线概览 | — | 通用渲染（`buildTemplateCardResult`） |
| `travel_itinerary_card` | **每日行程明细（默认）** | vertical（tab 切换） | `fillTravelItineraryCard`（专用） |
| `travel_base_card` | 康养基地推荐（onboarding） | — | 通用渲染 |
| `travel_plan_summary_card` | 方案总结 | — | 通用渲染 |
| `travel_spot_card` | 景点卡 | — | 通用渲染 |
| `travel_medical_card` | 医疗资源卡 | — | 通用渲染 |
| `travel_need_summary_card` | 需求汇总确认 | — | 通用渲染 |
| `travel_transport_card` | 交通卡 | — | 通用渲染 |

> 预览文件：`templates/preview/travel_itinerary_card.preview.html`；示例数据：`templates/data/travel_itinerary_card.sample.json`。

> 注意：`fillTravelItineraryCard` **仅当** `selectedTemplateId === 'travel_itinerary_card'` 时触发。模板选型（`model-service.js` `selectTemplateId`）默认：消息含 travel 关键词且库含 `route_card` → 选 `route_card`；否则用 default `travel_itinerary_card`。

---

## 5. 环节 ④ + ⑤：知识检索与业务数据

- **知识检索（本地优先）**（`retrieveMultiKnowledge`，`chat-orchestrator.js`）：对每个技能（含 `required_knowledge`）调用 `retrieveKnowledge`，本地向量库（技能专属 + `common` 兜底）命中结果排在前面，远程（启用时）补充在后；返回 `knowledge.matches`（标注 `origin`）作为模型填充的 `evidence`，并附带 `local_status` / `remote_status` / `remote_error` 供 trace 与 admin 展示。
- **业务数据**（`loadBusinessData`，L249-264）：
  ```js
  const tableData = await dataService.tableData.getTravelRouteTables();
  const jtd = await dataService.travelData.jtd.buildRouteProductContext(request);
  // 返回 { ...tableData, jtd }
  ```
  `jtd.buildRouteProductContext`（`src/services/travel/jtd-service.js` `buildRouteProductContext`，≈L47-160）：
  - 生产模式：调用金通道接口 `/open/api/travel/search` 与 `/detail`，按 `request.region` / `elder_id` 关键词匹配产品，组装 `provider / required / products[] / selected_product / weatherRisk / medicalResources / warnings`。
  - Mock 模式（`JTD_USE_MOCK=true` 或接口不可达）：返回 `MOCK_PRODUCTS`（巴马长寿养生、北海银滩），`source_status='mock'`。

---

## 6. 环节 ⑥：模型填充模板槽位

入口 `modelService.fillTemplateSlots`（`src/core/model-service.js`）：

1. **模板选型** `selectTemplateId`：优先 `request.template_id` → intent_context.skill_key → travel 关键词命中 `route_card` → default `travel_itinerary_card` → `fallback`。
2. **专用填充** `fillTravelItineraryCard`（仅 `travel_itinerary_card`）：
   - 解析用户偏好：`parseTravelPreferences(message, request)`（天数 `daysCount`、节奏 `pace`、目的地 `destinations`、预算 `budget`、养生重点 `focus`）。
   - 选产品：`selectProduct(ctx, products, prefs)`（匹配目的地/价格/养生重点，含降级）。
   - 组装行程：以旅游路线为骨架，注入 `medicalTips`（基于 `product.medicalResources`）、`weatherNote`（基于 `product.weatherRisk`）、`tips`（按节奏）。
   - 返回 `{ template_id:'travel_itinerary_card', data:{title, intro, days:[...]}, answer_text, evidence }`。
3. **通用渲染** `buildTemplateCardResult`：当未走专用填充时，用正则占位符渲染（route_card / base_card 等）。

> 模型由 `model_registry` 配置（`src`/配置），默认如 `qwen-plus`；`fillTemplateSlots` 支持 `model_status` / `model_error` 回传，异常被记入 trace。

### 6.1 travel_itinerary_card 数据契约

模板占位符（`travel_itinerary_card.html` L39-112）：

```text
{{title|默认标题}}          字符串，缺省回退示例值
{{intro|默认导语}}          HTML 字符串（可含 <b>）
{{#days}}                  循环：每日
   {{day}}                  "D1"
   {{theme}}                当日主题
   {{#slots}}              循环：时段
      {{time}}              "上午" / "下午" / "傍晚"
      {{text}}             时段内容（可含 <b>）
   {{/slots}}
   {{tip}}                  当日健康提示（可含 emoji）
{{/days}}
{{note|默认备注}}           底部备注
```

交互脚本（L115-140）：`.day-tab` 点击切换 `.day-card` 面板（tab 切换）。数据块（L142-165+）为 `<script type="application/json">` 示例数据，渲染时被 `render.js` 提取为 `defaultData` 并**剥离出最终输出**，仅用于缺字段回退。

此外，行程卡底部内置 **「🌦️ 查看天气风险」按钮**（`travel_itinerary_card.html` L114-127）：
- 按钮 `data-city="{{destination|防城港}}"` 携带当前旅居目的地城市，由 `fillTravelItineraryCard` 的 `data.destination` 填充。
- 卡片内 `<script>`（L138-152）监听点击，通过 `window.parent.postMessage({ type:'gxy_card_action', action_key:'travel_route.check_weather_risk', city })` 把城市回传父窗口。
- 因卡片渲染在同源沙箱 iframe（`allow-scripts allow-same-origin`）内，`postMessage` 可触达手机端 `mobile.js`。

### 6.2 天气风险按钮 → 腾讯天气接口 全链路

点「查看天气风险」后的完整闭环：

1. **手机端桥接**（`mobile.js` 末尾 `message` 监听）：收到 `gxy_card_action` 且 `action_key==='travel_route.check_weather_risk'` 时，复用 `handleAssistantAction` 向 `/api/chat/action` 发送 `action_key=travel_route.check_weather_risk`、`skill_key=travel_route`、`params.city=目的地`。
2. **动作分发**（`action-dispatcher.js` server_skill）：映射到提示语「检查老人旅居路线天气风险」，回写 `runSkill`，携带 `context.action_key` 与 `context.action_params.city`。
3. **编排器分支**（`chat-orchestrator.js` run()）：识别 `action_key==='travel_route.check_weather_risk'` 后，**不再走常规模板填充**，而是：
   - `resolveWeatherCity`：优先取 `context.action_params.city`，否则从业务数据（金通道旅居产品 `destination`）推断，兜底「防城港」。
   - `weatherService.getWeather(城市)`：调用 **腾讯天气接口**（`https://apis.map.qq.com/ws/weather/v1/?city={城市}&key={TENCENT_MAP_KEY}`），返回实时天气 + 未来几天预报。
   - `fillTravelWeatherRisk`（model-service）：结合上下文与天气数据，由模型合成「天气风险研判」卡片。
4. **渲染返回**：`template_id='travel_weather_risk_card'`，渲染 `travel_weather_risk_card.html`（与行程卡同橙系风格，含当前天气、多日预报表、长者风险提示），手机端按既有流程注入 iframe 展示。

> 未配置 `TENCENT_MAP_KEY` 或接口异常时，`getWeather` 返回 `ok:false`，卡片自动进入降级说明（通用提醒），不阻断整条链路。

---

## 7. 环节 ⑦：本地卡片渲染

`renderTemplateCardResult`（`src/core/render/template-card-renderer.js`）：

1. `renderTemplateCard` → 先试 `discovered` 模板渲染，失败再 `fallback`。
2. `renderTemplatePage` 用 `render.js`（`src/template-card/render.js`）处理 `{{}}` / `{{#days}}` / `{{#slots}}` 循环与 `{{x|default}}` 默认值；`<script type="application/json">` 被提取并剥离，交互 `<script>` 保留进 iframe。
3. `buildHtmlFallback(pageHtml)` 包装为：
   ```html
   <article class="gxy-html-fallback" data-renderer="template-card-renderer">
     <iframe class="gxy-template-card-frame"
             sandbox="allow-scripts allow-same-origin"
             srcdoc="&lt;!doctype html&gt;...完整渲染结果...">
     </iframe>
   </article>
   ```
4. `rendered_html` = 上述 `<article>`。同时计算 `html_fallback = { height }`（自适应高度）。

> 该 marker（`gxy-html-fallback` + `data-renderer=`）是手机端 `sanitizeHtmlCard` 的放行前提。

---

## 8. 环节 ⑧：后端返回与手机端展示

### 8.1 后端
`handleChat` → `runLocalSkill` → `orchestrator.run()` 返回 `envelope`，其中 `fallbackHtml = env.rendered_html`。前端通过 `/api/chat/message` 的响应拿到 `fallbackHtml`。

### 8.2 手机端（src/public/mobile.js）
- `sendMessage`（≈L1759）→ `fetchJson('/api/chat/message')`（≈L1669）。
- `handleRemoteResult` → `renderSafeHtmlFallback(fallbackHtml)` → **`sanitizeHtmlCard`**（≈L303-339）：
  - 校验必须含 `gxy-html-fallback` 与 `data-renderer=`，否则返回空（防注入）。
  - `replace(/<script[\s\S]*?<\/script>/gi, '')` 剥离外层 `<script>`。
  - 移除所有 `on*=` 事件属性。
  - 提取 `<iframe srcdoc>` 转成 `data:text/html;base64` 形式的 `src`（避免转义串）。
- `updateLastAiBubble` 将处理后的 HTML 注入 `html-card-bubble`。
- 手机浏览器渲染沙箱 iframe：因 `sandbox="allow-scripts allow-same-origin"`，**iframe 内部的 tab 切换交互脚本可正常执行**，长者可在手机上点天数切换查看每日行程。

> 安全边界：外层文档树中的 `<script>` 被剥离；iframe `srcdoc` 内容以属性转义形式存在，不被外层正则误伤，且沙箱策略限定脚本执行范围。

---

## 9. 资源与依赖清单

### 9.1 代码模块

| 模块 | 路径 | 职责 |
|---|---|---|
| 技能入口 | `src/skills/travel_route/index.js` | 技能元信息与模板清单 |
| 技能清单 | `src/skills/travel_route/manifest.json` | `default_template`、`templates` |
| 编排器 | `src/core/orchestrator/chat-orchestrator.js` | run() 全链路埋点 + 路由 |
| 模型服务 | `src/core/model-service.js` | `fillTemplateSlots` / `fillTravelItineraryCard` / `fillTravelWeatherRisk` |
| 腾讯天气适配器 | `src/services/weather/tencent-weather.js` | `getWeather(city)` → 腾讯天气接口 |
| 数据服务 | `src/services/data-service.js` | `tableData` / `travelData.jtd` 等 |
| 金通道旅居 | `src/services/travel/jtd-service.js` | `buildRouteProductContext`（产品/天气/医疗） |
| 卡片渲染 | `src/core/render/template-card-renderer.js` | `renderTemplateCard` / `buildHtmlFallback` |
| 渲染内核 | `src/template-card/render.js` | 占位符/循环/默认值/默认数据提取 |
| 本地运行时 | `src/runtime/local-skill-runtime.js` | 装配依赖、调用 orchestrator |
| 后端入口 | `src/app.js`（`handleChat` / `runLocalSkill`） | HTTP 接口 |
| 手机端 | `src/public/mobile.js` | 发送请求 / `sanitizeHtmlCard` / 注入 iframe |
| 追踪日志 | `src/core/observability/trace-logger.js` | 每问题全环节 trace（北京时间倒序） |

### 9.2 数据 / 配置资源

| 资源 | 路径 | 用途 |
|---|---|---|
| 模板（9） | `src/skills/travel_route/templates/html/*.html` | 卡片渲染源（含 `travel_weather_risk_card`） |
| 模板清单 | `*.manifest.json` | layout / 字段描述 |
| 预览 | `templates/preview/travel_itinerary_card.preview.html` | 静态预览 |
| 示例数据 | `templates/data/travel_itinerary_card.sample.json` | 预览/缺字段回退 |
| 康养线路表 | `data-service.tableData.getTravelRouteTables()` 源 | 本地静态线路 |
| 旅居产品 | 金通道接口 / `MOCK_PRODUCTS` | 巴马/北海等产品 |
| 知识库 | `assets/source-copies/data/kb/knowledge.json` 等 | RAG 证据 |
| 契约/注册表 | `assets/source-copies/data/{business-system,tag-system,role-skill-matrix,keyword-registry-default}.json` | 场景/意图识别 |

### 9.3 外部服务

| 服务 | 配置 | 模式 |
|---|---|---|
| 模型（LLM） | `model_registry` / `.env` | 默认 qwen-plus |
| RAG 知识 | `ragService`（本地/远程） | 远程不可达时 `status='error'`，trace 记录 |
| 金通道旅居 | `JTD_*`（`src/services/travel/jtd-service.js` `JTD_CONFIG`） | 真实接口 / `JTD_USE_MOCK` mock |
| 腾讯天气 | `TENCENT_WEATHER_BASE_URL` + `TENCENT_MAP_KEY`（`src/services/weather/tencent-weather.js`） | 实时天气/多日预报；天气风险按钮调用；缺 key 自动降级 |

---

## 10. 配置与开关（.env 相关）

- `JTD_USE_MOCK=true`：旅居产品走 mock（巴马/北海），不依赖金通道接口。
- `JTD_BASE_URL` / `JTD_APP_KEY` / `JTD_APP_SECRET` / `JTD_AGENT_ID`：金通道真实接口鉴权。
- RAG / 模型相关：`ragService` 装配开关、模型选择（见 `model-service` 与 `.env`）。
- 模板强制：请求可带 `template_id` 直接指定卡片。
- 腾讯天气：`TENCENT_WEATHER_BASE_URL` / `TENCENT_MAP_KEY`（与腾讯地图共用）。缺省时「天气风险」卡片自动降级为通用提醒。

---

## 11. 可观测性：问题追踪日志

各环节耗时与路由已埋点（`chat-orchestrator.js` `run()` 内 `mark()`），每条问题写一条 trace 到 `data/query-trace.log`：

- 字段：`level`(ok/warn/error)、`kind`(chat/action)、`question`、`route`(场景/决策/置信度/已路由/模板原因/知识状态/模型/渲染状态)、`stages`(各环节 +ms)、`conversation_id`/`turn_id`/`request_id`。
- 时间：北京时间 `YYYY-MM-DD HH:mm:ss`（`trace-logger.js`）。
- 查看：admin 管理页「运行日志」→ 问题追踪卡片（倒序、含路由与全环节耗时），原始请求日志折叠在下方。

---

## 12. 异常与降级路径

- **场景未识别**：`decision='reject'` → skillKey='common'，走通用兜底模板。
- **知识检索（远程失败）**：本地命中仍可用；远程 `remote_status='remote_error'`、`remote_error` 记入 trace，模型仍可用 `business_data` 填充。`knowledge.status` 在本地为空且远程出错时为 `remote_error`。
- **金通道不可达**：`buildRouteProductContext` 回退 mock 或 `source_status='unavailable'` + `warnings`，卡片仍可渲染（缺产品信息）。
- **模型填充异常**：`model_error` 回传，trace `level='error'`；`render_status` 可能 `error`，前端展示文本兜底。
- **渲染器整体失败**：`renderTemplateCardResult` 抛错 → 走 `htmlFallbackError`，返回 `rendered_html=null`，前端显示 `answer_text` 纯文本。
- **手机端注入失败**：`sanitizeHtmlCard` 校验不通过返回空 → 仅显示文字回复，不崩。
- **腾讯天气不可用**：`getWeather` 返回 `ok:false`（如 `no_key` / `network_error` / `api_error`），`fillTravelWeatherRisk` 进入降级说明（通用提醒），不阻断链路。

---

## 13. 端到端最小验证清单

1. 手机端输入「帮我规划 10 天防城港旅居养老路线」。
2. 后端 trace 出现一条 `travel_route` 记录，stages 含 意图识别→场景路由→知识检索→业务数据→模板填充→卡片渲染→响应封装。
3. 返回 `rendered_html` 含 `gxy-html-fallback` + `data-renderer` + `<iframe srcdoc>`。
4. 手机端 `sanitizeHtmlCard` 放行，iframe 显示行程卡，点天数 tab 可切换。
5. admin「运行日志」可见该问题：北京时间倒序、路由字段完整、各环节耗时。
6. 知识检索环节的 trace 显示 `local_status`（如 `local_hit`）与 `remote_status`（默认 `disabled`，启用远程后 `remote_hit`/`remote_empty`）；路由区新增「本地知识 / 远程知识」字段，确认本地优先生效。
