# flatTalk 消费 LIS-System 契约

## 边界

| 系统 | 职责 |
|------|------|
| **LIS-System** | 自然语言 → `IntentSupply`；澄清问句；**不执行**业务 |
| **flatTalk** | Catalog 注册、Matcher、执行 Intent 包；**SessionStore 为唯一上下文真相源**；**纯消费者，不重做分拣** |

阈值 **0.5**：优先使用 LIS 返回的 `decision.threshold`，
字段缺失时回退 `matcher.js` 的 `DEFAULT_CONFIDENCE_THRESHOLD = 0.5`。

> LIS 侧有契约测试 `test_threshold_matches_flattalk_fallback` 守着回退值。

---

## 纯 SORT 路由门控（flatTalk 主路径）

启用后（`LIS_GATE_ENABLED=1`），flatTalk **一律** `POST /v1/sort`，不再消费 Gatekeeper Ticket / `/v1/boundary` / action Skill Lock。

| 模式 | 何时 | LIS 调用 |
|------|------|----------|
| **SORT** | 全部自由文本 / followup / action_button（含 `action_key`） | `POST /v1/sort` |
| **CLARIFY** | sort 返回 `NEED_CLARIFY`；或会话有 `pending_clarify_supply` 时点选/续答 | 展示选项；续轮 `POST /v1/clarify` resolve |
| **COMMON 兜底** | LIS 不可达（短重试耗尽）或 SORT 未命中 catalog | **不**走 scene-router 业务 skill；渲染 `skill_key=common` |

> **废止（FT 主路径）**：票制 BOUNDARY、Skill Lock / `defer_action_key`、Supervisor 强锁 `skill_key`、`followup_bypass`、LIS 开启时的 `identifyScene` 业务摆渡。  
> LIS 仍可保留 `/v1/boundary` 供其他消费者；flatTalk **不得依赖**。

### 决策消费（sort / clarify）

| `decision.status` | flatTalk 行为 |
|-------------------|---------------|
| `MATCH_OK` | 取 `role=primary` → Catalog.entry 执行；**不**写入 `routing_ticket`；写入 `lis_locked_scene` 供下轮 soft bias；合并 `slots` 到 context |
| `NEED_CLARIFY` | 展示 `clarify`（经 `ambiguity_options` UI）；`pending_clarify_supply` 存会话 |
| `LLM_FALLBACK_HINT` / 未命中 | 清除 pending；**common 兜底卡**（禁止 scene-router 选业务 skill） |

---

## 上下文投影（flatTalk → LIS）

flatTalk **不**把原始 SessionStore 直接传给 LIS，而是经 **ContextProjector** 投影为两个契约对象：

| 对象 | 说明 |
|------|------|
| **DialogueView** | 最近 N 轮对话；**默认 N=5，硬顶 8** |
| **BizHints** | 业务附载；**`scene.skill_key` 仅来自上一轮 LIS 锁定域**（`lis_locked_scene` / `previous_scene`），禁止 Supervisor 自造 `request.skill_key` |

- `/v1/sort`：必带 `utterance`；有历史时建议附 `dialogue` + `biz_hints`。
- 实现：`src/core/lis/context-projector.js`（`projectDialogueView` / `projectBizHints`）。
- Soft bias：LIS `_DOMAIN_BIAS = 0.2`，仅当 BizHints 提供有效上一场景时生效。

---

## 环境变量

| 变量 | 含义 | 默认 |
|------|------|------|
| `LIS_GATE_ENABLED` | 设为 `1` 启用纯 SORT 门控 | 关闭 |
| `LIS_BASE_URL` | LIS 服务根 URL | `http://127.0.0.1:8100` |
| `LIS_TIMEOUT_MS` | 单次 LIS 调用超时（毫秒） | `2000` |
| `LIS_SORT_RETRIES` | sort 失败后的额外重试次数 | `2`（共最多 3 次尝试） |

接入点：`POST /api/chat/message`，在 skill 执行之前（`src/core/lis/lis-gate-hook.js`）。SOS 仍由 orchestrator 本地处理，不经 LIS。

---

## 容错与降级

门控在 skill 执行 **之前同步执行**，LIS 异常必须被吸收。

| 故障 | 行为 |
|------|------|
| 调用超时 / 连接失败 | 短重试（`LIS_SORT_RETRIES`）→ `reason:'lis_unreachable'` → **common 系统提示卡** |
| 非 2xx | 同上 |
| **熔断开启** | 跳过调用，`handled:false, reason:'lis_unavailable'` → common 兜底 |
| `clarify` 失败 | 清 `pending_clarify_supply`，继续 sort |
| **熔断中有 pending 澄清** | **同样清 `pending_clarify_supply`** |
| 整体异常 | orchestrator catch → common 兜底 |

