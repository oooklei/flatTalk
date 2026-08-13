# 会话身份 vs 技能业务数据：LLM 提示拆分设计

**日期**: 2026-08-14  
**范围**: flatTalk 模板卡 LLM 提示（`template-card` system / user）  
**状态**: 待用户审阅  
**前置**: Context Bus `shared` 会话级 hydrate（姓名/角色/画像/天气，会话缓存）

## 1. 背景与目标

当前 `business_data` 把「会话公用身份/画像」与「本技能接口与资源」混在同一段 `【业务表数据】` 里；`system.md` 不含身份声明。模型难以区分「我是谁 / 代表谁 / 名下老人」与「本轮路线、订单、知识命中」等技能数据。

目标：

1. **system**：用 **1～2 句自然语言**声明会话身份（我是谁、代表机构/服务商、名下老人名单）。  
2. **user**：拆成两块——**会话画像**（完整细节，按需引用）与 **技能业务数据**（本技能接口/资源）。  
3. 提示中明确引用优先级；缺信息追问，不臆造。  
4. 不改动 hydrate/缓存逻辑；本地确定性填槽路径不强制拼 LLM 提示。

成功标准：

- 家属登录后 system 能说出「名下老人：甲、乙」。  
- 机构/服务商 system 能说出「代表机构/服务商：…」。  
- user 中技能包 **不含** 已进身份/画像的会话字段重复大包。  
- 旅居等技能的 `jtd`/`routes` 仅出现在技能业务数据块。

## 2. 架构选型

采用 **方案 1：双变量硬拆 + system 自然语言身份句**（否决：仅拆 user；否决：完整画像进 system）。

```
hydrateSharedContext → Context Bus shared
        ↓
businessData（编排层仍可合并，供本地填槽）
        ↓
splitForPrompt(businessData)          ← model 层拆分（推荐）
   ├─ session_context_text  → system【会话身份】
   ├─ session_profiles      → user【会话画像】
   └─ skill_business_data   → user【技能业务数据】
```

| 单元 | 职责 | 依赖 |
|------|------|------|
| `buildSessionContextText` | 按 `profile_scope` 生成 1～2 句身份 | shared / login 字段 |
| `splitBusinessDataForPrompt` | 拆 profiles vs skill，去重 | businessData |
| `buildMessages` / `fillFallback` | 注入 system 后缀与 user 两块 | prompt 模板 |

## 3. 数据边界

| 变量 | 进哪 | 内容 |
|------|------|------|
| `session_context_text` | **system** | 自然语言 1～2 句（见下表） |
| `session_profiles` | **user** | `entity_profile(s)`（compact）、`weather`、`location`、`city`、`display_name`、`profile_scope`、下属老人简表（可选） |
| `skill_business_data` | **user** | 本技能接口/资源（`jtd`、`routes`、订单、知识附属等）；**剔除**会话字段 |

### 3.1 身份句模板（`profile_scope`）

| scope | 模板 |
|-------|------|
| `self` | `当前用户是{display_name}（老人本人）。` |
| `family_elders` | `当前用户是{user_name}（家属）。你代表其名下老人：{老人名列表}。` |
| `org` | `当前用户是{user_name}（机构侧）。你代表机构：{org_name}。` |
| `service_provider` | `当前用户是{user_name}（服务商侧）。你代表服务商：{provider_name}。` |
| 缺省 | `当前用户是{display_name或user_name}。` |

有城市时可追加半句：`当前关注城市：{city}。`（总长仍控制在约两句）。

### 3.2 从 `skill_business_data` 剔除的字段

`user_name`、`elder_name`、`display_name`、`profile_scope`、`entity_profile`、`entity_profiles`、`weather`、`location`、`city`（仅会话定位时）、`shared`、`user_id`、`role_key`、`role_id`、`org`、`elders`、`elder_id`、`has_elder`、`identity_status` 及同类会话字段。

技能专属字段（如 `jtd`、`routes`、`destination` 作为旅居目的地、订单列表等）保留在 `skill_business_data`。

## 4. 提示词拼装

### 4.1 system（在现有 `system.md` 角色规则之后追加）

```
【会话身份】
{{session_context_text}}

引用约定：身份以本段为准；人物/机构详情见 user 的【会话画像】；本轮业务与资源见【技能业务数据】。缺信息追问，勿臆造。
```

### 4.2 user（`fill-template.md`）

将原 `【业务表数据】{{business_data}}` 替换为：

```
【会话画像】
{{session_profiles}}

【技能业务数据】
{{skill_business_data}}
```

其余块（用户问题、意图、技能、模板库、知识证据、历史）不变。

### 4.3 `fillFallback`

system 同样追加身份句 + 引用约定。默认 **不** 把完整 profiles 再塞进五要素 user 提示，避免膨胀；需要时可后续加精简摘要（本设计范围外）。

### 4.4 本地确定性填槽

不强制走上述 LLM 提示拆分；卡片代码继续读编排层 `businessData`（含合并后的会话字段）。本设计只约束 **远程 LLM** 路径。

## 5. 改动文件清单

| 路径 | 变更 |
|------|------|
| `src/core/context-bus/session-prompt-context.js`（新建） | `buildSessionContextText` + `splitBusinessDataForPrompt` |
| `src/prompts/template-card/system.md` | 身份段 + 引用约定占位 |
| `src/prompts/template-card/fill-template.md` | 两块变量替换原业务表数据 |
| `src/core/model-runtime/template-card-llm-service.js` | `buildMessages` / `fillFallback` 注入 |
| `tests/...` | 身份句按角色；去重；prompt 块断言 |

**明确不做**：改 hydrate TTL/缓存；把 75 tags 完整进 system；改 Context Bus schema 分层存储（编排仍可写合并 `businessData`）。

## 6. 错误与空态

- 无姓名：用「当前用户」或空缺省句，不抛错。  
- 无下属/无机构：省略对应句。  
- 无画像：`session_profiles` 为空对象 `{}` 或 `{ entity_profiles: [] }`，提示仍合法。  
- 拆分函数对非对象 `business_data` 返回空 profiles + 原样/空 skill 包。

## 7. 测试计划

1. **家属**：system 含「名下老人：…」；user 有 `【会话画像】` 与 `【技能业务数据】`；skill 包无 `entity_profile`。  
2. **机构 / 服务商**：system 含「代表机构/服务商：…」。  
3. **老人本人**：system 一句「老人本人」。  
4. **无画像**：身份句可生成；profiles 为空不炸。  
5. **旅居**：`jtd`/`routes` 仅在 skill 块。  
6. 单测覆盖 `buildSessionContextText` 与 `splitBusinessDataForPrompt`，无需真实调模型。

## 8. 引用优先级（写进提示，供模型遵守）

1. 身份与代表关系 → `【会话身份】`  
2. 人物/机构情况细节 → `【会话画像】`  
3. 本轮业务与资源 → `【技能业务数据】`  
4. 仍不足 → 向用户追问，禁止臆造
