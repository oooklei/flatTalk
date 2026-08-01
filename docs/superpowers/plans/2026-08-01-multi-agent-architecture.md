# 多智能体分层架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单体 chat-orchestrator 的 7 路评分竞争路由替换为 Supervisor-SubAgent 分层调度，实现意图精准路由和上下文隔离。

**Architecture:** Supervisor Agent 做一跳定向路由（action_key 前缀 → active_agent 保持 → 关键词匹配 → 兜底），7 个子 Agent 各自拥有独立上下文（turns/scoped_data），复用现有 fillTemplateSlots/loadBusinessData/renderTemplateCardResult 等基础设施。三阶段渐进实施。

**Tech Stack:** Node.js ESM, 无外部框架, node --test 测试框架

---

## File Structure

### 新增文件

| 文件 | 职责 | 行数估算 |
|------|------|---------|
| `src/core/agents/agent-registry.js` | Agent 注册表，管理 7 个子智能体的注册和查找 | ~60 |
| `src/core/agents/supervisor.js` | Supervisor 总智能体，路由决策 + SOS 短路 + 切换协调 | ~180 |
| `src/core/agents/base-agent.js` | SubAgent 基类，提供 matchScore/canHandle/handle 的默认实现 | ~120 |
| `src/core/agents/agents/meal-plan-agent.js` | 膳食子智能体 | ~100 |
| `src/core/agents/agents/travel-route-agent.js` | 旅居子智能体 | ~100 |
| `src/core/agents/agents/nearby-resource-agent.js` | 周边子智能体 | ~100 |
| `src/core/agents/agents/find-service-agent.js` | 服务子智能体 | ~100 |
| `src/core/agents/agents/health-risk-agent.js` | 健康子智能体 | ~80 |
| `src/core/agents/agents/dispatch-manage-agent.js` | 调度子智能体 | ~80 |
| `src/core/agents/agents/common-agent.js` | 通用子智能体 | ~60 |
| `tests/agent-registry.test.js` | Agent 注册表测试 | ~80 |
| `tests/supervisor-routing.test.js` | Supervisor 路由测试 | ~150 |
| `tests/agent-context-isolation.test.js` | 上下文隔离测试 | ~120 |

### 修改文件

| 文件 | 改动范围 |
|------|---------|
| `src/runtime/local-skill-runtime.js` | 改为调用 supervisor.route() 而非 orchestrator.run() |
| `src/core/conversation/session-store.js` | 增加 agents 结构、freeze/restore 方法 |
| `src/app.js` | handleChat 传入 active_agent 上下文 |

### 保留不动

- `src/core/model-service.js` — fillTemplateSlots 等函数被各 Agent 复用
- `src/core/template-card/` — 渲染层不变
- `src/core/actions/action-resource-map.json` — 资源映射被各 Agent 复用
- `src/skills/*/templates/` — 所有模板文件不变

---

## Phase 1: Supervisor 路由层

### Task 1: Agent 注册表

**Files:**
- Create: `src/core/agents/agent-registry.js`
- Test: `tests/agent-registry.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/agent-registry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRegistry } from '../src/core/agents/agent-registry.js';

test('createAgentRegistry registers and retrieves agents', () => {
  const registry = createAgentRegistry();
  const mockAgent = { key: 'meal_plan', name: '膳食助手', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) };
  registry.register(mockAgent);
  assert.equal(registry.get('meal_plan'), mockAgent);
});

test('createAgentRegistry list returns all registered agents', () => {
  const registry = createAgentRegistry();
  registry.register({ key: 'meal_plan', name: 'A', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) });
  registry.register({ key: 'common', name: 'B', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) });
  const all = registry.list();
  assert.equal(all.length, 2);
});

test('createAgentRegistry returns undefined for unknown agent', () => {
  const registry = createAgentRegistry();
  assert.equal(registry.get('nonexistent'), undefined);
});

test('createAgentRegistry findByActionPrefix matches action_key prefixes', () => {
  const registry = createAgentRegistry();
  registry.register({ key: 'meal_plan', name: 'A', actionPrefix: 'meal_plan', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) });
  registry.register({ key: 'travel_route', name: 'B', actionPrefix: 'travel_route', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) });
  assert.equal(registry.findByActionPrefix('meal_plan.adjust_for_condition')?.key, 'meal_plan');
  assert.equal(registry.findByActionPrefix('travel_route.check_weather_risk')?.key, 'travel_route');
  assert.equal(registry.findByActionPrefix('unknown.action'), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agent-registry.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/core/agents/agent-registry.js

/**
 * Agent 注册表 — 管理 7 个子智能体的注册、查找和 action_key 前缀匹配
 */
export function createAgentRegistry() {
  const agents = new Map();

  return {
    register(agent) {
      if (!agent?.key) throw new Error(`Agent must have a key, got: ${JSON.stringify(agent?.key)}`);
      agents.set(agent.key, agent);
    },

    get(key) {
      return agents.get(key);
    },

    list() {
      return Array.from(agents.values());
    },

    /**
     * 通过 action_key 前缀匹配 Agent
     * action_key 格式: 'meal_plan.adjust_for_condition' → 前缀 'meal_plan'
     */
    findByActionPrefix(actionKey) {
      if (!actionKey || typeof actionKey !== 'string') return undefined;
      const prefix = actionKey.split('.')[0];
      return agents.get(prefix);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agent-registry.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/agent-registry.js tests/agent-registry.test.js
git commit -m "feat(agents): add agent registry with action_key prefix matching"
```

---

### Task 2: BaseAgent 基类

**Files:**
- Create: `src/core/agents/base-agent.js`
- Test: `tests/agent-registry.test.js`（追加到同文件）

- [ ] **Step 1: Write the failing test**

追加到 `tests/agent-registry.test.js` 末尾：