> **禁止**：LIS 开启且未 handled 时回落 `identifyScene` 选业务 skill（那是摆渡，不是消费）。

**超时是必需的**：客户端用 `AbortController` 在 `LIS_TIMEOUT_MS` 后中断（默认 2000ms）。

### 熔断器（`lis-breaker.js`）

连续失败 **3 次**后开启，冷却 **30s**，之后放一个试探请求：
成功则关闭，失败则重新计时。

为什么需要：LIS 挂起时即使有超时，每个请求仍要白等一整个超时。
实测（超时设 300ms，8 次请求）：

| | 总耗时 |
|---|---|
| 无熔断 | 2411ms（每次都等满） |
| 有熔断 | **909ms**（前 3 次探测，后 5 次 0ms） |

生产超时为 2000ms，LIS 挂起时每个请求可省约 2 秒。

熔断是**进程内**的，不跨实例共享——刻意如此，避免为此引入 Redis 依赖，
且各实例到 LIS 的网络状况本就可能不同。

状态可从 `GET /api/health` 的 `lis.breaker` 观测：

```json
{ "lis": { "gate_enabled": true, "base_url": "...", "timeout_ms": 2000,
  "breaker": { "open": true, "consecutive_failures": 3,
               "suppressed_calls": 3, "cooldown_remaining_ms": 29789 } } }
```

### 健康探测

`GET /api/intent/health` 会**实际探一次 LIS**（`GET {LIS_BASE_URL}/health`），
用于部署/排障时确认「LIS 起没起、用的哪套配置」，不必先发一条聊天消息去猜：

```json
{
  "classifier": "lis-gate",
  "route": "lis-gate -> matcher -> local-skill-runtime (fallback: scene-router)",
  "lis": {
    "gate_enabled": true, "base_url": "http://127.0.0.1:8100", "timeout_ms": 2000,
    "breaker": { "open": false, ... },
    "probe": { "reachable": true, "latency_ms": 15,
               "scorer": "hybrid", "encoder": "onnx", "lis_version": "1.0.0" }
  }
}
```

LIS 不可达时 `probe.reachable: false` 并带 `error`（连接失败 / `HTTP 5xx` / `timeout after Nms`）。

探测**不计入熔断**（它不是聊天主流程），且**永不抛异常**，健康端点可安全依赖。

> `classifier` / `route` 原先硬编码为 `rules` 和不含 LIS 的链路，
> 门控启用后会误导排障（看着像根本没接 LIS）。现按实际配置输出。

失败会打 `console.warn('[LIS-GATE] call failed', { op, error, consecutive_failures })`，
开启/恢复各有一条日志。

所有降级终点都是 **common 兜底卡**（`skill_key=common`），**禁止**回落 `identifyScene` 选业务 skill。

已知能力：`LIS_SORT_RETRIES`（默认 2）短重试；熔断避免持续无效调用。

---

## Matcher 规则

实际实现（`src/core/lis/matcher.js`）：

1. 只对 `IntentSupply.intents[]` 与本地 **已启用** Catalog 条目求交。  
2. **显式取 `role === 'primary'`**；若 primary 不在本地目录内，回退取
   `confidence` 最高者。执行键唯一：`intent_id`。  
3. 阈值取 `decision.threshold`（LIS 下发），缺失回退 0.5。  
4. **始终用 `max_confidence` 与 threshold 比较**；即使 status 为 `MATCH_OK`，
   置信度不达标也不执行（避免 LIS 抬高门槛后 FT 侧短路放行）。  
5. 匹配失败（分数不足或目录无此 intent）→ `ok:false` → 降级 scene-router。  
6. 收到 `LLM_FALLBACK_HINT` → LLM。

**为什么显式读 `role` 而非取最高分**：LIS 的域软偏置会给同域候选 `+0.05`
并重排序。两侧各自"取最大值"当前恰好一致，但那是巧合而非契约 ——
显式读 `role` 才能保证与 LIS 认定的 primary 一致。

### 次意图转追问建议（`suggestions`）

`matchSupplyToCatalog` 返回 `suggestions[]`，由 `confidence >= 0.6` 的
`role=secondary` 候选构成，最多 2 条，已禁用的目录项不入选。
gate 结果里字段名为 `intent_suggestions`。

**只做建议、不做执行**。依据（实测语料）：

```
「给我做个控糖食谱」                       ← 噪音，应丢弃
  secondary travel_route_plan     0.31
  secondary nearby_resource.food  0.07

「防城港三日游天气怎么样」                  ← 真双意图，应建议
  secondary travel_route_weather_risk  0.75
```

无条件组合执行会给第一句弹出莫名其妙的线路卡；做成按钮则用户不点即无副作用。
阈值常量：`matcher.js` 的 `SECONDARY_SUGGEST_THRESHOLD`。

#### 渲染链路

