# Context Bus：登录/会话实体提取与 Skill 注入设计

**日期**: 2026-08-13  
**范围**: flatTalk（桂小养助手）+ Tag-System 实体类型对齐  
**状态**: 待用户审阅  

## 1. 背景与目标

当前运行态存在：登录后身份未可靠进入业务上下文（如 `meal_plan` 的 `has_elder=false`）、城市提取仅旅居触发、附近场景无定位时静默 skip、会话代词/人名/业务要素缺少统一抽取与按 `skill_key` 注入。

本设计交付一条统一链路：

1. **登录时**提取身份、实体标签（对照 Tag-System `entity_type`）、城市、位置等。  
2. **会话中**提取代词、人名/机构名、业务资源要素。  
3. **按 skill** 注册探测器，路由后及时注入。  
4. 配套：**安全门**、**轻量输入规范化**、**500 字上限**、**多意图主执行+排队**。

成功标准（最小）：

- 老人/家属登录后膳食等业务能拿到绑定老人，禁止空跑。  
- 「附近」无 latlng → `need_location`，禁止无原因 `skipped`。  
- 旅居能注入线路/城市等业务包。  
- 有害输入硬拦或关怀分流；错别字经规范化后仍可正确路由。

## 2. 架构选型

采用 **Context Bus + Detector Registry**（否决：编排器内联堆砌；否决：全部以 Tag-System 为运行时中枢）。

```
Auth → SafetyGate → InputNormalizer → TurnExtractor
     → LIS/Route(primary skill) → Detectors[skill_key]
     → inject_profile(skill_key) → skill / business_data
     → (drain pending_intents)
```

组件边界：

| 单元 | 职责 | 依赖 |
|------|------|------|
| `SessionContext` / Context Bus | 分层存储 login/turn；提供 `inject_profile` | sessionStore |
| `LoginBinder` | SSO → provisional login | `/assistant` userInfo |
| `TagCorrector` | Tag/用户中心校正 → confirmed | Tag-System / PG |
| `SafetyGate` | 反动/色情/暴力/消极分流 | 规则+轻量分类 |
| `InputNormalizer` | 错别字/火星文等轻量勘误 | LLM+规则 |
| `TurnExtractor` | 代词/实体/城市/位置/意图列表 | LLM 主 + 规则校验 |
| `DetectorRegistry` | 按 skill_key 抽业务资源 | 各 skill 插件 |
| Orchestrator | 只读 Bus，注入后调 skill | 现有 chat-orchestrator |

## 3. SessionContext 分层模型

### 3.1 `login`（登录会话级，登出清）

- `user_id`, `role_key`, `entity_type`, `entity_id`, `tags[]`  
- `elder_binding`: `{ elder_id, … }`（老人=自身；家属=关联列表/当前选中）  
- `org`: `{ org_id, org_name }`  
- `city`, `location`: `{ lat, lng, source }`  
- `identity_source`: `sso` \| `tag` \| `merged`  
- `identity_status`: `provisional` \| `confirmed`

### 3.2 `turn`（当前对话级，可被后续轮覆盖）

- `original_text`, `normalized_text`  
- `pronouns[]`, `mentioned_entities[]`  
- `cities[]`, `primary_city`, 位置意图标志  
- `intents[]`（最多 3）, `primary_intent_index`, `pending_intents[]`  
- `business`: `{ [skill_key]: resources }`  
- `safety` / `normalize` 元数据（可选）

### 3.3 `inject_profile(skill_key)`

只读拼装：`login.*` + turn 通用槽 + `turn.business[skill_key]`。  
Skill 与 `business_data` **只消费 profile**，不各自再猜身份。

## 4. 登录绑定与实体类型（双源）

### 4.1 流水线

1. `/assistant` 解密 SSO `userInfo`。  
2. `LoginBinder` 按共用 **RoleEntityMap** 写 provisional。  
3. `TagCorrector` 拉实体类型、标签、老人绑定、组织 → merge 为 confirmed；失败则保持 provisional 并打 trace。  
4. 端上 `locationService`（或首条消息 `payload.location`）写入 `login.location` / city。

### 4.2 RoleEntityMap（与 Tag-System 对齐并补齐缺口）

| role_id（示例） | entity_type | 绑定策略 |
|-----------------|-------------|----------|
| `LAO_REN` / `ELDER` | `ELDER` | elder_binding = self |
| `JIA_SHU` | `USER` + 家属业务标签 | elder_binding = 关联老人 |
| 护理/助老/`nurse`/`SQJJ-HLRY`/`SQJJ-ZLY` | `WORKER` | org 关联 |
| `CUN_YI` / `SQJJ-YS` | `DOCTOR` | — |
| `FU_WU_SHANG` | `SERVICE_PROVIDER` | — |
| `SQJJ-GLY` / 机构管理员 | `USER` + `ORG` 关联 | org 必填（非老人） |
| 网格员 | `GRID_WORKER` | — |

允许的 Tag-System 类型：`ELDER` / `ORG` / `WORKER` / `DOCTOR` / `GRID_WORKER` / `SERVICE_PROVIDER` / `ROLE` / `USER`。  
flatTalk 与 Tag-System **共用同一份映射表**（配置或共享文档+代码常量），避免登录预设与同步服务漂移。

