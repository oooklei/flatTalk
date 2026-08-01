# flatTalk 多智能体分层架构设计

> 日期: 2026-08-01
> 状态: 已确认，待实施
> 替代: 单体 chat-orchestrator.js 16步线性流水线

---

## 一、背景与问题

### 1.1 当前架构的致命缺陷

当前系统是"单智能体 + 7技能"架构，所有请求经过 `chat-orchestrator.js` 的 390 行 `run()` 方法：

| 缺陷 | 根因 | 表现 |
|------|------|------|
| **意图乱窜** | 7套场景规则并行评分竞争，关键词高度重叠（旅居词汇在 intent-classifier SERVICE_WORDS 和 scene-router travel-route 中都匹配） | 用户说"周边休闲"被路由到 service_thinking 卡片 |
| **按钮动作失控** | skill_key 有5条确定路径互相打架；followup bypass 仅在 skill_key 已知时生效 | 点"找护工上门"显示"AI正在分析"然后死循环 |
| **模板选择双轨制** | intent-template-map.js 和 model-service.js selectTemplateId 两套独立逻辑 | 可能产生不一致的模板选择 |
| **无上下文隔离** | session-store 单一 turns 数组 | 切换技能时上一技能上下文影响当前判断 |
| **单体编排器耦合** | 场景特例（天气查询、城市提取）内联在主流程中 | 新增技能需修改编排器主流程 |

### 1.2 设计目标

- 意图不再乱窜：一次定向路由，不做7路竞争评分
- 上下文隔离：每个子智能体独立会话上下文，切换时冻结/恢复
- 按钮确定性：action_key 前缀直接定位 Agent，零歧义
- 越界感知：子智能体自检能否处理，不能则主动声明切换
- 渐进改造：不丢弃现有代码，复用已有的填充/渲染/数据加载函数

---

## 二、整体架构

```
用户消息
  │
  ▼
┌──────────────────────────────────────────┐
│  Supervisor Agent（总智能体）              │
│  ─ 路由决策（一跳分类，非7路竞争）          │
│  ─ 维护 active_agent 状态                  │
│  ─ SOS 紧急短路                            │
│  ─ 越界切换协调                            │
│  ─ 全局上下文管理（user_profile, location） │
└──────────┬───────────────────────────────┘
           │ routeTo(agentKey)
     ┌─────┼─────┬─────┬─────┬─────┬─────┬─────┐
     ▼     ▼     ▼     ▼     ▼     ▼     ▼
  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
  │膳食 │旅居 │周边 │服务 │健康 │调度 │通用 │
  │Agent│Agent│Agent│Agent│Agent│Agent│Agent│
  └──┬──┴──┬──┴──┬──┴──┬──┴──┬──┴──┬──┴──┬──┘
     │     │     │     │     │     │     │
     ▼     ▼     ▼     ▼     ▼     ▼     ▼
  ┌──────────────────────────────────────────┐
  │  共享基础设施层（复用现有代码）             │
  │  ─ fillTemplateSlots / fillXxxCard        │
  │  ─ loadBusinessData                       │
  │  ─ composeInteractions                    │
  │  ─ renderTemplateCardResult               │
  │  ─ retrieveMultiKnowledge                 │
  │  ─ action-resource-map                    │
  └──────────────────────────────────────────┘
```

---

## 三、Supervisor Agent（总智能体）

### 3.1 职责

Supervisor **不做细粒度意图识别**，不调用 LLM 做意图分类，只做**确定性路由**：

1. SOS 紧急短路
2. action_key 前缀匹配（确定性路由）
3. active_agent 领域保持（当前Agent能处理就不切换）
4. 关键词领域匹配（切换到新Agent）
5. 兜底通用Agent

### 3.2 路由决策流程

