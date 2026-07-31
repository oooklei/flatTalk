# 旅居技能城市提取器设计（city-extractor）

**日期**: 2026-07-31
**状态**: 待审核
**背景**: 旅居规划（travel_route）场景中，天气获取依赖硬编码的 10 个城市正则（`inferDestination`），无法识别"防城港""涠洲岛""文昌"等大量城市和景点，导致天气风险查询失败。route_card 的"查天气风险"按钮也未携带城市参数，点击后城市提取二次失败。

## 问题诊断

### 根因链路

1. **`inferDestination()` 只覆盖 10 个城市**（model-service.js:1516-1530）：北海/桂林/南宁/巴马/昆明/大理/丽江/三亚/海口/厦门。用户提到其他城市或景点时返回 null。
2. **route_card 天气按钮未带 city 参数**（model-service.js:1674-1678）：`followup_suggestions` 中 `action_key: 'travel_route.check_weather_risk'` 缺少 `params.city`，导致 orchestrator 的 `resolveWeatherCity` 只能从 businessData 碰运气。
3. **两条天气路径独立提取城市、逻辑重复且不一致**：orchestrator 的 `resolveWeatherCity`（chat-orchestrator.js:29-37）和 model-service 的 `fillTravelWeatherRiskCard`（model-service.js:1765-1851）各自独立提取，规则不同。

### 影响范围

- 单城市场景：热门城市（10个）可正常工作；其他城市天气获取失败
- 多城市场景（如"北海→涠洲岛"）：完全不支持
- 景点类查询（如"涠洲岛天气"）：无法归一化到城市级别

## 设计方案

### 方案选择

**方案 A（已确认）：独立轻量 city-extractor 模块 + 预提取注入**

在 orchestrator 的 `run()` 中，travel_route 场景渲染 route_card 前调用城市提取器，用正则预筛 + 轻量 LLM 提取城市数组，结果注入 `business_data.cities` 和 `business_data.primary_city`。fillRouteCard 同步消费注入的数据，天气按钮携带 city 参数。

### 架构与模块划分

```
┌──────────────────────────────────────────────────────┐
│  chat-orchestrator.js                                │
│  ┌──────────────────────────────────────────────┐    │
│  │ travel_route 场景渲染前                      │    │
│  │  → cityExtractor.extractCities(ctx)          │    │
│  │  ← { primary, cities[], confidence, source } │    │
│  │  → 注入 business_data.cities / primary_city  │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │ "查天气风险" 按钮点击                        │    │
│  │  → resolveWeatherCity 读 params.city         │    │
│  │  → cities.length > 1 时并行查询              │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│  src/core/city-extractor/index.js  (新增)            │
│                                                      │
│  extractCities({ message, business_data, history })  │
│    1. 快速正则预筛（热门城市秒回，不调 LLM）          │
│    2. 未命中 → 调轻量 LLM（结构化 JSON 输出）         │
│    3. 归一化（景点→城市）                             │
│    4. 返回 { primary, cities[], raw_text, source }   │
└──────────────────────────────────────────────────────┘
```

### 接口定义

```javascript
// src/core/city-extractor/index.js

/**
 * 从旅居咨询上下文中提取城市
 * @param {object} ctx
 * @param {string} ctx.message - 用户消息
 * @param {object} ctx.business_data - 业务数据（含 jtd 产品/路线）
 * @param {Array} ctx.conversation_history - 对话历史
 * @returns {Promise<{primary: string|null, cities: string[], source: string, confidence: number}>}
 */
export async function extractCities(ctx) { ... }
```

**返回值说明**：
- `primary`: 主要目的地城市名（归一化后，如"涠洲岛"→"北海"）。未提取到时为 null。
- `cities`: 所有涉及城市数组（含 primary，去重）。未提取到时为空数组。
- `source`: 提取来源，`"regex"`（正则命中）或 `"llm"`（LLM 提取）或 `"none"`（均未命中）。
- `confidence`: 置信度 0.0-1.0。

### 数据流

```
用户: "想去防城港和涠洲岛旅居"
  │
  ▼
orchestrator.run()
  │
  ├─ 1. 路由识别 → scene_key='travel_route'
  ├─ 2. loadBusinessData() → jtd 产品/路线数据
  │
  ├─ 3.【新增】城市预提取（仅 travel_route 场景）
  │     extractCities({ message, business_data, history })
  │       ├─ 3a. 正则预筛：HOT_CITIES 表匹配
  │       │    "防城港"不在热门表 → 未完全命中
  │       ├─ 3b. LLM 提取：返回 { primary:"防城港", cities:["防城港","北海"] }
  │       │    （"涠洲岛"归一化为"北海"）
  │       └─ 返回 { primary:"防城港", cities:["防城港","北海"], source:"llm" }
  │
  ├─ 4. 注入 business_data.cities / primary_city
  │
  ├─ 5. fillRouteCard() → 天气按钮 params.city = "防城港"
  │
  ▼
用户点击"查天气风险"
  │
  ▼
resolveWeatherCity → 读 params.city="防城港"（直接命中）
  → cities.length > 1 → Promise.all 并行查询防城港+北海天气
  → fillTravelWeatherRisk({ cities, weathers }) 多城市对比卡片
```