```javascript
import { createBaseAgent } from '../src/core/agents/base-agent.js';

test('createBaseAgent matchScore returns 0 for empty keyword config', () => {
  const agent = createBaseAgent({ key: 'test', name: 'Test' });
  assert.equal(agent.matchScore('任意消息'), 0);
});

test('createBaseAgent matchScore returns positive score for keyword hit', () => {
  const agent = createBaseAgent({
    key: 'test',
    name: 'Test',
    keywords: ['膳食', '饮食', '吃饭'],
  });
  assert.ok(agent.matchScore('今天膳食吃什么') > 0);
  assert.equal(agent.matchScore('今天天气不错'), 0);
});

test('createBaseAgent matchScore weights evidence groups correctly', () => {
  const agent = createBaseAgent({
    key: 'test',
    name: 'Test',
    evidenceGroups: [
      { group: 'topic', weight: 3, terms: ['膳食', '饮食'] },
      { group: 'time', weight: 2, terms: ['早餐', '午餐'] },
    ],
  });
  const score1 = agent.matchScore('膳食安排');
  const score2 = agent.matchScore('早餐安排');
  // topic weight=3 应高于 time weight=2
  assert.ok(score1 > score2, `topic score ${score1} should be > time score ${score2}`);
});

test('createBaseAgent canHandle returns true when keywords match', () => {
  const agent = createBaseAgent({
    key: 'test',
    name: 'Test',
    keywords: ['膳食', '饮食'],
    boundaryTerms: ['旅居', '护工'],
  });
  assert.equal(agent.canHandle('今天膳食吃什么', {}), true);
});

test('createBaseAgent canHandle returns suggest when boundary term hit', () => {
  const agent = createBaseAgent({
    key: 'test',
    name: 'Test',
    keywords: ['膳食'],
    boundaryTerms: ['旅居', '护工'],
    boundaryMap: { '旅居': 'travel_route', '护工': 'find_service' },
  });
  const result = agent.canHandle('我想了解旅居', {});
  assert.deepEqual(result, { suggest: 'travel_route', reason: '旅居' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agent-registry.test.js`
Expected: FAIL with "Cannot find module '../src/core/agents/base-agent.js'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/core/agents/base-agent.js

/**
 * 计算词表命中得分
 * @param {string} text - 用户消息（已转小写）
 * @param {Array} evidenceGroups - [{ group, weight, terms }]
 * @returns {number}
 */
function scoreEvidenceGroups(text, evidenceGroups) {
  if (!evidenceGroups || !text) return 0;
  let score = 0;
  for (const eg of evidenceGroups) {
    for (const term of eg.terms) {
      if (text.includes(String(term).toLowerCase())) {
        score += eg.weight;
        break; // 每个 group 只计一次命中
      }
    }
  }
  return score;
}

/**
 * 计算简单关键词命中
 */
function scoreKeywords(text, keywords) {
  if (!keywords || !text) return 0;
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(String(kw).toLowerCase())) hits++;
  }
  return hits;
}

/**
 * SubAgent 基类工厂
 * 提供 matchScore / canHandle 的默认实现，子类可覆盖
 */
