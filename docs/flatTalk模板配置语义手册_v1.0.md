# flatTalk 模板配置语义手册

> **版本**：v1.0（全面修订版）  
> **日期**：2026-08-01  
> **范围**：flatTalk 项目全部 7 个技能包、62 个模板、55 个意图、38 个 action_key  
> **用途**：产品 / 开发 / 测试参考，全面指导场景路由 → 意图识别 → 模板选择 → 追问联动的完整语义链路

---

## 目录

1. [总览与统计](#一总览与统计)
2. [评分引擎与阈值](#二评分引擎与阈值)
3. [场景转换管理](#三场景转换管理)
4. [消歧卡机制](#四消歧卡机制)
5. [追问策略体系](#五追问策略体系)
6. [meal_plan — 膳食规划](#六meal_plan--膳食规划)
7. [travel_route — 旅居路线规划](#七travel_route--旅居路线规划)
8. [health_risk_warning — 健康风险预警](#八health_risk_warning--健康风险预警)
9. [find_service — 养老服务发现与匹配](#九find_service--养老服务发现与匹配)
10. [dispatch_manage — 派单与工单调度](#十dispatch_manage--派单与工单调度)
11. [nearby_resource — 嘉路周边资源地图](#十一nearby_resource--嘉路周边资源地图)
12. [common — 政策咨询](#十二common--政策咨询)
13. [模板选择优先级矩阵](#十三模板选择优先级矩阵)
14. [附录](#十四附录)

---

## 一、总览与统计

### 1.1 技能包概览

| 技能包 | 中文名 | 模板数 | 意图数 | action_key | 阈值 | 运行时 |
|--------|--------|--------|--------|------------|------|--------|
| meal_plan | 膳食规划 | 5 | 9 | 2 | 5 | local |
| travel_route | 旅居路线规划 | 9 | 12 | 12 | 6 | local |
| health_risk_warning | 健康风险预警 | 7 | 7 | 5 | 4 | template-card |
| find_service | 养老服务发现与匹配 | 14 | 11 | 7 | 6 | local |
| dispatch_manage | 派单与工单调度 | 7 | 8 | 4 | 5 | local |
| nearby_resource | 嘉路周边资源地图 | 12 | 15 | 13 | 4 | local |
| common | 公共/政策咨询 | 5 | 6 | 0 | 6 | local |
| **合计** | — | **59+3公共** | **68** | **43** | — | — |

> 公共模板（answer / fallback_error / service_emergency / service_thinking 等）不计入单一技能包。

### 1.2 语义链路全景

```
用户输入
  │
  ├─ 紧急检测 (emergency-detector) ──→ SOS 短路（跳过场景评分）──→ service_emergency
  │
  └─ 场景路由 (scene-router)
       │
       ├─ 评分引擎 (scoring-engine)
       │    ├─ evidence_groups（证据组加权匹配）
       │    ├─ role_boost（角色加分）
       │    ├─ context_boost（上下文延续加分）
       │    └─ conflicts（跨场景冲突惩罚）
       │
       ├─ 场景转换管理 (scene-transition-manager)
       │    ├─ ROUTE（直接路由）
       │    ├─ AMBIGUOUS（消歧追问）
       │    ├─ FALLBACK（兜底 answer）
       │    └─ CONTINUE（延续旧场景）
       │
       ├─ 意图识别 (infer_intent)
       │
       ├─ 意图→模板映射 (intent-template-map)
       │
       └─ 追问+动作组合 (interaction-composer)
            ├─ FOLLOWUP_POLICIES（追问策略）
            ├─ DEFAULT_ACTIONS_BY_SCENE（场景默认按钮）
            └─ FollowupGuard（场景隔离，防串货）
```

---

## 二、评分引擎与阈值

### 2.1 决策阈值

| 阈值 | 值 | 含义 |
|------|-----|------|
| accept | ≥0.85 | 直接路由（accept） |
| review | ≥0.55 | 待审路由（review，单场景也路由） |
| margin | ≥0.2 | top 与 second 差值足够则可路由 |

### 2.2 评分公式

```
positive_score = Σ(evidence_groups命中权重) + role_boost + context_boost
confidence = clamp((positive_score - conflict_penalty) / threshold, 0, 1)
```

- `role_boost`：用户角色匹配场景时加分
- `context_boost`：上一轮场景匹配 + 延续词出现时加分
- `conflict_penalty`：命中其他场景冲突词时减分

---

## 三、场景转换管理

**文件**：`src/core/scene-router/scene-transition-manager.js`

### 3.1 TRANSITION_TYPE

| 类型 | 值 | 触发条件 |
|------|-----|---------|
| ROUTE | `route` | top 场景 accept/routed，直接路由 |
| AMBIGUOUS | `ambiguous` | top+second 均 review 且差值 < margin |
| FALLBACK | `fallback` | 全部场景 reject，走 answer 兜底 |
| CONTINUE | `continue` | 命中延续词（继续/换一个/再来等） |

### 3.2 SCENE_PRIORITY（同分排序）

```
1. health_risk_warning （最高优先）
2. find_service
3. dispatch_manage
4. nearby_resource
5. meal_plan
6. travel_route
7. common （最低）
```

### 3.3 CONTINUATION_TERMS（场景延续词）

```
继续、换一个、再来、下一个、上一个、再看看、还有呢、其他的、换一种、
再来一个、换个、再看、别的
```

---

## 四、消歧卡机制

**文件**：`src/core/scene-router/ambiguity-resolver.js`

当用户输入同时命中多个场景且差值不足时，系统生成消歧卡供用户选择。

### 4.1 SCENE_DESCRIPTIONS

| scene_key | 图标 | 标签 | 描述 |
|-----------|------|------|------|
| nearby_resource | 🗺️ | 查看周边 | 搜索嘉路15km生活圈 |
| meal_plan | 🍽️ | 膳食推荐 | 一日三餐/一周食谱 |
| travel_route | 🧳 | 旅居规划 | 康养旅居路线 |
| find_service | 🏥 | 养老服务 | 护工/机构/上门服务 |
| health_risk_warning | ❤️ | 健康预警 | 风险评估/预警报告 |
| dispatch_manage | 📋 | 工单调度 | 派单/工单/进度 |
| common | 💬 | 政策咨询 | 养老补贴/长护险 |

### 4.2 消歧卡工作流

```
用户输入 → 评分引擎 → top/second 均 review 且 margin < 0.2
                                    ↓
                        resolveAmbiguity(candidates)
                                    ↓
                     生成 answer 模板，附带 ambiguity_options[]
                                    ↓
                     前端渲染消歧卡（图标+标签+描述）
                                    ↓
                 用户点击按钮 → sendMessage(label) → 重新走场景路由
```

---

## 五、追问策略体系

### 5.1 FOLLOWUP_POLICIES 一览

| 策略 Key | 所属场景 | 追问选项数 | 说明 |
|----------|---------|-----------|------|
| common.policy | common | 3 | 补贴条件/办理材料/办理流程 |
| meal_plan.diet | meal_plan | 4 | 一周计划/慢病调整/软烂版/采购清单 |
| meal_plan.default | meal_plan | 3 | 一周食谱/今日三餐/换一天 |
| health_risk_warning.default | health_risk_warning | 3 | 重新读信号/规则命中/膳食调养 |
| travel_route.default | travel_route | 4 | 对比目的地/可订状态/调整预算/天气风险 |
| find_service.default | find_service | 2 | 找护工上门/看养老机构 |
| dispatch_manage.default | dispatch_manage | 2 | 查看工单/查看进度 |
| nearby_resource.default | nearby_resource | 3 | 只看医疗/周边餐馆/好玩的地方 |

### 5.2 FollowupGuard 场景隔离

`interaction-composer.js` 中的 `filterByScene(items, sceneKey)` 方法：

- 对追问选项和动作按钮按 `action_key` 前缀匹配当前场景
- 示例：meal_plan 场景只展示 `meal_plan.*` 前缀的 action_key
- 防止"膳食场景里出现旅居追问按钮"的串货问题

### 5.3 静态追问文件

| 文件 | 所属模板 | 追问数 |
|------|---------|--------|
| `diet_card.json` | diet_card | 3（生成一周/慢病调整/软烂版） |
| `weekly_plan.json` | weekly_plan | 1（慢病调整） |
| `route_card.json` | route_card | 3（对比/可订/预算） |

---

## 六、meal_plan — 膳食规划

### 6.1 场景参数

| 参数 | 值 |
|------|-----|
| scene_key | `meal_plan` |
| default_intent | `meal_plan_advice` |
| threshold | 5 |
| followup_policy | `meal_plan.default` |
| required_knowledge | `meal_plan`（慢病膳食知识库 + Tavily营养搜索） |

### 6.2 evidence_groups（证据组）

| 组名 | 权重 | 关键词 |
|------|------|--------|
| meal_topic | 3 | 膳食、饮食、饭菜、吃什么、食谱、菜谱、营养餐、配餐、助餐、老人餐 |
| meal_time | 2.5 | 早餐、午餐、晚餐、一周、七天、周计划、今天、每日、本周、下周 |
| health_condition | 2 | 糖尿病、血糖、低糖、控糖、高血压、低盐、痛风、肾病、便秘、吞咽 |
| meal_intent | 3 | 推荐、安排、计划、生成、搭配、调整、适合、怎么吃、能吃、不能吃 |
| elder_constraint | 1.5 | 老人餐、长者、爷爷、奶奶、爸妈、失能、半失能 |

### 6.3 context_boost

- previous_scene = `meal_plan`，weight = 5
- 延续词：换成、调整、改成、低糖版、清淡点、一周、明天、继续、再推荐

### 6.4 conflicts（冲突惩罚）

| 冲突场景 | penalty | 冲突词 |
|---------|---------|--------|
| travel_route | 4 | 路线、导航、怎么走、公交、巴马、北海 |
| find_service | 4 | 找护工、找机构、养老院、上门服务、护理员 |
| dispatch_manage | 5 | 派单、工单、调度、转人工、催单 |
| acute_health_risk | 3.5 | 胸痛、昏迷、呼吸困难、中风、急救、120 |
| nearby_resource | 3 | 周边、附近、地图、配套、民宿、餐厅 |

### 6.5 意图→模板映射

| intent | template_id |
|-------|-------------|
| meal_plan_weekly_plan | weekly_plan |
| meal_plan_overview | meal_overview_card |
| meal_plan_dashboard | meal_dashboard_card |
| meal_plan_timeline | meal_timeline_card |
| meal_plan_advice（默认） | diet_card |
| meal_plan_breakfast_advice | diet_card |
| meal_plan_lunch_advice | diet_card |
| meal_plan_dinner_advice | diet_card |
| meal_plan_condition_advice | diet_card |

### 6.6 模板清单（5个）

| 模板ID | 语义描述 | 布局 | 所需 slots |
|--------|---------|------|-----------|
| **diet_card** | 一日三餐完整膳食推荐（早/午/晚分餐/菜品/热量/营养配比/相关疾病推荐） | vertical | dateBadge, meals |
| **weekly_plan** | 一周七天三餐计划（每日热量/餐次图标/控糖低盐提醒/执行建议） | vertical | weekly_plan |
| **meal_overview_card** | 每日膳食总览（三栏概览：汇总卡+三餐分栏+营养比例条） | grid | meals, summaryTitle |
| **meal_dashboard_card** | 膳食数据仪表盘（画像卡+营养环+禁忌标签+明细表，管理端用） | grid | meals, profileName |
| **meal_timeline_card** | 时间线式膳食流程（按时间顺序纵向展示三餐，移动端友好） | vertical | meals, bannerTitle |

### 6.7 action_key 列表

| action_key | label | 目标模板 |
|------------|-------|---------|
| `meal_plan.generate_weekly_plan` | 生成一周计划 | weekly_plan |
| `meal_plan.adjust_for_condition` | 按慢病调整 | diet_card |

### 6.8 业务流程联动用户输入（15条）

以下 15 条输入模拟用户从膳食咨询到一周计划、慢病调整、总览查看的完整业务闭环：

| 序号 | 用户输入（≥10字） | 命中意图 | 目标模板 | 关联 action_key / 追问 |
|------|-------------------|---------|---------|----------------------|
| 1 | "我爷爷有糖尿病，今天三餐应该怎么吃比较好" | meal_plan_condition_advice | diet_card | — |
| 2 | "帮我生成一份一周三餐的膳食计划" | meal_plan_weekly_plan | weekly_plan | `meal_plan.generate_weekly_plan` |
| 3 | "看看每日膳食的总览和营养比例" | meal_plan_overview | meal_overview_card | — |
| 4 | "按老人的高血压情况调整这份膳食建议" | meal_plan_condition_advice | diet_card | `meal_plan.adjust_for_condition`（追问） |
| 5 | "午餐有没有低糖版本的推荐方案" | meal_plan_lunch_advice | diet_card | context_boost（上轮 meal_plan） |
| 6 | "换一份清淡点的食谱给老人吃" | meal_plan_advice | diet_card | context_boost 延续词「换成/调整」 |
| 7 | "下周的七天食谱帮我提前安排好" | meal_plan_weekly_plan | weekly_plan | `meal_plan.generate_weekly_plan` |
| 8 | "管理端膳食数据看板可以查看吗" | meal_plan_dashboard | meal_dashboard_card | — |
| 9 | "按时间线展示老人一天的饮食安排" | meal_plan_timeline | meal_timeline_card | — |
| 10 | "明天早上吃什么比较适合控糖" | meal_plan_breakfast_advice | diet_card | — |
| 11 | "晚餐适合吃什么，老人有便秘问题" | meal_plan_dinner_advice | diet_card | — |
| 12 | "把这份膳食换成软烂易咀嚼的版本" | meal_plan_advice | diet_card | `meal_plan.adjust_for_condition`（静态追问） |
| 13 | "继续帮我推荐其他适合老人的餐食" | meal_plan_advice | diet_card | context_boost 延续词「继续」 |
| 14 | "今天的三餐推荐一下，老人有点高血压" | meal_plan_condition_advice | diet_card | `meal_plan.default` 追问组 |
| 15 | "营养搭配比例是什么样子的，看看总览" | meal_plan_overview | meal_overview_card | — |

---

## 七、travel_route — 旅居路线规划

### 7.1 场景参数

| 参数 | 值 |
|------|-----|
| scene_key | `travel_route` |
| default_intent | `travel_route_plan` |
| threshold | 6 |
| followup_policy | `travel_route.default` |
| required_data | `gxy_travel_route_plan`（金跳动产品 API + 腾讯天气 + 地理编码） |

### 7.2 evidence_groups

| 组名 | 权重 | 关键词 |
|------|------|--------|
| travel_topic | 3 | 旅居、旅游、康养、旅养、路线、行程、目的地、基地、广西、百色、南宁、桂林、北海、巴马、防城港、京族、芒街、东兴、十万大山、嘉路康旅、银发爱情、跨境、长寿、药膳 |
| route_plan_signal | 4 | 旅行路线、旅居路线、康养路线、路线推荐、规划路线、安排路线、旅居规划、帮我规划旅居路线、防城港五条线路、京族滨海文化线、银发爱情边境线、壮村民俗康养线、森林轻氧休闲线、芒街跨境体验线 |
| travel_intent | 3 | 推荐、规划、安排、生成、对比、预订、报名、怎么去、适合去哪、住哪里、预算、交通、天气、无障碍、价格、多少钱、优惠 |
| elder_travel_constraint | 2 | 老人、长者、慢病、康复、轮椅、陪护、血压、糖尿病、适合老人、长者玩法 |
| booking | 2 | 预订、预约、下单、报名、可订、余量、入住、付款 |

### 7.3 context_boost

- previous_scene = `travel_route`，weight = 5
- 延续词：换一条、重新规划、调整、对比、预算、交通、天气、预订、继续

### 7.4 conflicts

| 冲突场景 | penalty | 冲突词 |
|---------|---------|--------|
| meal_plan | 4 | 膳食、饮食、早餐、午餐、菜谱、控糖餐 |
| dispatch_manage | 4 | 派单、工单、调度、客服 |
| acute_health_risk | 3.5 | 胸痛、昏迷、中风、急救、120 |
| nearby_resource | 4 | 地图、周边、附近、配套、资源、大屏 |

### 7.5 意图→模板映射

| intent | template_id |
|-------|-------------|
| travel_route_plan | travel_need_summary_card |
| travel_route_itinerary | travel_itinerary_card |
| travel_route_base | travel_base_card |
| travel_route_spot | travel_spot_card |
| travel_route_transport | travel_transport_card |
| travel_route_medical | travel_medical_card |
| travel_route_weather_risk | travel_weather_risk_card |
| travel_route_booking | travel_plan_summary_card |
| travel_route_budget | travel_plan_summary_card |
| travel_route_compare | route_card |
| travel_route_query（默认） | route_card |

### 7.6 模板清单（9个）

| 模板ID | 语义描述 | 布局 | 所需 slots |
|--------|---------|------|-----------|
| **route_card** | 旅居路线竖向卡（目的地/季节/预算/健康安全/交通接驳/预订动作） | vertical | routeTitle, destination, days, highlights |
| **travel_need_summary_card** | 旅居需求总结卡（AI解析标签+方案匹配结论） | vertical | title, desc, tags |
| **travel_itinerary_card** | 旅居行程安排卡（按天分段时间线：上午/下午/晚间/餐饮） | vertical | title, days |
| **travel_base_card** | 康养基地推荐卡（多基地对比+推荐理由+三餐设施医疗+价格预估） | vertical | title, bases |
| **travel_spot_card** | 适老化景点推荐（康养价值+长者玩法+交通时长） | vertical | title, spots |
| **travel_transport_card** | 交通指南卡（高铁时刻票价+12306跳转+当地包车建议） | vertical | title, tickets |
| **travel_medical_card** | 医养配套方案卡（就近医疗/便民购药/出行协助） | vertical | title, groups |
| **travel_weather_risk_card** | 天气风险研判卡（实时天气+未来预报+长者专属风险提示） | vertical | city |
| **travel_plan_summary_card** | 方案最终确认卡（目的地/天数/人数/住宿/费用汇总+立即预定入口） | vertical | title, rows, totalPrice |

### 7.7 action_key 列表

| action_key | label |
|------------|-------|
| `travel_route.replan` | 重新规划路线 |
| `travel_route.fill_preferences` | 补充偏好 |
| `travel_route.view_detail` | 查看线路详情 |
| `travel_route.check_availability` | 查可订状态 |
| `travel_route.booking_handoff` | 预订跳转 |
| `travel_route.compare_destinations` | 对比目的地 |
| `travel_route.check_health_safety` | 查看健康安全 |
| `travel_route.check_weather_risk` | 查看天气风险 |
| `travel_route.calculate_budget` | 测算预算 |
| `travel_route.plan_transport` | 规划交通 |
| `travel_route.view_product_detail` | 查看产品详情 |
| `travel_route.request_manual_review` | 请求人工审核 |

### 7.8 业务流程联动用户输入（15条）

| 序号 | 用户输入（≥10字） | 命中意图 | 目标模板 | 关联 action_key / 追问 |
|------|-------------------|---------|---------|----------------------|
| 1 | "帮我规划一条防城港旅居养老的康养路线" | travel_route_plan | travel_need_summary_card | — |
| 2 | "京族滨海文化线每天的行程怎么安排的" | travel_route_itinerary | travel_itinerary_card | — |
| 3 | "推荐几个适合老人慢病康复的康养基地" | travel_route_base | travel_base_card | — |
| 4 | "这条路线有什么适合老人游玩的景点吗" | travel_route_spot | travel_spot_card | — |
| 5 | "从南宁坐高铁怎么去防城港，票价多少" | travel_route_transport | travel_transport_card | `travel_route.plan_transport` |
| 6 | "旅居期间就近的医疗和购药怎么安排的" | travel_route_medical | travel_medical_card | `travel_route.check_health_safety` |
| 7 | "防城港最近天气怎么样，适合老人去吗" | travel_route_weather_risk | travel_weather_risk_card | `travel_route.check_weather_risk` |
| 8 | "确认这条旅居方案，费用总共需要多少" | travel_route_booking | travel_plan_summary_card | `travel_route.booking_handoff` |
| 9 | "对比一下巴马和北海哪个更适合老人" | travel_route_compare | route_card | `travel_route.compare_destinations`（追问） |
| 10 | "按经济型预算重新规划这条旅居路线" | travel_route_budget | route_card | `travel_route.calculate_budget`（追问） |
| 11 | "检查这条路线最近是否可以预订入住" | travel_route_booking | route_card | `travel_route.check_availability`（追问） |
| 12 | "银发爱情边境线适合什么样的老人参加" | travel_route_query | route_card | `travel_route.view_detail` |
| 13 | "调整一下这条路线的行程和住宿安排" | travel_route_plan | route_card | context_boost 延续词「调整」 |
| 14 | "继续帮我看看还有哪些线路可以推荐" | travel_route_plan | route_card | context_boost 延续词「继续」 |
| 15 | "森林轻氧休闲线一天怎么玩，帮我安排" | travel_route_itinerary | travel_itinerary_card | — |

---

## 八、health_risk_warning — 健康风险预警

### 8.1 场景参数

| 参数 | 值 |
|------|-----|
| scene_key | `health_risk_warning` |
| default_intent | `health_risk_warning.assess` |
| threshold | 4（最低阈值，安全优先） |
| followup_policy | `health_risk_warning.default` |
| required_data | `health_risk_warning_business`（yz365 远程体检指标 + 规则引擎） |
| 场景优先级 | **最高**（SCENE_PRIORITY = 1） |

### 8.2 evidence_groups

| 组名 | 权重 | 关键词 |
|------|------|--------|
| health_risk_alert | 4 | 健康风险、风险预警、健康预警、风险研判、报警、异常信号、风险等级、信号、研判、健康报告、完整报告 |
| health_risk_vital | 1.5 | 血压高、高血压、血糖高、血糖异常、低血糖、心率异常、跌倒、跌倒风险、居家安全、夜间离床、呼吸异常、血氧异常 |
| health_risk_intent | 3 | 研判、判定、评估、分析、提醒、预警值、阈值 |
| elder_constraint | 1.5 | 老人、长者、长辈、父母、家属、护理员、慢病、康复 |

### 8.3 context_boost

- previous_scene = `health_risk_warning`，weight = 5
- 延续词：信号、规则、等级、继续、再看、转人工、复核、补充

### 8.4 conflicts

| 冲突场景 | penalty | 冲突词 |
|---------|---------|--------|
| meal_plan | 3 | 膳食、饮食、菜谱、控糖餐、低盐 |
| travel_route | 3 | 旅居、旅游、路线、行程、巴马、北海 |
| acute_health_risk | 4 | 胸痛、昏迷、呼吸困难、中风、急救、120 |

### 8.5 意图→模板映射

| intent | template_id |
|-------|-------------|
| health_risk_warning.assess（默认） | risk_assessment_card |
| health_risk_warning.manual_review | health_warning_card |
| health_risk_warning.rule_detail | health_risk_rule_card |
| health_risk_warning.signal_detail | health_risk_signal_card |
| health_risk_warning.report | health_report_card |
| health_risk_warning.warning | risk_warning_card |
| health_risk_warning.dietary | dietary_regimen_card |

### 8.6 模板清单（7个）

| 模板ID | 语义描述 | 布局 | 所需 slots |
|--------|---------|------|-----------|
| **health_warning_card** | 健康风险预警结果卡（风险等级+设备信号+规则命中综合展示） | health_warning_card | level |
| **risk_assessment_card** | 疾病风险评估结果（重度/中度/轻度风险分级+分值+标签） | vertical | mainTitle, risks |
| **health_report_card** | 完整健康风险预警报告（风险评估+风险预警+膳食调养三模块综合报告） | vertical | reportTitle, risks |
| **risk_warning_card** | 健康风险预警提示（警告图标+预警文字列表） | vertical | warningTitle, warnings |
| **health_risk_rule_card** | 风险规则命中明细卡（规则详情+研判依据+等级判定） | health_risk_rule_card | rules |
| **health_risk_signal_card** | 设备信号明细卡（血压/血糖/心率/跌倒信号实时数据） | health_risk_signal_card | signals |
| **dietary_regimen_card** | 膳食调养建议卡（宜食/忌食说明+食疗配方列表） | vertical | sectionBadge, dietaryAdvice, recipes |

### 8.7 action_key 列表

| action_key | label | 目标模板 |
|------------|-------|---------|
| `health_risk_warning.refresh_signals` | 重新读取设备信号 | health_risk_signal_card |
| `health_risk_warning.view_rule_detail` | 查看规则命中 | health_risk_rule_card |
| `health_risk_warning.request_manual_review` | 请求人工复核 | — |
| `health_risk_warning.fill_elder_info` | 补充老人信息 | — |
| `health_risk_warning.fill_remote_info` | 补充远程信息 | — |

### 8.8 业务流程联动用户输入（15条）

| 序号 | 用户输入（≥10字） | 命中意图 | 目标模板 | 关联 action_key / 追问 |
|------|-------------------|---------|---------|----------------------|
| 1 | "帮我做一次完整的老人健康风险评估" | health_risk_warning.assess | risk_assessment_card | — |
| 2 | "老人血压偏高，有什么健康风险需要预警" | health_risk_warning.warning | risk_warning_card | — |
| 3 | "为什么判定老人是高风险，看看规则依据" | health_risk_warning.rule_detail | health_risk_rule_card | `health_risk_warning.view_rule_detail`（追问） |
| 4 | "重新读取一下最新的设备健康信号数据" | health_risk_warning.signal_detail | health_risk_signal_card | `health_risk_warning.refresh_signals`（追问） |
| 5 | "生成一份完整的健康风险预警综合报告" | health_risk_warning.report | health_report_card | — |
| 6 | "这个高血压风险在膳食方面怎么调养" | health_risk_warning.dietary | dietary_regimen_card | 追问「膳食调养建议」 |
| 7 | "老人跌倒风险偏高，日常需要注意什么" | health_risk_warning.warning | risk_warning_card | — |
| 8 | "这个预警结果帮我转人工复核一下确认" | health_risk_warning.manual_review | health_warning_card | `health_risk_warning.request_manual_review` |
| 9 | "心率异常的设备信号明细帮我看一下" | health_risk_warning.signal_detail | health_risk_signal_card | — |
| 10 | "继续看看老人还有什么其他健康风险" | health_risk_warning.assess | risk_assessment_card | context_boost 延续词「继续」 |
| 11 | "血糖异常的评估结果和风险等级是什么" | health_risk_warning.assess | risk_assessment_card | — |
| 12 | "这个风险等级的研判依据和规则是什么" | health_risk_warning.rule_detail | health_risk_rule_card | — |
| 13 | "夜间离床报警了，看看信号详情和趋势" | health_risk_warning.signal_detail | health_risk_signal_card | — |
| 14 | "风险预警提示有哪些需要特别关注的" | health_risk_warning.warning | risk_warning_card | — |
| 15 | "看看高血压的宜食和忌食调养建议" | health_risk_warning.dietary | dietary_regimen_card | 追问「膳食调养建议」 |

---

## 九、find_service — 养老服务发现与匹配

### 9.1 场景参数

| 参数 | 值 |
|------|-----|
| scene_key | `find_service` |
| default_intent | `find_service_discover` |
| threshold | 6 |
| followup_policy | `find_service.default` |
| required_data | `fs_service_catalog`, `fs_org`, `fs_worker`, `fs_service_order` |

### 9.2 evidence_groups

| 组名 | 权重 | 关键词 |
|------|------|--------|
| service_topic | 3 | 养老服务、护工、护理、养老院、机构、上门、助浴、陪诊、助餐、送餐、清洁、康复、认知症、护理员、家政、照护 |
| service_intent | 3 | 找、推荐、预约、安排、下单、匹配、查询、申请、有哪些、入住、咨询、订单、我的订单 |
| service_type | 2.5 | 上门护理、助浴、陪诊就医、康复训练、助餐、居家清洁、养老机构、养老床位、认知症照护、护理站、目录 |
| elder_constraint | 1.5 | 老人、长者、爷爷、奶奶、爸妈、失能、半失能、独居、高龄 |

### 9.3 context_boost

- previous_scene = `find_service`，weight = 5
- 延续词：这个、这位、预约、下单、接单、安排、继续、再推荐、换一个

### 9.4 conflicts

| 冲突场景 | penalty | 冲突词 |
|---------|---------|--------|
| meal_plan | 4 | 膳食、饮食、早餐、午餐、菜谱 |
| travel_route | 4 | 旅居、旅游、路线、行程、广西 |
| dispatch_manage | 4 | 派单、工单、调度、接单、拒单、改派 |
| acute_health_risk | 3.5 | 胸痛、昏迷、中风、急救、120 |

### 9.5 意图→模板映射

| intent | template_id |
|-------|-------------|
| find_service_discover（默认） | service_recommend |
| find_service_org | org_profile |
| find_service_order | service_order_form |
| find_service_order_ticket | service_order_ticket |
| find_service_order_preview | order_preview |
| find_service_order_view | order_status |
| find_service_worker | worker_profile |
| find_service_catalog | service_catalog |
| find_service_detail | service_detail |
| find_service_expand | service_expand |
| find_service_guess_like | service_guess_like |

### 9.6 模板清单（14个）

| 模板ID | 语义描述 | 布局 | 所需 slots | 追问按钮 |
|--------|---------|------|-----------|---------|
| **service_recommend** | 综合服务推荐页（维度标签+服务卡列表+拓展推荐+猜你喜欢） | vertical | sceneTitle, total, services, highlightOrg, highlightWorker | 一键预定、换个维度、查看详情、更多服务 |
| **service_card** | 单个服务推荐项（图标/评分/价格/服务商可信指标） | vertical | name, price, unit, provider_name | 一键预定、查看详情、换个服务 |
| **service_detail** | 服务详情页（介绍/标签/特色/时间/咨询热线） | vertical | name, intro, hotline | 一键预定、一键咨询、返回 |
| **service_catalog** | 养老服务目录全览（按分类展示全部可用服务） | vertical | sceneTitle, total, categories | — |
| **service_expand** | 按维度拓展推荐（空闲率/环境/响应速度最优选择） | vertical | badge_text, name, price, unit | 查看该服务、返回推荐 |
| **service_guess_like** | 个性化精选横向卡（封面图/标签/价格/服务商信息） | vertical | name, price, unit, provider_name | 选这个、看更多推荐 |
| **service_intent** | AI意图识别可视化（置信度/抽取实体/紧急级别） | vertical | badge_type, badge_label, confidence | 确认理解、重新描述、这不是我要的 |
| **service_thinking** | AI处理中加载态（意图识别→实体抽取→知识库匹配动画） | vertical | title, steps | 取消、换种方式提问 |
| **service_order_form** | 服务预定表单（服务/预约人/电话/地址/日期/时段） | vertical | service_name, name, phone, address | 提交预定、修改信息、取消 |
| **service_order_ticket** | 下单成功凭证（订单号/服务/预约信息/状态） | vertical | order_no, service_name, name, status | 查看订单详情、返回首页、联系客服 |
| **order_preview** | 订单预览确认页（提交前的信息汇总） | vertical | orderId, elderName, serviceName, orgName, price | — |
| **order_status** | 订单状态进度跟踪（服务订单全流程状态） | vertical | total, orders | — |
| **org_profile** | 养老机构详情页（机构信息/设施/评级/联系方式） | vertical | orgName, orgType, address, scope, certified | — |
| **worker_profile** | 护理人员详情档案（资质/经验/评分/专长） | vertical | name, certLevel, area, skillTags, available | — |

> 另含公共模板：**service_emergency**（SOS 紧急求助卡，含拨打120/通知家属/标记安全按钮）

### 9.7 action_key 列表

| action_key | label | 目标模板 |
|------------|-------|---------|
| `find_service.recommend` | 智能推荐养老服务 | service_recommend |
| `find_service.catalog` | 查看全部养老服务 | service_catalog |
| `find_service.list_orgs` | 查看养老机构 | org_profile |
| `find_service.list_workers` | 推荐上门护理人员 | worker_profile |
| `find_service.detail_service` | 查看服务详情 | service_detail |
| `find_service.detail_order` | 查看服务订单 | order_status |
| `find_service.recommend` | 智能推荐 | service_recommend |

### 9.8 业务流程联动用户输入（15条）

| 序号 | 用户输入（≥10字） | 命中意图 | 目标模板 | 关联 action_key / 追问 |
|------|-------------------|---------|---------|----------------------|
| 1 | "帮我找一位有经验的上门护理护工" | find_service_discover | service_recommend | `find_service.recommend` |
| 2 | "有哪些养老服务可以选择和查看" | find_service_catalog | service_catalog | `find_service.catalog` |
| 3 | "这家养老院怎么样，环境和设施如何" | find_service_org | org_profile | `find_service.list_orgs`（追问） |
| 4 | "护工的资质等级和用户评分怎么样" | find_service_worker | worker_profile | `find_service.list_workers`（追问） |
| 5 | "我要预约这个上门护理助浴服务" | find_service_order | service_order_form | — |
| 6 | "确认一下订单信息再提交预定" | find_service_order_preview | order_preview | — |
| 7 | "下单成功了，订单号是多少查一下" | find_service_order_ticket | service_order_ticket | — |
| 8 | "我的服务订单到哪一步了，什么时候来" | find_service_order_view | order_status | `find_service.detail_order` |
| 9 | "推荐一些空闲率比较高的优质服务" | find_service_expand | service_expand | — |
| 10 | "猜我喜欢，有没有推荐的旅居路线" | find_service_guess_like | service_guess_like | — |
| 11 | "这项认知症照护服务有什么特色介绍" | find_service_detail | service_detail | — |
| 12 | "再推荐一些其他适合老人的上门服务" | find_service_discover | service_recommend | context_boost 延续词「再推荐」 |
| 13 | "需要一个陪诊就医的服务，有推荐吗" | find_service_discover | service_recommend | — |
| 14 | "继续帮我找更多适合失能老人的服务" | find_service_discover | service_recommend | context_boost 延续词「继续」 |
| 15 | "换一个评分更高的居家清洁服务推荐" | find_service_discover | service_recommend | context_boost 延续词「换一个」 |

---

## 十、dispatch_manage — 派单与工单调度

### 10.1 场景参数

| 参数 | 值 |
|------|-----|
| scene_key | `dispatch_manage` |
| default_intent | `dispatch_list` |
| threshold | 5 |
| followup_policy | `dispatch_manage.default` |
| required_data | `dm_dispatch_order`, `fs_service_order`, `fs_worker` |

### 10.2 evidence_groups

| 组名 | 权重 | 关键词 |
|------|------|--------|
| dispatch_topic | 3 | 派单、工单、调度、接单、拒单、改派、转派、抢单、派工、我的单、转交、供应商处理、一票否决 |
| dispatch_intent | 3 | 查看、处理、接、催、查询、列表、详情、进度、状态、改约、更新、看一下、不接、拒接 |
| dispatch_status | 2.5 | 进度、状态、改约、更新、流转、跟踪 |
| service_link | 1.5 | 订单、服务进度、处理进度、客服 |

### 10.3 context_boost

- previous_scene = `dispatch_manage`，weight = 5
- 延续词：这条、这个单、接下、改派、继续、再催、转派

### 10.4 conflicts

| 冲突场景 | penalty | 冲突词 |
|---------|---------|--------|
| meal_plan | 4 | 膳食、饮食、早餐、午餐、菜谱 |
| travel_route | 4 | 旅居、旅游、路线、行程 |
| find_service | 4 | 找护工、找机构、养老院、上门服务、养老服务 |
| acute_health_risk | 3.5 | 胸痛、昏迷、中风、急救、120 |

### 10.5 意图→模板映射

| intent | template_id |
|-------|-------------|
| dispatch_list（默认） | dispatch_list |
| dispatch_accept | dispatch_detail |
| dispatch_reject | dispatch_detail |
| dispatch_detail | dispatch_detail |
| dispatch_supplier | dispatch_supplier_action |
| dispatch_transfer | dispatch_transfer |
| dispatch_work_order | work_order |
| dispatch_status | dispatch_status |

### 10.6 模板清单（7个）

| 模板ID | 语义描述 | 布局 | 所需 slots |
|--------|---------|------|-----------|
| **dispatch_list** | 派单列表总览（待接单/进行中/已完成工单列表） | vertical | total, pending, orders |
| **dispatch_detail** | 单个派单详情（接单/拒单/改派操作入口） | vertical | dispatchId, orderId, workerName, status |
| **dispatch_status** | 派单进度跟踪（工单状态更新与催单功能） | vertical | dispatchId, status, changedAt |
| **dispatch_reject** | 拒接订单原因选择页（可选拒接原因供确认） | vertical | order_no, reasons |
| **dispatch_transfer** | 订单转交页（可转交对象空闲率/环境/人数对比） | vertical | order_no, targets |
| **dispatch_supplier_action** | 供应商侧派单处理页（一票否决权：接单/拒单/转交） | vertical | order_no, service_name, name |
| **work_order** | 服务工单详情（工单关联信息与执行记录） | vertical | orderId, elderName, serviceName, status |

### 10.7 action_key 列表

| action_key | label | 目标模板 |
|------------|-------|---------|
| `dispatch_manage.list` | 派单列表 | dispatch_list |
| `dispatch_manage.work_order` | 查看工单 | work_order |
| `dispatch_manage.status` | 查看进度 | dispatch_status |
| `dispatch_manage.detail` | 派单详情 | dispatch_detail |

### 10.8 业务流程联动用户输入（15条）

| 序号 | 用户输入（≥10字） | 命中意图 | 目标模板 | 关联 action_key / 追问 |
|------|-------------------|---------|---------|----------------------|
| 1 | "帮我看看今天待处理的派单列表" | dispatch_list | dispatch_list | `dispatch_manage.list` |
| 2 | "这条派单的详细信息帮我看一下" | dispatch_detail | dispatch_detail | `dispatch_manage.detail` |
| 3 | "我接下这个服务派单，确认接单" | dispatch_accept | dispatch_detail | — |
| 4 | "这条派单时间冲突了，我要拒单" | dispatch_reject | dispatch_detail | — |
| 5 | "把这个单转交给其他空闲的护理员" | dispatch_transfer | dispatch_transfer | — |
| 6 | "供应商确认一下这个待处理的订单" | dispatch_supplier | dispatch_supplier_action | — |
| 7 | "查看这条派单的进度和当前状态" | dispatch_status | dispatch_status | `dispatch_manage.status`（追问） |
| 8 | "催一下这个单，服务人员什么时候到" | dispatch_status | dispatch_status | — |
| 9 | "查看这条派单对应的服务工单详情" | dispatch_work_order | work_order | `dispatch_manage.work_order`（追问） |
| 10 | "帮我改约这条派单的服务上门时间" | dispatch_status | dispatch_status | — |
| 11 | "这条工单的状态变更记录看一下" | dispatch_status | dispatch_status | — |
| 12 | "继续处理下一条待接单的派单" | dispatch_list | dispatch_list | context_boost 延续词「继续」 |
| 13 | "我的派单列表里有多少条待处理的" | dispatch_list | dispatch_list | — |
| 14 | "改派给评价更高的护理员来处理" | dispatch_transfer | dispatch_transfer | context_boost 延续词「改派」 |
| 15 | "这条单的处理详情和接单记录看一下" | dispatch_detail | dispatch_detail | — |

---

## 十一、nearby_resource — 嘉路周边资源地图

### 11.1 场景参数

| 参数 | 值 |
|------|-----|
| scene_key | `nearby_resource` |
| default_intent | `nearby_resource.all` |
| threshold | 4 |
| followup_policy | `nearby_resource.default` |
| required_data | `jialu_facilities`（静态 389 条 JSON + 腾讯地图 POI + Tavily 富化） |
| required_knowledge | `jialu_kangyang_center` |

### 11.2 evidence_groups

| 组名 | 权重 | 关键词 |
|------|------|--------|
| place | 3.5 | 嘉路、康养中心、嘉路康养、中心周边、附近、周边、周围、15公里、生活圈、生活配套、海边、医院 |
| map | 3.5 | 地图、打点、标记、分布、位置、在哪、大屏、定位、地图展示、资源分布、配套分布 |
| resource_category | 3 | 民宿、住宿、康养小院、景区、滨海、餐饮、餐厅、海鲜、垂钓、休闲、购物、特产、超市、交通、医疗、药店、康养配套 |
| nearby_intent | 2 | 查看、展示、看看、搜一下、有哪些、附近有、推荐、列出、清单、走路能到、步行可达 |
| nearby_specific | 4 | 周边资源、周边配套、地图展示、资源分布、以嘉路为中心、15公里、康养生活圈、清单、走路、步行可达、对比、推荐几个 |

### 11.3 context_boost

- previous_scene = `nearby_resource`，weight = 4
- 延续词：周边、附近配套、继续看、切换分类、再看周边

### 11.4 conflicts

| 冲突场景 | penalty | 冲突词 |
|---------|---------|--------|
| travel_route | 3 | 路线、导航、怎么走、行程、旅居、巴马、北海 |
| meal_plan | 3 | 膳食、食谱、一周饮食、营养餐、三餐 |
| find_service | 3.5 | 找护工、找机构、养老院、上门服务、建单、下单 |
| dispatch_manage | 4 | 派单、工单、调度、转人工、催单 |
| acute_health_risk | 3.5 | 胸痛、昏迷、中风、急救、120 |

### 11.5 意图→模板映射

| intent | template_id |
|-------|-------------|
| nearby_resource.all（默认） | nearby_map_overview |
| nearby_resource.stay | nearby_stay_card |
| nearby_resource.spot | nearby_spot_card |
| nearby_resource.food | nearby_food_card |
| nearby_resource.leisure | nearby_recommend |
| nearby_resource.shop | nearby_list |
| nearby_resource.transit | nearby_map_route |
| nearby_resource.wellness | nearby_wellness |
| nearby_resource.list | nearby_list |
| nearby_resource.radar | nearby_radar |
| nearby_resource.compare | nearby_compare |
| nearby_resource.recommend | nearby_recommend |
| nearby_resource.summary | nearby_summary |
| nearby_resource.route | nearby_map_route |
| nearby_resource.category | nearby_map_category |

### 11.6 模板清单（12个）

| 模板ID | 语义描述 | 布局 | 所需 slots |
|--------|---------|------|-----------|
| **nearby_map_overview** | 核心：15km生活圈综合地图（中心+半径圈+七类打点+筛选+距离清单） | map | markers_json, center_json, centerName, radiusKm, map_key |
| **nearby_map_category** | 单类资源深度分布图（按分类着色打点） | map | markers_json, center_json, centerName, radiusKm, map_key, category |
| **nearby_map_route** | 一日康养游路线图（序号折线+行程清单+导航） | map | routeStops_json, center_json, centerName, map_key |
| **nearby_radar** | 可达性雷达图（步行1.5km/车行Nkm双等时圈叠加） | map | walkItems_json, center_json, centerName, radiusKm, map_key, walkCount |
| **nearby_list** | 通用资源清单列表（七类筛选+距离升序+电话/导航） | list | markers, centerName, radiusKm, total |
| **nearby_recommend** | 个性化推荐Top3（适老/距离/标签精选+推荐理由） | recommend | picks, centerName, categoryLabel |
| **nearby_compare** | 同类资源并排对比（距离/状态/标签逐列比较） | compare | picks, centerName, categoryLabel |
| **nearby_food_card** | 餐饮专题卡（招牌菜+营业时间+电话） | card | markers, centerName, radiusKm, total |
| **nearby_spot_card** | 景区专题卡（开放时间+适老无障碍+最佳时段） | card | markers, centerName, radiusKm, total |
| **nearby_stay_card** | 住宿专题卡（民宿/康养小院+适老标签+电话导航） | card | markers, centerName, radiusKm, total |
| **nearby_wellness** | 康养配套看板（医养一体化聚合） | card | wellnessItems, centerName, radiusKm, total |
| **nearby_summary** | 语音播报纯文本摘要（弱网/无障碍场景） | summary | summaryText, statsLabels, centerName, radiusKm |

### 11.7 action_key 列表

| action_key | label |
|------------|-------|
| `nearby_resource.all` | 全部资源 |
| `nearby_resource.stay` | 只看住宿 |
| `nearby_resource.food` | 只看餐馆 |
| `nearby_resource.spot` | 只看景区 |
| `nearby_resource.leisure` | 只看游玩 |
| `nearby_resource.shop` | 只看购物 |
| `nearby_resource.transit` | 只看交通 |
| `nearby_resource.wellness` | 只看医疗 |
| `nearby_resource.compare` | 对比选择 |
| `nearby_resource.recommend` | 推荐精选 |
| `nearby_resource.route` | 规划路线 |
| `nearby_resource.radar` | 步行可达 |
| `nearby_resource.summary` | 语音摘要 |

### 11.8 业务流程联动用户输入（15条）

| 序号 | 用户输入（≥10字） | 命中意图 | 目标模板 | 关联 action_key / 追问 |
|------|-------------------|---------|---------|----------------------|
| 1 | "嘉路康养中心周边15公里有什么资源" | nearby_resource.all | nearby_map_overview | `nearby_resource.all` |
| 2 | "展示周边地图，标出各类生活配套" | nearby_resource.all | nearby_map_overview | — |
| 3 | "只看附近的医疗资源分布在哪里" | nearby_resource.wellness | nearby_wellness | 追问「只看医疗」 |
| 4 | "附近有什么好吃的餐厅和海鲜店" | nearby_resource.food | nearby_food_card | 追问「周边餐馆」 |
| 5 | "周边有哪些好玩的景区和海边景点" | nearby_resource.spot | nearby_spot_card | 追问「好玩的地方」 |
| 6 | "住哪里方便，附近有什么民宿住宿" | nearby_resource.stay | nearby_stay_card | — |
| 7 | "走路能到的地方有哪些，距离多远" | nearby_resource.radar | nearby_radar | — |
| 8 | "帮我推荐几个必去的周边好地方" | nearby_resource.recommend | nearby_recommend | `nearby_resource.recommend` |
| 9 | "附近这几家餐馆对比一下哪家好" | nearby_resource.compare | nearby_compare | `nearby_resource.compare` |
| 10 | "列一个周边所有资源的清单列表" | nearby_resource.list | nearby_list | — |
| 11 | "简单告诉我周边有什么，一句话概括" | nearby_resource.summary | nearby_summary | `nearby_resource.summary` |
| 12 | "安排一条周边一日游的康养路线" | nearby_resource.route | nearby_map_route | `nearby_resource.route` |
| 13 | "周边有什么康养和医养配套设施" | nearby_resource.wellness | nearby_wellness | — |
| 14 | "继续看周边的其他分类配套资源" | nearby_resource.all | nearby_map_overview | context_boost 延续词「继续看」 |
| 15 | "附近配套在地图上标出来看看分布" | nearby_resource.all | nearby_map_overview | context_boost 延续词「再看周边」 |

---

## 十二、common — 政策咨询

### 12.1 场景参数

| 参数 | 值 |
|------|-----|
| scene_key | `common` |
| default_intent | `elder_policy_consult` |
| threshold | 6 |
| followup_policy | `common.policy` |
| required_knowledge | `common`（无外部数据源，纯政策知识库） |
| 场景优先级 | **最低**（SCENE_PRIORITY = 7，兜底场景） |

### 12.2 evidence_groups

| 组名 | 权重 | 关键词 |
|------|------|--------|
| policy_topic | 4 | 养老政策、政策、补贴、高龄津贴、长护险、长期护理保险、护理补贴、养老保险、养老金、社区居家养老、居家养老、适老化改造、失能评估、能力评估、民政、人社 |
| service_intent | 2.5 | 有什么、有哪些、怎么申请、如何申请、申请条件、办理条件、怎么办理、去哪办、需要材料、流程、标准、多少钱、查询、咨询 |
| assistant_usage | 4 | 养老助手、桂小养、怎么用、能做什么、可以做什么、使用方法、功能 |
| elder_context | 1.5 | 老人、长者、老年人、家属、爸妈、失能、半失能、独居、高龄 |

### 12.3 context_boost

- previous_scene = `common`，weight = 3
- 延续词：这个、这些、继续、怎么办、怎么申请、需要什么

### 12.4 conflicts

| 冲突场景 | penalty | 冲突词 |
|---------|---------|--------|
| meal_plan | 4 | 膳食、饮食、早餐、午餐、控糖、低盐 |
| travel_route | 4 | 旅居、旅游、路线、行程、巴马、北海 |
| acute_health_risk | 4 | 胸痛、昏迷、中风、急救、120 |

### 12.5 意图→模板映射

| intent | template_id |
|-------|-------------|
| elder_policy_consult（默认） | policy_card |
| elder_policy_apply | policy_apply_guide_card |
| elder_policy_benefit | policy_list_card |
| elder_policy_detail | policy_detail_card |
| elder_policy_list | policy_list_card |
| elder_assistant_usage | answer |

### 12.6 模板清单（5个）

| 模板ID | 语义描述 | 布局 | 所需 slots |
|--------|---------|------|-----------|
| **answer** | 通用健康咨询答复兜底卡片（文本回复 + 相关问题推荐） | vertical | emoji, title, skill_name, answer, related_questions, foot |
| **fallback_error** | 异常错误友好提示卡片（系统出错兜底展示） | vertical | emoji, title, code, message, detail, suggestion, foot |
| **policy_card** | 养老政策咨询主卡片（补贴/长护险/高龄津贴等政策解答） | vertical | answer, policy_items |
| **policy_detail_card** | 政策详情卡片（单条政策详细解读，含要点/标签/高亮） | — | eyebrow, title, tags, summary, highlights, details, footer_tip |
| **policy_list_card** | 政策列表卡片（多条政策信息列表一览） | — | eyebrow, title, summary, count, policies, hint |
| **policy_apply_guide_card** | 申请指引卡片（申请流程/条件/所需材料/联系方式） | — | eyebrow, title, subtitle, conditions, steps, materials, contact, highlight |

### 12.7 action_key 列表

> common 场景无独立 action_key，追问通过 FOLLOWUP_POLICIES `common.policy` 实现。

### 12.8 业务流程联动用户输入（15条）

| 序号 | 用户输入（≥10字） | 命中意图 | 目标模板 | 关联追问 |
|------|-------------------|---------|---------|---------|
| 1 | "老人有什么补贴政策可以申请的" | elder_policy_consult | policy_card | `common.policy` 追问组 |
| 2 | "长护险是什么政策，详细解读一下" | elder_policy_detail | policy_detail_card | 追问「整理办理材料」 |
| 3 | "怎么申请高龄津贴，需要什么材料" | elder_policy_apply | policy_apply_guide_card | `common.policy` 追问组 |
| 4 | "有哪些养老政策汇总可以一览的" | elder_policy_list | policy_list_card | 追问「查询补贴条件」 |
| 5 | "养老金和养老保险有什么区别和好处" | elder_policy_benefit | policy_list_card | 追问「查询补贴条件」 |
| 6 | "社区居家养老有什么补贴和支持政策" | elder_policy_consult | policy_card | — |
| 7 | "适老化改造补贴怎么办理，流程是什么" | elder_policy_apply | policy_apply_guide_card | 追问「查询办理流程」 |
| 8 | "长护险申请条件是什么，去哪里办理" | elder_policy_apply | policy_apply_guide_card | `common.policy` 追问组 |
| 9 | "失能评估怎么办理，需要准备什么材料" | elder_policy_apply | policy_apply_guide_card | 追问「整理办理材料」 |
| 10 | "桂小养养老助手能做什么，怎么使用" | elder_assistant_usage | answer | — |
| 11 | "这个补贴政策的具体内容要点是什么" | elder_policy_detail | policy_detail_card | context_boost 延续词「这个」 |
| 12 | "补贴政策汇总有哪些可以查看的" | elder_policy_list | policy_list_card | 追问「查询补贴条件」 |
| 13 | "继续看看还有哪些养老政策可以了解" | elder_policy_consult | policy_card | context_boost 延续词「继续」 |
| 14 | "助餐补贴怎么申请，去哪个部门办理" | elder_policy_apply | policy_apply_guide_card | 追问「查询办理流程」 |
| 15 | "养老补贴办理需要准备哪些材料清单" | elder_policy_apply | policy_apply_guide_card | 追问「整理办理材料」 |

---

## 十三、模板选择优先级矩阵

### 13.1 高冲突场景路由

| 用户输入 | 候选场景A | 候选场景B | 最终路由 | 路由依据 |
|---------|----------|----------|---------|---------|
| "附近有什么吃的" | nearby_resource (food) | meal_plan | nearby_resource | "附近"命中 place 组 + "吃"命中 food 分类 |
| "帮我推荐膳食" | meal_plan | find_service | meal_plan | "膳食"命中 meal_topic，无 service 信号 |
| "一周计划" | meal_plan (weekly) | travel_route | meal_plan | "一周/七天"精确命中 meal_time |
| "附近医院" | nearby_resource (wellness) | health_risk_warning | nearby_resource | "附近"命中 place + "医院"命中 wellness |
| "怎么去防城港" | travel_route (transport) | nearby_resource | travel_route | "防城港"命中 travel_topic + "怎么去"命中 transport |
| "有什么服务" | find_service (catalog) | common | find_service | "有什么" + "服务"命中 service_topic |
| "护工上门" | find_service | dispatch_manage | find_service | "护工"命中 service_topic，"上门"命中 service_type |
| "催一下这个单" | dispatch_manage | find_service | dispatch_manage | "催"命中 dispatch_intent，context_boost 延续 |

### 13.2 场景间冲突惩罚参考

| 场景对 | 双向 penalty | 典型冲突词 |
|--------|------------|-----------|
| meal_plan ↔ travel_route | 4 / 4 | 菜谱 vs 路线 |
| meal_plan ↔ find_service | 4 / 4 | 膳食 vs 护工 |
| meal_plan ↔ dispatch_manage | 5 / 4 | 膳食 vs 派单 |
| travel_route ↔ nearby_resource | 4 / 3 | 行程 vs 地图 |
| find_service ↔ dispatch_manage | 4 / 4 | 找服务 vs 派单 |
| 所有场景 ↔ acute_health_risk | 3.5~4 | 急救关键词强制惩罚 |

---

## 十四、附录

### 14.1 数据源说明

| 技能包 | 数据来源 |
|--------|---------|
| nearby_resource | 静态 389 条 JSON + 腾讯地图 POI 搜索 + Tavily 富化 |
| travel_route | 腾讯天气 API + 金跳动产品 API + 腾讯地图地理编码 |
| health_risk_warning | 云诊 365 (yz365) 远程体检指标 + 规则引擎 |
| meal_plan | 慢病膳食知识库 + Tavily 营养搜索 |
| find_service | 养老服务数据库 + 评分/空闲率算法 |
| dispatch_manage | 工单系统 API |
| common | 无外部数据源（政策知识库） |

### 14.2 特殊模板说明

| 模板 | 特殊说明 |
|------|---------|
| health_risk_rule_card | HTML 片段文件（无完整 HTML 结构），通过 data-template 标识 |
| health_risk_signal_card | 同上 |
| health_warning_card | 同上 |
| service_emergency | SOS 紧急短路触发，跳过场景评分直接渲染 |
| service_thinking | 加载态卡片，无用户输入触发，系统自动展示 |
| nearby_summary | 纯文本无地图，弱网/无障碍场景专用 |
| fallback_error | 异常兜底，系统出错时自动展示 |
| answer | 通用文本兜底，所有场景均可能降级至此 |

### 14.3 地图三层降级机制

```
TMap JS API 加载成功 → 交互式地图（nearby_map_*）
        │ 失败
        ↓
腾讯静态图 URL → 静态地图图片
        │ 失败
        ↓
SVG 内联兜底 → 简化示意图
```

### 14.4 SOS 紧急短路机制

```
用户输入 → emergency-detector 检测关键词
  ├─ LEVEL_1（SOS/120/999/急救/求救/救护车/叫救护车/打120）
  │     → 直接渲染 service_emergency，跳过场景路由
  │     → 动作：拨打120（tel:120）/ 通知家属 / 标记安全
  │
  └─ LEVEL_2（胸痛/昏迷/呼吸困难/中风/抽搐/大出血）
        → acute_health_risk 冲突惩罚 +3.5~4，影响场景评分
```

### 14.5 关键文件索引

| 文件 | 说明 |
|------|------|
| `src/core/scene-router/index.js` | 场景路由入口 |
| `src/core/scene-router/scoring-engine.js` | 评分引擎 |
| `src/core/scene-router/rules/*.js` | 7 个场景规则集 |
| `src/core/scene-router/intent-template-map.js` | 意图→模板映射 |
| `src/core/scene-router/scene-transition-manager.js` | 场景转换管理 |
| `src/core/scene-router/ambiguity-resolver.js` | 消歧解析器 |
| `src/core/interaction-composer.js` | 追问策略 + FollowupGuard |
| `src/core/actions/action-resource-map.json` | 按钮 action 兜底资源清单 |
| `src/core/orchestrator/chat-orchestrator.js` | 编排器（SOS 短路 + 场景决策） |
| `src/core/conversation/context-snapshot.js` | 多轮上下文快照 |
| `src/core/intent-classifier/emergency-detector.js` | 紧急检测器 |
| `src/skills/<skill>/templates/html/*.manifest.json` | 模板 manifest |
| `src/skills/<skill>/templates/followups/*.json` | 静态追问配置 |

---

*文档结束*