## 5. SafetyGate（§3.5）

位置：Auth 之后、规范化之前。

| 类别 | 动作 |
|------|------|
| 反动 / 色情 / 暴力 / 违法教唆 | 硬拦截：固定拒答卡；不写业务槽；不调 skill |
| 消极 / 抑郁 / 自伤倾向 | 关怀分流：关怀话术 + 可配置求助提示；不进业务 skill |
| 命中任一 | runtime-events 审计（类别码；原文可脱敏） |

## 6. InputNormalizer（轻量 B）

位置：SafetyGate 之后、TurnExtractor 之前。

- 矫正：错别字、繁简/全半角、常见谐音与火星文。  
- 输出：`original_text` + `normalized_text` + `fixes[]`；后续 LIS/抽取/探测器一律用 **normalized**。  
- 改动较大时可轻提示「已理解为：…」；专有名词不乱改。  
- 意义严重不达 → `needs_clarify`，不瞎改写。

## 7. 字数上限与多意图

- **硬限 500 字**（字符）：前端拦截；后端校验失败返回 400。超出提示「请分段提问」。  
- **多意图策略 B**：TurnExtractor 识别最多 3 个意图；本轮只执行 `primary`；其余入 `pending_intents`，本轮结束后追问或自动 drain。  
- 两意图高置信且冲突时，可升级为选项卡澄清（实现期可配置开关，默认 B）。

## 8. TurnExtractor（LLM 主 + 规则校验）

通用槽位：

- 人称代词 → 锚定 `login.user` / `elder_binding` / 上文 mentioned。  
- 人名 / 机构名 → 候选实体（对照 `entity_type`）+ confidence。  
- 城市 / 区域 → 写入 `turn.cities`（**不再仅旅居触发**）。  
- 位置意图（附近/这里）→ 优先 `login.location`；缺失 → `need_location`。

契约：LLM 结构化 JSON → 词表/白名单/Tag 校验 → 低置信度澄清，不硬猜；未解析槽位写入 query-trace。

## 9. Detector Registry 与注入

路由得到 `skill_key` 后：

```
await detectors.run(skill_key, { utterance: normalized, login, turn })
profile = contextBus.inject_profile(skill_key)
skill.execute(profile) / 组装 business_data
```

示例探测器：

| skill_key | 资源要素 |
|-----------|----------|
| `travel_route` | 线路名、目的地城市、天数、人群、POI/地图要素 |
| `meal_plan` | 目标老人（须已解析）、忌口/病种标签、餐次 |
| `nearby` / 相关天气动作 | 锚点 latlng、品类、半径；无位置必须 `need_location` |
| `common` | 无业务包，仅 login + turn 通用槽 |

缺关键资源：澄清或 `need_location`；**禁止**无原因 `business_data.skipped=true`。  
Trace：`detector_hits` + `inject_keys`。

## 10. 错误处理与降级

- TagCorrector 失败 → provisional，业务可用 SSO 字段。  
- Normalizer 不确定 → 澄清。  
- Safety 命中 → 短路。  
- 代词/老人未解析 → 膳食等禁止 `has_elder` 空跑。  
- 附近无 latlng → `need_location`。  
- Detector 超时 → partial + 用户可读提示。

## 11. 验收用例（最小）

1. 老人登录 → `entity_type=ELDER`，膳食 `has_elder=true`。  
2. 家属登录 → `elder_binding` 非空或澄清选老人。  
3. 「帮他看看食谱」→ 代词锚定绑定老人。  
4. 旅居问线路 → `business.travel_route` 含线路/城市要素。  
5. 「附近目的地」无定位 → `need_location`，非 silent skip。  
6. 反动/色情/暴力 → refuse；消极 → care。  
7. 含错字的旅居问法 → 规范化后仍路由旅居。  
8. 超过 500 字 → 前端/后端拒绝。  
9. 「既要食谱又要旅居线路」→ 主意图本轮执行，次意图入队并可继续。

## 12. 非目标（本期不做）

- 将 Tag-System 作为每轮热路径唯一权威（仅登录校正与实体校验查询）。  
- 强规范化每次强制用户确认（方案 C）。  
- 一次用户消息并行执行多个 skill（仅排队串行）。  
- 改写全部现有 skill 内部业务逻辑（只统一注入契约；探测器按优先 skill 挂载）。

## 13. 实现落点（指导，非本规格的实现步骤）

- flatTalk：`/assistant` / sessionStore / `chat-orchestrator` 前置换 Safety → Normalizer → Extractor；Detector 目录按 skill 注册。  
- 配置：共享 `RoleEntityMap`；Safety 类别与关怀文案可配置。  
- 可观测：query-trace / runtime-events 增加 `identity_status`、`normalize`、`safety`、`intents`、`inject_keys`。

---

**决策摘要**

| 项 | 选择 |
|----|------|
| 总体架构 | Context Bus + Detector Registry |
| 身份来源 | SSO provisional + Tag 校正 |
| 会话抽取 | LLM 主 + 规则校验 |
| 上下文存活 | login 会话级 / turn 对话级 |
| 有害输入 | 硬拦 + 消极关怀 + 审计 |
| 输入规范化 | 轻量勘误，保留原文 |
| 字数 | 500 字硬限 |
| 多意图 | 主执行 + 次排队 |