export function createBaseAgent(config = {}) {
  const {
    key,
    name,
    actionPrefix = key,
    keywords = [],
    evidenceGroups = [],
    boundaryTerms = [],
    boundaryMap = {},
    threshold = 1,
  } = config;

  return {
    key,
    name,
    actionPrefix,

    /**
     * 领域匹配分数 — Supervisor 步骤4调用
     * 返回 0-1 的归一化分数
     */
    matchScore(message) {
      const text = String(message || '').toLowerCase();
      if (!text) return 0;

      let raw;
      if (evidenceGroups.length > 0) {
        raw = scoreEvidenceGroups(text, evidenceGroups);
      } else {
        raw = scoreKeywords(text, keywords);
      }

      // 归一化到 0-1（sigmoid-like）
      return Math.min(1, raw / Math.max(threshold, 1));
    },

    /**
     * 自检能否处理 — Supervisor 步骤3调用
     * 返回 true | { suggest, reason }
     */
    canHandle(message, context = {}) {
      const text = String(message || '').toLowerCase();
      if (!text) return false;

      // 检查边界词（其他领域的关键词）
      for (const term of boundaryTerms) {
        if (text.includes(String(term).toLowerCase())) {
          const suggest = boundaryMap[term];
          if (suggest && suggest !== key) {
            return { suggest, reason: term };
          }
        }
      }

      // 检查自身领域关键词
      const score = this.matchScore(message);
      if (score >= 0.3) return true;

      // 模板延续：如果上一轮是该Agent的模板，简短指令视为延续
      const lastTemplate = context.last_template || context.previous_template;
      if (lastTemplate && context.active_agent === key) {
        if (/换|调整|改成|继续|再|这个|不要|加|减|更多|软烂|清淡/.test(text)) {
          return true;
        }
      }

      return false;
    },

    /**
     * handle 由子类实现 — 基类抛错提醒覆盖
     */
    async handle(req) {
      throw new Error(`Agent "${key}" must implement handle()`);
    },

    /**
     * getInteractions 由子类实现 — 基类返回空
     */
    getInteractions() {
      return { actions: [], followups: [], compact_followups: [] };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agent-registry.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/base-agent.js
git commit -m "feat(agents): add base agent with matchScore and canHandle"
```

---

### Task 3: 七个子智能体定义

**Files:**
- Create: `src/core/agents/agents/meal-plan-agent.js`
- Create: `src/core/agents/agents/travel-route-agent.js`
- Create: `src/core/agents/agents/nearby-resource-agent.js`
- Create: `src/core/agents/agents/find-service-agent.js`
- Create: `src/core/agents/agents/health-risk-agent.js`
- Create: `src/core/agents/agents/dispatch-manage-agent.js`
- Create: `src/core/agents/agents/common-agent.js`

- [ ] **Step 1: Create meal-plan-agent.js**

从 `scene-router/rules/meal-plan.js` 提取词表，注入 evidenceGroups。

```javascript
// src/core/agents/agents/meal-plan-agent.js
import { createBaseAgent } from '../base-agent.js';

const mealTopicTerms = [
  '膳食', '饮食', '饭菜', '吃什么', '吃啥', '餐食', '食谱', '菜谱',
  '营养餐', '配餐', '助餐', '老人餐', '餐单', '菜单',
  'meal', 'diet', 'nutrition', 'recipe',
];

const mealTimeTerms = [
  '早餐', '早饭', '午餐', '午饭', '晚餐', '晚饭', '一周', '七天', '周计划',
  '明天', '今天', '本周', '下周',
];

const healthConditionTerms = [
  '糖尿病', '血糖', '低糖', '控糖', '高血压', '血压', '低盐', '痛风', '尿酸',
  '肾病', '高血脂', '咀嚼', '吞咽',
];

const mealIntentTerms = [
  '推荐', '安排', '计划', '生成', '制定', '搭配', '调整', '换成', '改成',
  '适合', '怎么吃', '能吃', '不能吃', '低糖版', '清淡点',
];

// 边界词：出现这些词时应该切换到其他Agent
const boundaryTerms = [
  '旅居', '旅游', '出行', '景点', '路线', '导航',
  '护工', '机构', '养老院', '上门服务',
  '周边', '附近', '地图',
  '派单', '工单', '调度',
];

const boundaryMap = {
  '旅居': 'travel_route', '旅游': 'travel_route', '出行': 'travel_route', '景点': 'travel_route',
  '路线': 'travel_route', '导航': 'travel_route',
  '护工': 'find_service', '机构': 'find_service', '养老院': 'find_service', '上门服务': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource', '地图': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage', '调度': 'dispatch_manage',
};

export function createMealPlanAgent() {
  return createBaseAgent({
    key: 'meal_plan',
    name: '膳食助手',
    actionPrefix: 'meal_plan',
    evidenceGroups: [
      { group: 'meal_topic', weight: 3, terms: mealTopicTerms },
      { group: 'meal_time', weight: 2.5, terms: mealTimeTerms },
      { group: 'health_condition', weight: 2, terms: healthConditionTerms },
      { group: 'meal_intent', weight: 3, terms: mealIntentTerms },
    ],
    boundaryTerms,
    boundaryMap,
    threshold: 5,
  });
}
```

- [ ] **Step 2: Create travel-route-agent.js**

```javascript
// src/core/agents/agents/travel-route-agent.js
import { createBaseAgent } from '../base-agent.js';

const travelTopicTerms = [
  '旅居', '旅游', '出行', '旅行', '出游', '游玩', '度假', '康养游',
  '行程', '攻略', 'destination', 'travel',
];

const routePlanTerms = [
  '路线', '导航', '怎么走', '公交', '地铁', '打车', '高铁', '飞机',
  '地图', '到', '去', '出发', '到达',
];

const travelIntentTerms = [
  '推荐', '规划', '安排', '设计', '定制', '景点', '景区', '门票',
  '酒店', '民宿', '住宿', '预订', 'booking',
];

const boundaryTerms = [
  '膳食', '饮食', '吃什么', '食谱',
  '护工', '机构', '养老院',
  '周边', '附近',
  '派单', '工单',
  '胸痛', '昏迷', '呼吸困难', '急救', '120',
];

const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '吃什么': 'meal_plan', '食谱': 'meal_plan',
  '护工': 'find_service', '机构': 'find_service', '养老院': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '呼吸困难': 'health_risk_warning',
  '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createTravelRouteAgent() {
  return createBaseAgent({
    key: 'travel_route',
    name: '旅居助手',
    actionPrefix: 'travel_route',
    evidenceGroups: [
      { group: 'travel_topic', weight: 3, terms: travelTopicTerms },
      { group: 'route_plan', weight: 4, terms: routePlanTerms },
      { group: 'travel_intent', weight: 3, terms: travelIntentTerms },
    ],
    boundaryTerms,
    boundaryMap,
    threshold: 6,
  });
}
```

- [ ] **Step 3: Create nearby-resource-agent.js**

```javascript
// src/core/agents/agents/nearby-resource-agent.js
import { createBaseAgent } from '../base-agent.js';

const placeTerms = ['周边', '附近', '周围', '旁边', '就近'];
const mapTerms = ['地图', '位置', '在哪', '怎么去', '地址', '导航'];
const resourceCategoryTerms = [
  '餐厅', '吃饭', '超市', '购物', '买', '药店', '医院', '诊所',
  '公园', '景点', '游玩', '休闲', '娱乐', '银行', 'ATM',
  '公交', '地铁', '车站', '机场', '高铁',
];
const nearbyIntentTerms = ['找', '推荐', '哪里有', '有没有', '多远', '怎么去'];

const boundaryTerms = [
  '膳食', '饮食', '食谱', '吃什么',
  '旅居', '旅游', '行程',
  '护工', '养老院',
  '派单', '工单',
];

const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan', '吃什么': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route', '行程': 'travel_route',
  '护工': 'find_service', '养老院': 'find_service',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
};

export function createNearbyResourceAgent() {
  return createBaseAgent({
    key: 'nearby_resource',
    name: '周边助手',
    actionPrefix: 'nearby_resource',
    evidenceGroups: [
      { group: 'place', weight: 3, terms: placeTerms },
      { group: 'map', weight: 2, terms: mapTerms },
      { group: 'category', weight: 2.5, terms: resourceCategoryTerms },
      { group: 'intent', weight: 2, terms: nearbyIntentTerms },
    ],
    boundaryTerms,
    boundaryMap,
    threshold: 4,
  });
}
```

- [ ] **Step 4: Create find-service-agent.js**

```javascript
// src/core/agents/agents/find-service-agent.js
import { createBaseAgent } from '../base-agent.js';

const serviceTopicTerms = [
  '服务', '办理', '申请', '补贴', '政策', '资格', '条件',
  '养老', '居家养老', '社区养老', '机构养老',
];
const serviceTypeTerms = [
  '护工', '护理员', '保姆', '家政', '上门', '陪护',
  '机构', '养老院', '敬老院', '福利院', '康养中心',
  '日间照料', '助浴', '助行', '助医',
];
const serviceIntentTerms = ['找', '推荐', '查询', '咨询', '预约', '报名', '办理', '申请'];

const boundaryTerms = [
  '膳食', '饮食', '食谱', '吃什么',
  '旅居', '旅游', '行程',
  '周边', '附近', '地图',
  '派单', '工单', '调度',
];

const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan', '吃什么': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route', '行程': 'travel_route',
  '周边': 'nearby_resource', '附近': 'nearby_resource', '地图': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage', '调度': 'dispatch_manage',
};