```
routeTo(message, context) → { agentKey, switched, reason }

Step 1: SOS 检测
  → 命中 → routeTo('health_risk', { emergency: true })
  → 短路返回

Step 2: action_key 前缀匹配（按钮触发，确定性）
  action_key = context.action_key
  → 'meal_plan.*'     → routeTo('meal_plan')
  → 'travel_route.*'  → routeTo('travel_route')
  → 'nearby_resource.*' → routeTo('nearby_resource')
  → 'find_service.*'  → routeTo('find_service')
  → 'health_risk_warning.*' → routeTo('health_risk_warning')
  → 'dispatch_manage.*' → routeTo('dispatch_manage')
  → 零歧义，直接返回

Step 3: active_agent 领域保持（延续对话）
  activeAgent = context.active_agent
  if activeAgent exists:
    result = agents[activeAgent].canHandle(message, context)
    if result === true:
      → routeTo(activeAgent, { switched: false })
      → 不切换

Step 4: 关键词领域匹配
  对每个 agent 执行 agent.matchScore(message)
  取 top1
  if top1.score >= threshold:
    if top1.key !== activeAgent:
      → routeTo(top1.key, { switched: true, from: activeAgent })
    else:
      → routeTo(top1.key, { switched: false })

Step 5: 兜底
  → routeTo('common')
```

### 3.3 关键设计决策

**为什么不用7路评分竞争？**

当前 scene-router 的7套规则并行评分存在关键词重叠问题。例如"周边的旅游景点"会同时命中 `nearby_resource`（place_terms）和 `travel_route`（travel_topic），导致 margin 不足而 reject→common。

新方案中，**步骤3优先**：如果用户正在跟膳食Agent对话，说"换成软烂版"，膳食Agent先自检能否处理（能），就不切换。只有当前Agent处理不了时，才进入步骤4做关键词匹配。

**为什么 action_key 优先级最高？**

action_key 是按钮触发的确定性信号，不存在歧义。当前架构的问题是5条 skill_key 确定路径互相打架——新架构中，action_key 前缀是**唯一**的路由信号源（按钮场景下），不存在竞争。

### 3.4 与现有 scene-router 的关系

| 现有组件 | 处理方式 |
|---------|---------|
| `scene-router/index.js` identifyScene | **替换**为 Supervisor 的 routeTo |
| `scene-router/scoring-engine.js` | **不再用于主路由**；评分函数下放给各Agent的 matchScore |
| `scene-router/rules/*.js` | **拆分**：每个规则集的 evidence_groups 词表移入对应Agent的 matchScore |
| `intent-classifier/` | **保留**：只做 SOS 检测和 urgency_level，不再参与场景路由 |
| `intent-template-map.js` | **废弃**：模板选择由各Agent内部决定 |

---

## 四、SubAgent（子智能体）接口规范

### 4.1 统一接口

每个子智能体实现以下接口：

```javascript
/**
 * @typedef {Object} AgentRequest
 * @property {string} message - 用户消息
 * @property {Object} context - 请求上下文（active_agent, action_key, action_params, user_profile, location...）
 * @property {Object} agentContext - 本Agent独立的会话上下文（turns, last_template, scoped_data）
 * @property {Object} globalContext - 跨Agent共享的全局上下文
 * @property {Object} infra - 共享基础设施（fillTemplateSlots, loadBusinessData, renderTemplateCard, ...）
 */

/**
 * 子智能体统一接口
 */
const SubAgent = {
  /** Agent标识 */
  key: 'meal_plan',

  /** Agent显示名 */
  name: '膳食助手',

  /**
   * 领域匹配分数 — Supervisor 步骤4调用
   * 复用原 scene-router rules 的 evidence_groups 词表
   * @param {string} message
   * @returns {number} 0-1
   */
  matchScore(message) { ... },

  /**
   * 自检能否处理 — Supervisor 步骤3调用
   * @param {string} message
   * @param {Object} context
   * @returns {boolean | { suggest: string, reason: string }}
   */
  canHandle(message, context) { ... },

  /**
   * 处理消息 — 核心执行
   * 复用现有 fillTemplateSlots / loadBusinessData / renderTemplateCardResult
   * @param {AgentRequest} req
   * @returns {Promise<AgentResponse>}
   */
  async handle(req) { ... },

  /**
   * 获取追问/动作按钮 — 复用现有 composeInteractions
   * @param {Object} agentContext
   * @param {string} templateId
   * @returns {{ actions: [], followups: [], compact_followups: [] }}
   */
  getInteractions(agentContext, templateId) { ... },
};
```

