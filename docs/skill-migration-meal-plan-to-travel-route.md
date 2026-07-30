# Skill Migration Notes: meal_plan -> travel_route

## meal_plan migration experience

1. Runtime shape first: every skill needs `manifest.json`, `index.js`, HTML templates, template manifests, sample data, and followups.
2. Routing is explicit: scene-router rules decide whether a user utterance enters the skill, including evidence groups, role boost, context continuation, conflicts, and intent inference.
3. Data is injectable: business tables and knowledge documents are seeded locally but accessed through `dataService`, so PG/remote backends can replace memory stores later.
4. Model output must be structured: mock/model runtime returns `template_id`, `answer_text`, `data`, `actions`, and `followup_suggestions`.
5. Rendering is template-card based: HTML prototypes become runtime cards through `discoverTemplates` and `renderTemplateCardResult`.
6. Actions and followups re-enter the main chain: supported server actions call `/api/chat/action`; unsupported/no-handler followups re-enter `/api/chat/followup` as user text.
7. Verification is layered: scene-router, runtime, app HTTP, data/schema, action dispatcher, mobile behavior, and template discovery all have tests.

## travel_route migration outcome

- Added `travel_route` skill runtime directory and `route_card` HTML template.
- Added `travelRouteRuleSet` to scene-router.
- Added local travel route table schema, seeds, service accessor, PG view, and SQL seeds.
- Added travel knowledge seed documents.
- Added route-card mock model filling with itinerary, highlights, health notice, actions, and followups.
- Added server action support and mobile action whitelist for travel route actions.
- Added route/followup/action/runtime/template/HTTP regression tests.

## health_risk_warning migration (added 2026-07-30)

复用上面 meal_plan / travel_route 的新模板规范把「健康风险预警」技能迁入 flatTalk。

### 改动清单
- 知识：`assets/source-copies/skill-packages/health_risk_warning/knowledge_docs/{business,dialogue}` 复制自源包；`buildSeedDocuments` 新增 `skill_key='health_risk_warning'` 两路读取（business + dialogue）。
- 技能运行时：`src/skills/health_risk_warning/{manifest.json,index.js}` + `templates/html/{health_warning_card,health_risk_signal_card,health_risk_rule_card}.{html,manifest.json}`（沿用 `route_card.html` 的 mustache + 内联 `<script type="application/json">` 默认数据模式）。
- 场景路由：`src/core/scene-router/rules/health-risk-warning.js`（`evidence_groups` / `role_boost.roles` / `context_boost` / `conflicts[].penalty` / `threshold` / `infer_intent` 真实结构），并在 `index.js` 注册 `RULE_SETS`、`executeHealthRiskWarningRuleSet`。
- 数据表：`schemas.js` 增加 `health_risk_warning_business`，`repository.js` DEFAULT_TABLES 加内存种子，`table-data/index.js` 增加 `getHealthRiskWarningTables`，并补 `seeds/health_risk_warning_business.sql`。
- 模型：`model-service.js` 增加 `isHealthRiskText` 与 `fillHealthWarningCard`（按消息推断等级/信号/规则/处置建议/下一步/远程缺口）；`template-card-llm-service.js` 的 `shouldUseDeterministicTemplate` 纳入 `health_risk_warning`（admin 模式下也走确定性 mock）。
- 动作：`action-dispatcher.js` 加入 `health_risk_warning.` 前缀、`templateIdFromAction`、`actionKeyToPrompt`；`interaction-composer.js` 的 `isActionAllowed` 支持通配符 `health_risk_warning.*`，并补默认动作；`chat-orchestrator.js` 的 `selectRoutedTemplateId` 与 `loadBusinessData` 增加 `health_risk_warning` 分支。
- 测试：`tests/scene-router-health-risk-warning.test.js`、`tests/local-skill-runtime-health-risk-warning.test.js`。

### 经验与教训（关键）
1. **scene-router 规则集必须严格匹配 `scoring-engine.js` 的字段结构**：`evidence_groups`（`{group,weight,terms}`）、`role_boost:{roles,weight}`、`context_boost:{previous_scene,weight,terms}`、`conflicts:[{group,penalty,terms}]`、`threshold`、`infer_intent(input)`。第一次误用 `evidence/requires/role_boost.B/conflicts.when` 的"想象结构"，导致分数为 0、请求被通用 `common` 兜底吞掉。务必先读 `travel-route.js` / `meal-plan.js` 真实文件，不要凭摘要重建。
2. **平局兜底顺序**：`identifyScene` 按 confidence 降序排序、稳定排序，与 `common` 同为 1 时较早注册的 `elderPolicyRuleSet` 胜出。把 `healthRiskWarningRuleSet` 排在 `elderPolicyRuleSet` 之前，确保"命中健康风险规则"的请求优先于通用兜底。`common` 规则里的 `帮我` 会误命中健康类请求，这是预期内的，靠顺序平局解决。
3. **HTML 卡片不要在外层再用 `{{#signals}}` 包整块**：mustache 的 `{{#signals}}` 会按数组长度重复整块；正确做法是只在行级用 `{{#signals}}` 迭代，标题/计数放根级（渲染器 `lookup` 会沿上下文栈向上查找根字段，所以 `{{signals_count}}` 在迭代内也能解析）。
4. **`renderTemplateCardResult` 的入参是 `{ templateDir, modelResult, ... }`**（`templateDir` 为 html 根目录，内部 `renderCard` 自行 discover），不是预构建的 `templateLibrary`。
5. **`interaction-composer.isActionAllowed` 原只做精确匹配**，与 `actions_allowed:['health_risk_warning.*']` 通配符不兼容；补了通配符后缀匹配（向后兼容 meal_plan/travel_route）。