export function createFindServiceAgent() {
  return createBaseAgent({
    key: 'find_service',
    name: '服务助手',
    actionPrefix: 'find_service',
    evidenceGroups: [
      { group: 'topic', weight: 3, terms: serviceTopicTerms },
      { group: 'type', weight: 2.5, terms: serviceTypeTerms },
      { group: 'intent', weight: 3, terms: serviceIntentTerms },
    ],
    boundaryTerms,
    boundaryMap,
    threshold: 6,
  });
}
```

- [ ] **Step 5: Create health-risk-agent.js**

```javascript
// src/core/agents/agents/health-risk-agent.js
import { createBaseAgent } from '../base-agent.js';

const healthRiskAlertTerms = ['胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120', '晕倒', '摔跤', '跌倒'];
const healthRiskVitalTerms = ['血压', '血糖', '心率', '体温', '血氧', '脉搏'];
const healthRiskIntentTerms = ['预警', '警报', '异常', '超标', '危险', '紧急', '不舒服', '头晕', '恶心'];

const boundaryTerms = [
  '膳食', '饮食', '食谱',
  '旅居', '旅游',
  '护工', '机构',
  '周边', '附近',
  '派单', '工单',
];

const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route',
  '护工': 'find_service', '机构': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '派单': 'dispatch_manage', '工单': 'dispatch_manage',
};

export function createHealthRiskAgent() {
  return createBaseAgent({
    key: 'health_risk_warning',
    name: '健康预警助手',
    actionPrefix: 'health_risk_warning',
    evidenceGroups: [
      { group: 'alert', weight: 4, terms: healthRiskAlertTerms },
      { group: 'vital', weight: 1.5, terms: healthRiskVitalTerms },
      { group: 'intent', weight: 3, terms: healthRiskIntentTerms },
    ],
    boundaryTerms,
    boundaryMap,
    threshold: 4,
  });
}
```

- [ ] **Step 6: Create dispatch-manage-agent.js**

```javascript
// src/core/agents/agents/dispatch-manage-agent.js
import { createBaseAgent } from '../base-agent.js';

const dispatchTopicTerms = ['派单', '工单', '调度', '派工', '改派', '接单', '完工', '签到'];
const dispatchIntentTerms = ['查看', '查询', '进度', '状态', '催单', '取消', '确认', '评价'];
const dispatchStatusTerms = ['待接单', '进行中', '已完成', '已取消', '待派发'];

const boundaryTerms = [
  '膳食', '饮食', '食谱',
  '旅居', '旅游',
  '护工', '机构',
  '周边', '附近',
  '胸痛', '昏迷', '急救', '120',
];

const boundaryMap = {
  '膳食': 'meal_plan', '饮食': 'meal_plan', '食谱': 'meal_plan',
  '旅居': 'travel_route', '旅游': 'travel_route',
  '护工': 'find_service', '机构': 'find_service',
  '周边': 'nearby_resource', '附近': 'nearby_resource',
  '胸痛': 'health_risk_warning', '昏迷': 'health_risk_warning', '急救': 'health_risk_warning', '120': 'health_risk_warning',
};

export function createDispatchManageAgent() {
  return createBaseAgent({
    key: 'dispatch_manage',
    name: '调度助手',
    actionPrefix: 'dispatch_manage',
    evidenceGroups: [
      { group: 'topic', weight: 3, terms: dispatchTopicTerms },
      { group: 'intent', weight: 3, terms: dispatchIntentTerms },
      { group: 'status', weight: 2.5, terms: dispatchStatusTerms },
    ],
    boundaryTerms,
    boundaryMap,
    threshold: 5,
  });
}
```

- [ ] **Step 7: Create common-agent.js**

```javascript
// src/core/agents/agents/common-agent.js
import { createBaseAgent } from '../base-agent.js';

export function createCommonAgent() {
  return createBaseAgent({
    key: 'common',
    name: '桂小养',
    actionPrefix: '', // 通用Agent无 action_key 前缀
    keywords: ['你好', '谢谢', '再见', '帮助', '政策', '补贴', '您好', '请问'],
    boundaryTerms: [],
    boundaryMap: {},
    threshold: 1,
  });
}
```

- [ ] **Step 8: Commit**

```bash
git add src/core/agents/agents/
git commit -m "feat(agents): create 7 sub-agents with keyword tables from scene-router rules"
```

---

### Task 4: Supervisor 总智能体

**Files:**
- Create: `src/core/agents/supervisor.js`
- Test: `tests/supervisor-routing.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/supervisor-routing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupervisor } from '../src/core/agents/supervisor.js';

// 创建含 7 个 Agent 的完整 supervisor
function makeSupervisor() {
  return createSupervisor();
}

test('supervisor routes by action_key prefix (deterministic)', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({
    message: '',
    context: { action_key: 'meal_plan.adjust_for_condition' },
  });
  assert.equal(result.agentKey, 'meal_plan');
  assert.equal(result.switched, false); // 无 active_agent 时不算切换
});

test('supervisor routes travel_route action_key', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({
    message: '',
    context: { action_key: 'travel_route.check_weather_risk' },
  });
  assert.equal(result.agentKey, 'travel_route');
});