### 4.2 AgentResponse 结构

```javascript
/**
 * @typedef {Object} AgentResponse
 * @property {string} template_id - 选中的模板
 * @property {Object} data - 模板数据
 * @property {Object} interactions - 动作/追问
 * @property {string} reply_text - 回复文本（卡片摘要）
 * @property {boolean} should_switch - Agent主动声明越界
 * @property {string} [suggest_agent] - 建议切换到的Agent
 * @property {string} [switch_reason] - 切换原因（展示给用户）
 */
```

### 4.3 七个子智能体

| Agent | key | action_key前缀 | 原始scene规则 | 独占模板 | 独占数据源 |
|-------|-----|---------------|-------------|---------|-----------|
| 膳食 | meal_plan | `meal_plan.*` | meal-plan.js | diet_card, weekly_plan, meal_* | diet_risk |
| 旅居 | travel_route | `travel_route.*` | travel-route.js | travel_*, route_card | travel_routes, poi_cache |
| 周边 | nearby_resource | `nearby_resource.*` | nearby-resource.js | nearby_map, nearby_list, nearby_spot_card | nearby_pois |
| 服务 | find_service | `find_service.*` | find-service.js | service_recommend, worker_profile, org_profile, service_detail, order_status | service_catalog, orgs, workers, orders |
| 健康 | health_risk_warning | `health_risk_warning.*` | health-risk-warning.js | health_warning_card | health_records |
| 调度 | dispatch_manage | `dispatch_manage.*` | dispatch-manage.js | dispatch_list | dispatch_orders |
| 通用 | common | （无前缀） | elder-policy.js | answer, fallback_error, policy_* | policies |

---

## 五、上下文隔离与恢复

### 5.1 SessionStore 结构改造

```
SessionStore（改造后）
{
  conversation_id,
  active_agent: "meal_plan",          // 当前活跃Agent

  agents: {
    meal_plan: {
      turns: [
        { turn_id, user_message, envelope: {...}, created_at }
      ],
      last_template: "diet_card",
      scoped_data: { condition: "diabetes", texture: "soft" },  // Agent内部状态
      frozen: false,   // 是否冻结（切换到其他Agent时冻结）
    },
    travel_route: {
      turns: [...],
      last_template: "travel_itinerary_card",
      scoped_data: { cities: ["昆明","大理"] },
      frozen: true,
    },
    // 其他Agent按需创建（首次路由时lazy-init），不预分配
  },

  global_context: {
    user_profile: { name, age, role, condition },
    location: { city, org_name },
    conversation_history: [  // 扁平化的全局摘要（用于Supervisor路由参考）
      { agent: "meal_plan", message: "今天吃什么", ts: ... },
      { agent: "travel_route", message: "大理旅居", ts: ... },
    ]
  },

  updated_at,
}
```

### 5.2 冻结与恢复机制

```
切换流程: meal_plan → travel_route

1. Supervisor 决定切换:
   agents.meal_plan.frozen = true     // 冻结膳食Agent
   active_agent = "travel_route"       // 激活旅居Agent

2. travel_route Agent 加载（首次或恢复）:
   if agents.travel_route exists && agents.travel_plan.frozen:
     → 恢复 turns + last_template + scoped_data
     → 继续之前的对话
   else:
     → lazy-init agents.travel_route = { turns: [], scoped_data: {} }

3. 用户切回 meal_plan:
   agents.travel_route.frozen = true
   agents.meal_plan.frozen = false
   active_agent = "meal_plan"
   → 恢复膳食Agent的 turns + last_template + scoped_data
```