`chat-orchestrator` 把 `intent_suggestions` 传给
`composeInteractions({ lisSuggestions })`，最终并入 `followup_suggestions`
（即卡片底部的追问按钮），归类为 `category: 'other'`，排在场景紧密追问之后。

两个非显然的实现约束（改动前务必了解）：

1. **不能走 `filterByScene`**。该函数按 `action_key` 的场景前缀过滤，
   而 LIS 建议本质是跨技能的（线路卡上建议查天气），会被整批丢掉。
   故在 `filterByScene` 之后并入。

2. **不设 `action_key`**。`followupIntentKey` 会原样返回 `action_key`，
   若填 LIS 的 `intent_id`（`travel_route_weather_risk`），就无法与场景既有的
   同义追问（`travel_route.check_weather_risk`）归并 —— 卡片底部会出现
   「查看天气风险」和「查询旅居目的地天气与出行风险」两个近义按钮。
   留空让 `followupIntentKey` 走文案归一，交给 `uniqueFollowup` 去重。
   路由靠 `user_prompt` 重新过一遍 LIS 分拣。

实测：同义建议被去重（天气按钮仍只 1 个、总数不变）；
跨技能新建议保留（3 → 4 个）。

**boundary STAY 的 status 用 `BOUNDARY_STAY` 而非 `MATCH_OK`**：
硬编码 `MATCH_OK` 会让第 4 条短路，使 `threshold` 永不参与判定 ——
LIS 抬高 boundary 门槛时 flatTalk 不会跟随。改用非 MATCH_OK 的标记后，
走的是第 3 条的实际比较。

**`NEED_CLARIFY` 要求 `clarify.options` 非空**：只有问句没有按钮是死胡同，
用户无法推进。LIS 的兜底选项会与 `catalog_intent_ids` 求交，交集为空时
`options` 就是空的 —— 此时直接降级，而非把会话留在澄清态。

**设计原文写了但未实现**（当前无对应代码，不要误以为已生效）：

| 原文设想 | 现状 |
|---------|------|
| 打分用 `confidence` × 描述相似度 | ❌ 只用 confidence，`intent_desc` / `match_hints.embedding_text` 未参与 |
| `domain` 仅加分不淘汰 | ⚠️ flatTalk 侧未参与打分；**LIS 侧**有 `+0.05` 软偏置且从不淘汰 |
| 取 `role=primary`（及可组合 `secondary`） | ✅ 已实现（`secondary` 为追问建议，非并行执行） |
| 合并 `slots`（含 `biz_hints.geo`）到 context | ⚠️ 仅回写 `city` / `destination`，非完整合并 |

## Catalog 来源（迁移）

**当前运行时唯一数据源是 `docs/LIS-System/catalog.sample.json`**（9 条，手工维护）。
文件名带 sample 但它是真实生效的数据，不是样例。

设计原文设想由以下来源导出，**尚未实现**（无导出脚本）：

- `src/core/scene-router/intent-template-map.js` 的 intent → template  
- 各 `rules/*.js` 的 `infer_intent` 枚举  
- skill/template manifest 描述  

Schema：`intent-catalog.schema.json`。样例只用了 schema 的子集
（未使用 `slots_schema` / `composability`）。

### 加载与缓存

`loadCatalogEntries()` 按 **mtime + size** 缓存：

- **支持热加载** — 改 JSON 立即生效，无需重启
- 文件未变时复用解析结果，避免每个 chat 请求都同步读盘 + `JSON.parse`
- JSON 损坏 / 文件缺失时**沿用上次成功结果**，不会让目录突然清空

实测 200 次调用：优化前 202 次读盘 → 优化后 **1 次**，热加载仍有效。

## 示例 Catalog 条目

```json
{
  "intent_id": "nearby_resource.food",
  "intent_desc": "查询周边餐饮、餐馆、美食",
  "examples": ["附近有什么好吃的", "周边餐厅"],
  "domain": "nearby_resource",
  "tags": ["poi", "food"],
  "entry": {
    "kind": "template",
    "skill_key": "nearby_resource",
    "template_id": "nearby_food_card"
  },
  "enabled": true
}
```

---

## 设计文档

Gatekeeper Ticket 完整架构见 LIS-System 设计 spec（**注意**：本目录 `../LIS-System/...` 相对链接在 flatTalk 独立仓库中可能无法解析）：

- **设计 spec**：`D:\GuiCare\LIS-System\docs\superpowers\specs\2026-08-08-lis-flattalk-gatekeeper-ticket-design.md`
- **实现计划**：`D:\GuiCare\LIS-System\docs\superpowers\plans\2026-08-08-lis-flattalk-gatekeeper-ticket.md`

Monorepo 根目录下相对路径：`LIS-System/docs/superpowers/specs/2026-08-08-lis-flattalk-gatekeeper-ticket-design.md`。