test('supervisor routes nearby_resource action_key', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({
    message: '',
    context: { action_key: 'nearby_resource.leisure' },
  });
  assert.equal(result.agentKey, 'nearby_resource');
});

test('supervisor stays in active_agent when canHandle returns true', async () => {
  const supervisor = makeSupervisor();
  // 先设定 active_agent = meal_plan
  const result = await supervisor.route({
    message: '换成软烂版',
    context: { active_agent: 'meal_plan', last_template: 'diet_card' },
  });
  assert.equal(result.agentKey, 'meal_plan');
  assert.equal(result.switched, false);
});

test('supervisor switches when active_agent canHandle returns suggest', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({
    message: '我想了解旅居路线',
    context: { active_agent: 'meal_plan', last_template: 'diet_card' },
  });
  assert.equal(result.agentKey, 'travel_route');
  assert.equal(result.switched, true);
  assert.equal(result.from, 'meal_plan');
});

test('supervisor routes by keyword when no active_agent', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({
    message: '今天膳食吃什么',
    context: {},
  });
  assert.equal(result.agentKey, 'meal_plan');
});

test('supervisor falls back to common for unknown', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({
    message: '你好',
    context: {},
  });
  assert.equal(result.agentKey, 'common');
});

test('supervisor SOS bypass routes to health_risk', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({
    message: '老人胸痛昏迷了',
    context: {},
  });
  assert.equal(result.agentKey, 'health_risk_warning');
  assert.equal(result.emergency, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/supervisor-routing.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/core/agents/supervisor.js
import { createAgentRegistry } from './agent-registry.js';
import { createMealPlanAgent } from './agents/meal-plan-agent.js';
import { createTravelRouteAgent } from './agents/travel-route-agent.js';
import { createNearbyResourceAgent } from './agents/nearby-resource-agent.js';
import { createFindServiceAgent } from './agents/find-service-agent.js';
import { createHealthRiskAgent } from './agents/health-risk-agent.js';
import { createDispatchManageAgent } from './agents/dispatch-manage-agent.js';
import { createCommonAgent } from './agents/common-agent.js';

// SOS 紧急关键词
const SOS_TERMS = ['胸痛', '昏迷', '呼吸困难', '中风', '抽搐', '大出血', '急救', '120', '晕倒', '坠床', '噎住', '窒息'];

/**
 * Supervisor 总智能体 — 一跳定向路由
 *
 * 路由优先级:
 * 1. SOS 紧急短路
 * 2. action_key 前缀匹配（确定性）
 * 3. active_agent 领域保持
 * 4. 关键词领域匹配
 * 5. 兜底 common
 */
export function createSupervisor() {
  const registry = createAgentRegistry();

  // 注册 7 个子智能体
  registry.register(createMealPlanAgent());
  registry.register(createTravelRouteAgent());
  registry.register(createNearbyResourceAgent());
  registry.register(createFindServiceAgent());
  registry.register(createHealthRiskAgent());
  registry.register(createDispatchManageAgent());
  registry.register(createCommonAgent());

  /**
   * 检测 SOS 紧急
   */
  function detectSOS(text) {
    const lower = text.toLowerCase();
    return SOS_TERMS.some((term) => lower.includes(term));
  }

  return {
    registry,

    /**
     * 路由决策
     * @param {Object} input
     * @param {string} input.message - 用户消息
     * @param {Object} input.context - 请求上下文
     * @returns {Promise<{ agentKey, switched, from, emergency, reason }>}
     */
    async route({ message = '', context = {} }) {
      const text = String(message || '').toLowerCase();

      // Step 1: SOS 紧急短路
      if (detectSOS(text)) {
        return {
          agentKey: 'health_risk_warning',
          switched: context.active_agent !== 'health_risk_warning',
          from: context.active_agent || null,
          emergency: true,
          reason: 'SOS_emergency',
        };
      }

      // Step 2: action_key 前缀匹配（确定性路由）
      const actionKey = context.action_key;
      if (actionKey) {
        const agent = registry.findByActionPrefix(actionKey);
        if (agent) {
          return {
            agentKey: agent.key,
            switched: false, // action_key 路由不算"切换"
            from: null,
            emergency: false,
            reason: 'action_prefix',
          };
        }
      }

      const activeAgentKey = context.active_agent;

      // Step 3: active_agent 领域保持
      if (activeAgentKey) {
        const activeAgent = registry.get(activeAgentKey);
        if (activeAgent) {
          const canHandle = activeAgent.canHandle(message, context);
          if (canHandle === true) {
            return {
              agentKey: activeAgentKey,
              switched: false,
              from: null,
              emergency: false,
              reason: 'active_agent_keep',
            };
          }
          // canHandle 返回了 suggest → 跳到步骤4使用该建议
          if (canHandle && canHandle.suggest) {
            // 确认 suggested agent 存在
            const suggested = registry.get(canHandle.suggest);
            if (suggested) {
              return {
                agentKey: canHandle.suggest,
                switched: true,
                from: activeAgentKey,
                emergency: false,
                reason: `boundary:${canHandle.reason}`,
              };
            }
          }
        }
      }

      // Step 4: 关键词领域匹配
      const allAgents = registry.list();
      let bestKey = 'common';
      let bestScore = 0;

      for (const agent of allAgents) {
        if (agent.key === 'common') continue; // 通用Agent不参与评分
        const score = agent.matchScore(message);
        if (score > bestScore) {
          bestScore = score;
          bestKey = agent.key;
        }
      }

      // 有意义的匹配（score > 0.3）
      if (bestScore >= 0.3) {
        const switched = activeAgentKey !== null && activeAgentKey !== bestKey;
        return {
          agentKey: bestKey,
          switched,
          from: switched ? activeAgentKey : null,
          emergency: false,
          reason: 'keyword_match',
        };
      }

      // Step 5: 兜底 common
      return {
        agentKey: 'common',
        switched: activeAgentKey !== null && activeAgentKey !== 'common',
        from: activeAgentKey && activeAgentKey !== 'common' ? activeAgentKey : null,
        emergency: false,
        reason: 'fallback',
      };
    },

    /**
     * 获取指定 Agent
     */
    getAgent(key) {
      return registry.get(key);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/supervisor-routing.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/supervisor.js tests/supervisor-routing.test.js
git commit -m "feat(agents): add supervisor with 5-step routing (SOS/action/active/keyword/fallback)"
```

---

### Task 5: 将 Supervisor 接入 runLocalSkill

**Files:**
- Modify: `src/runtime/local-skill-runtime.js`
- Modify: `src/app.js` (handleChat 注入 active_agent)

- [ ] **Step 1: Modify local-skill-runtime.js**

将 supervisor 路由结果注入 request，然后继续由现有 orchestrator 处理（过渡阶段，supervisor 决定 skill_key，orchestrator 负责执行）。

```javascript
// src/runtime/local-skill-runtime.js
import { createChatOrchestrator } from '../core/orchestrator/chat-orchestrator.js';
import { createSupervisor } from '../core/agents/supervisor.js';

// 单例 supervisor
const supervisor = createSupervisor();

export async function runLocalSkill(request = {}, options = {}) {
  const message = request.message || request.text || '';
  const context = request.context || {};

  // ★ Supervisor 路由决策（仅当不是 followup bypass 时）
  // followup_source 存在时，skill_key 已确定，跳过 supervisor
  if (!context.followup_source && !context.action_key) {
    const route = await supervisor.route({ message, context });

    // 注入 supervisor 决策结果
    request.skill_key = route.agentKey;
    request.context = {
      ...context,
      agent_key: route.agentKey,
      agent_switched: route.switched,
      agent_from: route.from,
      agent_emergency: route.emergency,
      agent_reason: route.reason,
    };
  } else if (context.action_key) {
    // action_key 路由
    const route = await supervisor.route({ message, context });
    if (route.agentKey && !request.skill_key) {
      request.skill_key = route.agentKey;
    }
    request.context = {
      ...context,
      agent_key: route.agentKey,
      agent_reason: route.reason,
    };
  }

  return createChatOrchestrator(options).run(request);
}
```

- [ ] **Step 2: Modify app.js handleChat**

在 handleChat 中，从 sessionStore 获取 active_agent 注入 context：

找到 `src/app.js` 中 handleChat 的 `context: {` 块（约 L444），在 `...(body.context || {})` 之前添加 `active_agent`：

```javascript
// src/app.js handleChat 中（约 L444），替换 context 块为：
      context: {
        active_agent: previous?.envelope?.agent_key || previous?.envelope?.skill_key || '',
        last_template: previous?.envelope?.template_id || '',
        ...(body.context || {}),
        action_key: body.action_key || body.actionKey || '',
        action_params: body.params || {},
        reenter_chat: reenterChat,
        location: body.location || null,
        unsupported_action_key: body.unsupported_action_key || body.unsupportedActionKey || '',
        ...(followup ? {
          previous_scene: previous?.envelope?.skill_key,
          previous_turn_id: previous?.turn_id,
          followup_source: body.followup_source || body.source || '',
        } : {}),
        ...(previous?.envelope?.context_snapshot ? {
          previous_scene: previous.envelope.context_snapshot.scene,
          previous_template: previous.envelope.context_snapshot.template_id,
          previous_intent: previous.envelope.context_snapshot.intent,
        } : {}),
      },
```

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `node --test tests/chat-orchestrator.test.js tests/local-skill-runtime-meal-plan.test.js tests/local-skill-runtime-travel-route.test.js tests/app.test.js`
Expected: PASS (all existing tests still pass)

- [ ] **Step 4: Run all tests**

Run: `node --test tests/*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime/local-skill-runtime.js src/app.js
git commit -m "feat(agents): integrate supervisor routing into runLocalSkill and handleChat"
```

---

## Phase 2: Agent 上下文隔离

### Task 6: SessionStore 改造 — per-agent turns

**Files:**
- Modify: `src/core/conversation/session-store.js`
- Test: `tests/agent-context-isolation.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/agent-context-isolation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/core/conversation/session-store.js';

// 内存 stateStore mock
function makeMemoryStateStore() {
  const store = new Map();
  return {
    async getJson(key) { return store.get(key) || null; },
    async setJson(key, val, _opts) { store.set(key, val); return val; },
    async listJson(key) { return store.get(key) || []; },
    async pushJson(key, val) { const arr = store.get(key) || []; arr.push(val); store.set(key, arr); return arr; },
  };
}

test('SessionStore initializes with agents structure', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  const session = await ss.getOrCreate('conv-1');
  assert.ok(session.agents);
  assert.equal(typeof session.agents, 'object');
});

test('SessionStore appendTurn writes to correct agent bucket', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  await ss.appendTurn('conv-1', {
    turn_id: 't1',
    user_message: '今天吃什么',
    envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' },
  });

  const session = await ss.getOrCreate('conv-1');
  assert.ok(session.agents.meal_plan);
  assert.equal(session.agents.meal_plan.turns.length, 1);
  assert.equal(session.agents.meal_plan.last_template, 'diet_card');
});

test('SessionStore isolates turns between agents', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  // 膳食对话
  await ss.appendTurn('conv-1', {
    turn_id: 't1',
    user_message: '膳食推荐',
    envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' },
  });
  // 切换到旅居
  await ss.appendTurn('conv-1', {
    turn_id: 't2',
    user_message: '旅居路线',
    envelope: { skill_key: 'travel_route', template_id: 'travel_itinerary_card', agent_key: 'travel_route' },
  });
  // 切回膳食
  await ss.appendTurn('conv-1', {
    turn_id: 't3',
    user_message: '换成软烂版',
    envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' },
  });

  const session = await ss.getOrCreate('conv-1');
  // 膳食 Agent 有 2 轮（t1 和 t3），旅居 Agent 有 1 轮（t2）
  assert.equal(session.agents.meal_plan.turns.length, 2);
  assert.equal(session.agents.travel_route.turns.length, 1);
  assert.equal(session.active_agent, 'meal_plan');
});

test('SessionStore getAgentContext returns frozen/unfrozen state', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  await ss.appendTurn('conv-1', {
    turn_id: 't1',
    user_message: '膳食',
    envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' },
  });

  const ctx = await ss.getAgentContext('conv-1', 'meal_plan');
  assert.ok(ctx);
  assert.equal(ctx.turns.length, 1);
  assert.equal(ctx.last_template, 'diet_card');
  assert.equal(ctx.frozen, false);
});

test('SessionStore getPreviousTurn respects active_agent', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  await ss.appendTurn('conv-1', {
    turn_id: 't1',
    user_message: '膳食',
    envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' },
  });
  await ss.appendTurn('conv-1', {
    turn_id: 't2',
    user_message: '旅居',
    envelope: { skill_key: 'travel_route', template_id: 'travel_itinerary_card', agent_key: 'travel_route' },
  });

  // active_agent = travel_route → 上一轮应该是 t2
  const prev = await ss.getPreviousTurn('conv-1');
  assert.equal(prev.turn_id, 't2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agent-context-isolation.test.js`
Expected: FAIL (session.agents is undefined)

- [ ] **Step 3: Implement the changes**

修改 `src/core/conversation/session-store.js`，修改 `getOrCreate` 和 `appendTurn`，新增 `getAgentContext`：

找到 `getOrCreate` 方法（L9-19），替换为：

```javascript
  async getOrCreate(conversationId) {
    const id = conversationId || makeId('conv');
    const existing = await this.stateStore.getJson(conversationKey(id));
    if (existing) {
      // 向后兼容：确保 agents 结构存在
      if (!existing.agents) {
        existing.agents = {};
        // 将旧 turns 迁移到 common agent
        if (existing.turns && existing.turns.length > 0) {
          existing.agents.common = {
            turns: existing.turns,
            last_template: existing.turns.at(-1)?.envelope?.template_id || '',
            scoped_data: {},
            frozen: false,
          };
        }
      }
      if (!existing.global_context) {
        existing.global_context = {};
      }
      return existing;
    }

    return {
      conversation_id: id,
      turns: [], // 保留扁平 turns 用于全局列表/搜索
      agents: {},
      active_agent: '',
      global_context: {},
      updated_at: new Date().toISOString(),
    };
  }
```

找到 `appendTurn` 方法（L21-49），替换为：

```javascript
  async appendTurn(conversationId, turn) {
    const session = await this.getOrCreate(conversationId);
    const nextTurn = {
      ...turn,
      turn_id: turn.turn_id || makeId(`turn_${session.turns.length + 1}`),
      created_at: turn.created_at || new Date().toISOString(),
    };
    // 扁平 turns（全局列表/搜索用）
    session.turns.push(nextTurn);
    session.updated_at = new Date().toISOString();

    // ★ per-agent turns 隔离
    const agentKey = nextTurn.envelope?.agent_key || nextTurn.envelope?.skill_key || 'common';
    if (!session.agents[agentKey]) {
      session.agents[agentKey] = { turns: [], last_template: '', scoped_data: {}, frozen: false };
    }
    session.agents[agentKey].turns.push(nextTurn);
    session.agents[agentKey].last_template = nextTurn.envelope?.template_id || session.agents[agentKey].last_template;
    session.agents[agentKey].frozen = false;

    // 更新 active_agent
    session.active_agent = agentKey;

    // 冻结其他 Agent
    for (const key of Object.keys(session.agents)) {
      if (key !== agentKey) {
        session.agents[key].frozen = true;
      }
    }

    await this.save(session);

    // 持久化到数据库
    if (this.repository) {
      try {
        await this.repository.create('conversation_turns', {
          turn_id: nextTurn.turn_id,
          conversation_id: session.conversation_id,
          agent_key: agentKey,
          skill_key: nextTurn.envelope?.skill_key || agentKey,
          template_id: nextTurn.envelope?.template_id || '',
          created_at: nextTurn.created_at,
        });
      } catch (err) {
        console.warn('[SessionStore] conversation_turns persist failed:', err.message);
      }
    }

    return nextTurn;
  }
```

在 `getPreviousTurn` 之后添加新方法：

```javascript
  /**
   * 获取指定 Agent 的上下文
   */
  async getAgentContext(conversationId, agentKey) {
    const session = await this.getOrCreate(conversationId);
    return session.agents?.[agentKey] || null;
  }

  /**
   * 获取全局上下文（跨 Agent 共享）
   */
  async getGlobalContext(conversationId) {
    const session = await this.getOrCreate(conversationId);
    return session.global_context || {};
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agent-context-isolation.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run session-store regression test**

Run: `node --test tests/session-store.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/conversation/session-store.js tests/agent-context-isolation.test.js
git commit -m "feat(agents): per-agent turns isolation in SessionStore with freeze/restore"
```

---

### Task 7: envelope 增加 agent_key 字段

**Files:**
- Modify: `src/core/orchestrator/chat-orchestrator.js` (buildEnvelope 注入 agent_key)

- [ ] **Step 1: Verify buildEnvelope location**

查看 `src/core/orchestrator/chat-orchestrator.js` 中 `buildEnvelope` 函数。

- [ ] **Step 2: Add agent_key to envelope**

找到 `buildEnvelope` 的返回对象（约 L368-398），确保 `agent_key` 字段被注入。

在 buildEnvelope 返回的信封中加入 agent_key（从 request.context 或 skill_key 推导）：

找到 `skill_key: params.skill_key` 所在行，在其后添加：

```javascript
      agent_key: params.agent_key || params.skill_key || '',
      agent_switched: params.route_extras?.agent_switched || false,
```

- [ ] **Step 3: Also inject agent_key from supervisor route in local-skill-runtime.js**

在 `src/runtime/local-skill-runtime.js` 中，确保 `request.context.agent_key` 传递到 orchestrator 的 buildEnvelope。

orchestrator 的 buildEnvelope 从 request.context 读取 agent_key。在 chat-orchestrator.js 的 run() 方法中，找到 buildEnvelope 调用（约 L370），检查 params 中是否包含 context:

在 buildEnvelope 调用前添加：

```javascript
// 确保 agent_key 传入 envelope
const agentKey = request.context?.agent_key || skillKey || '';
const agentSwitched = request.context?.agent_switched || false;
```

然后在 buildEnvelope 调用中添加 `agent_key: agentKey, agent_switched: agentSwitched`。

- [ ] **Step 4: Run existing tests**

Run: `node --test tests/chat-orchestrator.test.js tests/envelope.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/chat-orchestrator.js
git commit -m "feat(agents): inject agent_key into envelope for context tracking"
```

---

## Phase 3: Agent 自检与越界切换

### Task 8: 前端切换提示气泡

**Files:**
- Modify: `src/public/mobile.js` — 检测 envelope.agent_switched 渲染提示
- Modify: `src/public/mobile.css` — 切换提示样式

- [ ] **Step 1: Add switch notice rendering in mobile.js**

找到消息渲染处（addBubble 或 renderEnvelope 方法），在 envelope.agent_switched === true 时插入提示气泡：

在 `src/public/mobile.js` 中找到处理 envelope 响应的位置（搜索 `envelope` 或 `skill_key`），在渲染 AI 消息之前添加：

```javascript
// 检测 Agent 切换，显示提示
if (envelope.agent_switched && envelope.agent_from) {
  const agentNames = {
    meal_plan: '膳食助手', travel_route: '旅居助手', nearby_resource: '周边助手',
    find_service: '服务助手', health_risk_warning: '健康预警', dispatch_manage: '调度助手', common: '桂小养',
  };
  const fromName = agentNames[envelope.agent_from] || envelope.agent_from;
  const toName = agentNames[envelope.agent_key] || envelope.agent_key;
  this.addSystemNotice(`已从「${fromName}」切换到「${toName}」，之前的话题随时可以回来`);
}
```

- [ ] **Step 2: Add systemNotice method and CSS**

在 mobile.js 的 class 中添加 addSystemNotice 方法（在 addBubble 附近）：

```javascript
addSystemNotice(text) {
  const notice = document.createElement('div');
  notice.className = 'mobile-system-notice';
  notice.textContent = text;
  const wrap = document.getElementById('messageList') || this.msgListEl;
  if (wrap) wrap.appendChild(notice);
  wrap?.scrollTo?.({ top: wrap.scrollHeight, behavior: 'smooth' });
}
```

在 `src/public/mobile.css` 中添加：

```css
.mobile-system-notice {
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary, #999);
  padding: 6px 16px;
  margin: 4px auto;
  background: rgba(0,0,0,0.04);
  border-radius: 12px;
  max-width: 85%;
  line-height: 1.4;
}
```

- [ ] **Step 3: Run mobile followup tests**

Run: `node --test tests/mobile-followup.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/public/mobile.js src/public/mobile.css
git commit -m "feat(agents): show switch notice when agent changes"
```

---

### Task 9: 前端消息增加 agent_key 标记

**Files:**
- Modify: `src/public/mobile.js` — 消息存储增加 agent_key

- [ ] **Step 1: Add agent_key to message objects**

在 mobile.js 中找到消息对象创建处（addMessage 或 addBubble），确保从 envelope 中提取 agent_key 存入消息：

找到消息 push 到 conversations 数组的位置，添加 agent_key 字段：

```javascript
// 在消息对象中添加 agent_key
agent_key: envelope?.agent_key || envelope?.skill_key || '',
```

- [ ] **Step 2: Run tests and commit**

Run: `node --test tests/mobile-followup.test.js`
Expected: PASS

```bash
git add src/public/mobile.js
git commit -m "feat(agents): tag messages with agent_key for history grouping"
```

---

### Task 10: 端到端验证

- [ ] **Step 1: Run all tests**

Run: `node --test tests/*.test.js`
Expected: ALL PASS

- [ ] **Step 2: Start server and manual test**

Run: `node src/server.js`

测试场景：
1. 发"今天膳食吃什么" → 路由到 meal_plan ✓
2. 发"换成软烂版" → 留在 meal_plan（不切换）✓
3. 发"大理旅居路线" → 切换到 travel_route，显示切换提示 ✓
4. 发"周边有什么景点" → 切换到 nearby_resource ✓
5. 点击"找护工"按钮 → action_key 路由到 find_service ✓
6. 发"今天膳食怎么调整" → 切回 meal_plan，恢复上下文 ✓

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(agents): multi-agent architecture complete - 3 phases done"
```

---

## Self-Review Checklist

| Spec 要求 | 对应 Task | 状态 |
|-----------|----------|------|
| Supervisor 5步路由 | Task 4 | ✓ |
| 7个子智能体 | Task 3 | ✓ |
| action_key 确定性路由 | Task 4 Step 3 | ✓ |
| active_agent 领域保持 | Task 4 Step 3 | ✓ |
| 关键词领域匹配 | Task 3 (词表) + Task 4 | ✓ |
| per-agent turns 隔离 | Task 6 | ✓ |
| freeze/restore | Task 6 | ✓ |
| envelope agent_key | Task 7 | ✓ |
| 切换提示 | Task 8 | ✓ |
| 消息 agent_key 标记 | Task 9 | ✓ |
| 端到端验证 | Task 10 | ✓ |
| 现有测试不回归 | Task 5/6/7 中验证 | ✓ |