### 5.3 与前端 localStorage 的兼容

前端 `persistHistory()` 当前存储扁平的 conversations 数组。改造后：

- **不改变前端存储结构**：前端仍然存 `conversations[].messages[]`
- 每个 message 增加 `agent_key` 字段（从 envelope.agent_key 获取）
- 前端按时间线展示所有Agent的混合对话（用户感知不到切换）
- 历史搜索面板按 agent_key 分组高亮

### 5.4 数据库持久化

`conversation_turns` 表新增 `agent_key` 列：

```sql
ALTER TABLE conversation_turns ADD COLUMN agent_key TEXT DEFAULT 'common';
CREATE INDEX idx_turns_agent ON conversation_turns (conversation_id, agent_key);
```

---

## 六、越界检测与切换提示

### 6.1 canHandle 自检逻辑

每个Agent的 `canHandle` 基于两个维度判断：

1. **模板覆盖**：消息是否在该Agent的模板覆盖范围内
2. **领域词表**：消息是否包含该Agent的领域关键词

```javascript
// 示例：膳食Agent的 canHandle
canHandle(message, context) {
  const text = message.toLowerCase();

  // 模板覆盖：当前在膳食卡片上，用户说"换软烂版"
  if (context.last_template?.startsWith('diet_') || context.last_template?.startsWith('meal_') ||
      context.last_template === 'weekly_plan') {
    if (/软烂|清淡|换|调整|加|减|不要|少吃|多吃/.test(text)) {
      return true;  // 当前膳食Agent能处理
    }
  }

  // 领域词表命中
  if (/膳食|饮食|吃饭|食谱|营养|忌口|血糖|血压/.test(text)) {
    return true;
  }

  // 明确属于其他领域 → 声明越界
  if (/旅居|旅游|出行|景点|机构|护工|派单|周边/.test(text)) {
    const suggest = this.detectTargetAgent(text);
    return { suggest, reason: `您询问的是「${suggest}」相关的问题` };
  }

  return false;  // 不确定，交给Supervisor决策
}
```

### 6.2 切换提示展示

当Agent主动声明越界时，Supervisor 向用户展示提示：

```
Supervisor 收到 AgentResponse { should_switch: true, suggest_agent: 'travel_route', switch_reason: '您询问的是旅居相关的问题' }

→ 前端渲染一个轻量切换提示气泡:
  "您的问题属于旅居规划，已为您切换到旅居助手 🔄
   之前的话题我记着呢，随时可以回来。"

→ 然后自动用 travel_route Agent 处理同一条消息
```

### 6.3 用户主动切换

用户也可以显式切换：

- 语音/文字："我想问旅居的事" → Supervisor 步骤4关键词匹配命中 travel_route
- 按钮触发：点击旅居相关 action_key → Supervisor 步骤2确定性路由

---

## 七、文件结构

### 7.1 新增文件

```
src/core/agents/
├── supervisor.js                    # Supervisor Agent（总智能体）
├── base-agent.js                    # SubAgent 基类（提供共享方法）
├── agent-registry.js                # Agent注册表（管理7个子智能体）
└── agents/
    ├── meal-plan-agent.js           # 膳食子智能体
    ├── travel-route-agent.js        # 旅居子智能体
    ├── nearby-resource-agent.js     # 周边子智能体
    ├── find-service-agent.js        # 服务子智能体
    ├── health-risk-agent.js         # 健康子智能体
    ├── dispatch-manage-agent.js     # 调度子智能体
    └── common-agent.js             # 通用子智能体
```

### 7.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/core/conversation/session-store.js` | 增加 agents 结构、freeze/restore 方法 |
| `src/app.js` | handleChat 改为调用 supervisor.route() 而非 orchestrator.run() |
| `src/core/actions/action-dispatcher.js` | dispatchAction 通过 supervisor 路由 |
| `src/core/interaction-composer.js` | 查询 interactions 时带上 agent_key |
| `src/public/mobile.js` | 消息渲染增加 agent_key 标记；切换提示气泡 |