### LLM Prompt 设计

```
你是一个城市提取助手。从用户的旅居咨询消息中提取涉及的城市。

## 输入
- 用户消息: "{message}"
- 业务数据中的目的地: "{jtd_destination}"
- 对话历史最后3轮: "{history}"

## 规则
1. 提取所有提到的城市（包括景点/景区对应的所属城市）
2. 景点归一化：涠洲岛→北海，亚龙湾→三亚，阳朔→桂林
3. primary 为主要目的地（消息中首先强调的或产品数据中的目的地）
4. 如果没有明确城市，返回空数组

## 输出（严格 JSON）
{"primary": "城市名", "cities": ["城市A","城市B"], "confidence": 0.0-1.0}
```

### 景点归一化层

LLM 返回的城市名需归一化后才能查天气 API：

```javascript
// src/core/city-extractor/normalize.js
const SCENIC_TO_CITY = {
  '涠洲岛': '北海', '银滩': '北海',
  '亚龙湾': '三亚', '天涯海角': '三亚',
  '阳朔': '桂林', '龙脊梯田': '桂林',
  '千里岩': '烟台',
};

function normalizeCity(rawName) {
  return SCENIC_TO_CITY[rawName] || rawName;
}
```

归一化后，通过 `tencent-weather.js` 已有的 `getAdcode()` 查到 adcode 进行天气查询。

### 降级策略

| 场景 | 降级方式 |
|------|----------|
| LLM 超时（>3秒） | 回退到正则匹配（现有 `inferDestination`） |
| LLM 返回非 JSON | 解析失败，回退正则 |
| LLM 未配置 | 直接走正则 |
| 正则也未命中 | primary 为 null，天气按钮变为引导用户指定城市 |
| 提取到城市但天气 API 无此城市 | `degraded: 'no_adcode'`，卡片显示通用提醒 |

### 性能考量

- 正则预筛覆盖热门城市（约 30 个），命中率估计 >60%，无需 LLM 调用
- LLM 调用设 3 秒超时，不阻塞 route_card 渲染——超时则 city 为 null，route_card 正常返回
- 多城市天气查询并行 `Promise.all`，总耗时 = max(各城市查询) 而非累加

## 改动清单

### 新增文件（2 个）

| 文件 | 职责 | 行数估算 |
|------|------|----------|
| `src/core/city-extractor/index.js` | 城市提取主模块：正则预筛 + LLM 调用 + 归一化 + 降级 | ~120 |
| `src/core/city-extractor/normalize.js` | 景点→城市归一化映射表 + `normalizeCity()` | ~50 |

### 修改文件（3 个）

| 文件 | 改动内容 |
|------|----------|
| `src/core/orchestrator/chat-orchestrator.js` | ① run() 中 travel_route 场景渲染前调 `extractCities()`，注入 business_data；② `resolveWeatherCity()` 增加多城市支持；③ 天气查询分支支持并行查询 |
| `src/core/model-service.js` | ① `fillRouteCard()` 天气按钮增加 `params: { city: primary_city }`；② `fillTravelWeatherRiskCard()` 接受多城市天气数据；③ 将 `inferDestination()` 的硬编码正则迁移到 city-extractor 的正则预筛模块，`fillRouteCard`/`fillTravelItineraryCard` 中的 `inferDestination(message)` 调用改为优先读 `business_data.primary_city`（extractCities 预提取结果），降级时调用 normalize 模块的热门城市匹配函数 |
| `src/app.js` | orchestrator 创建时传入 `cityExtractor` 依赖（可选，便于测试注入） |

### 不改动的文件

- `tencent-weather.js`：已有 `getAdcode()` 和 `getWeather()`，直接复用
- `mobile.js`：前端无需改动，params.city 由后端注入
- `action-resource-map.json`：action_key 不变
- `scene-router/rules/travel-route.js`：路由规则不变

## 测试策略

| 测试类型 | 覆盖内容 |
|----------|----------|
| 单元测试 | `extractCities()` 正则命中、LLM 命中、降级路径；`normalizeCity()` 景点归一化 |
| 集成测试 | orchestrator 预提取 → fillRouteCard 消费 → 天气按钮带 city 参数的完整链路 |
| 回归测试 | 现有 travel_route 测试全部保持通过（extractCities 降级时走原逻辑） |

### 关键测试用例

1. "想去防城港旅居" → primary="防城港"（LLM 提取，正则未覆盖）
2. "北海天气怎么样" → primary="北海"（正则命中，不调 LLM）
3. "想去涠洲岛和北海" → LLM 返回 ["涠洲岛","北海"] → 归一化后 ["北海","北海"] → 去重 → cities=["北海"]，primary="北海"
4. "想去防城港和涠洲岛" → LLM 返回 ["防城港","涠洲岛"] → 归一化后 ["防城港","北海"] → cities=["防城港","北海"]，primary="防城港"（多城市）
5. "帮我规划旅居" → primary=null（无城市，天气按钮引导用户指定）
6. LLM 超时 → 回退正则 → primary=null → route_card 正常渲染