### 7.3 保留不动的文件

| 文件 | 原因 |
|------|------|
| `src/core/model-service.js` | fillTemplateSlots 等函数被各Agent复用 |
| `src/core/template-card/` | 渲染层不变 |
| `src/core/actions/action-resource-map.json` | 资源映射被各Agent复用 |
| `src/skills/*/templates/` | 所有模板文件不变 |
| `src/core/intent-classifier/` | SOS检测保留，不参与场景路由 |

### 7.4 逐步废弃

| 文件 | 处理 |
|------|------|
| `src/core/orchestrator/chat-orchestrator.js` | Phase 3 完成后废弃，功能拆入 supervisor + agents |
| `src/core/scene-router/index.js` | Phase 1 完成后废弃，词表拆入各Agent的 matchScore |
| `src/core/scene-router/rules/*.js` | Phase 1 完成后拆分到各Agent |
| `src/core/scene-router/intent-template-map.js` | Phase 1 完成后废弃 |

---

## 八、实施计划（三阶段）

### Phase 1: Supervisor 路由层（解决意图乱窜）

**目标**: 用 Supervisor 的一跳分类替换 scene-router 的7路评分

**改动**:
1. 创建 `src/core/agents/supervisor.js` — 路由决策逻辑
2. 创建 `src/core/agents/agent-registry.js` — 注册7个子智能体（轻量版，只含 matchScore + canHandle）
3. 创建 `src/core/agents/base-agent.js` — 共享基类
4. 创建 7 个 agent 文件（轻量版，handle 方法委托给现有 orchestrator 流程）
5. 修改 `src/app.js` — handleChat 调用 supervisor.route()

**效果**: 路由不再竞争评分，action_key 确定性路由，active_agent 延续优先

**验证**: 现有测试全部通过 + 新增 supervisor 路由测试

### Phase 2: Agent 上下文隔离（解决上下文串扰）

**目标**: 每个 Agent 独立会话上下文

**改动**:
1. 改造 `session-store.js` — 增加 agents 结构、freeze/restore
2. 各 Agent 的 handle 方法从 agentContext 读取/写入上下文
3. `conversation_turns` 表增加 agent_key 列
4. 前端消息增加 agent_key 标记

**效果**: 切换 Agent 时上下文隔离，切回时恢复

**验证**: 切换场景测试 — 膳食→旅居→切回膳食，膳食上下文完整恢复

### Phase 3: Agent 自检与越界切换（智能切换体验）

**目标**: Agent 主动声明越界 + 切换提示

**改动**:
1. 各 Agent 完善 canHandle 逻辑
2. Supervisor 处理 should_switch 信号
3. 前端切换提示气泡
4. 废弃 chat-orchestrator.js（功能完全拆入 supervisor + agents）

**效果**: 智能切换，用户感知自然

**验证**: 越界检测测试 + 用户切换体验测试

---

## 九、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Phase 1 引入新 bug | 中 | 保留 chat-orchestrator.js 作为 fallback，supervisor 路由失败时降级到原流程 |
| 上下文隔离破坏现有对话历史 | 低 | 前端存储结构不变，只增加 agent_key 字段；数据库做 migration |
| Agent 划分粒度不够 | 低 | 每个Agent内部仍可按 template_id 细分，无需再拆 |
| 性能下降 | 低 | 路由从7路并行评分变成1次定向，实际更快 |

---

## 十、验收标准

| 指标 | 目标 |
|------|------|
| 意图路由准确率 | >= 95%（按钮触发 100%，自然语言 >= 90%） |
| 切换响应时间 | <= 100ms（不含模板填充和渲染） |
| 上下文恢复完整率 | 100%（切回Agent时 turns + scoped_data 完整恢复） |
| 现有测试通过率 | 100% |
| 代码可维护性 | supervisor.js < 200行，每个 agent < 300行 |
