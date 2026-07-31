# 旅居技能城市提取器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 LLM + 正则预筛替代硬编码城市匹配，从旅居咨询上下文中提取城市和城市数组，支持多城市天气查询。

**Architecture:** 新增独立轻量 `city-extractor` 模块（正则预筛 + LLM 提取 + 景点归一化），由 orchestrator 在 travel_route 场景渲染前预提取城市并注入 business_data。fillRouteCard 消费注入的城市为天气按钮携带 params.city，点击时 orchestrator 直接读取无需二次提取，多城市时并行查询天气。

**Tech Stack:** Node.js ES Modules, node:test, 复用已有 `openai-compatible-client.js` 和 `model-registry.js`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/city-extractor/normalize.js` | 新增 | 景点→城市归一化映射表 + `normalizeCity()` + 热门城市正则匹配 |
| `src/core/city-extractor/index.js` | 新增 | 主提取模块：正则预筛 → LLM 提取 → 归一化 → 降级 |
| `src/core/orchestrator/chat-orchestrator.js` | 修改 | 预提取注入 + resolveWeatherCity 多城市 + 并行天气查询 |
| `src/core/model-service.js` | 修改 | fillRouteCard 天气按钮带 city + fillTravelWeatherRiskCard 多城市 |
| `tests/city-extractor.test.js` | 新增 | 单元测试 |

---

### Task 1: 创建景点归一化模块

**Files:**
- Create: `src/core/city-extractor/normalize.js`
- Test: `tests/city-extractor.test.js`

- [ ] **Step 1: 编写归一化测试**

```javascript
// tests/city-extractor.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCity, matchHotCity } from '../src/core/city-extractor/normalize.js';

test('normalizeCity 景点归一化为城市', () => {
  assert.equal(normalizeCity('涠洲岛'), '北海');
  assert.equal(normalizeCity('银滩'), '北海');
  assert.equal(normalizeCity('亚龙湾'), '三亚');
  assert.equal(normalizeCity('阳朔'), '桂林');
  assert.equal(normalizeCity('龙脊梯田'), '桂林');
});

test('normalizeCity 非景点原样返回', () => {
  assert.equal(normalizeCity('北海'), '北海');
  assert.equal(normalizeCity('防城港'), '防城港');
  assert.equal(normalizeCity('未知地名'), '未知地名');
});

test('matchHotCity 匹配热门城市', () => {
  assert.deepEqual(matchHotCity('想去北海旅居'), ['北海']);
  assert.deepEqual(matchHotCity('防城港和北海'), ['北海']);
});

test('matchHotCity 未命中热门城市返回空数组', () => {
  assert.deepEqual(matchHotCity('想去防城港'), []);
  assert.deepEqual(matchHotCity('帮我规划旅居'), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/city-extractor.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现归一化模块**

```javascript
// src/core/city-extractor/normalize.js

// 景点 → 所属城市归一化映射
const SCENIC_TO_CITY = {
  '涠洲岛': '北海', '银滩': '北海', '老街': '北海',
  '亚龙湾': '三亚', '天涯海角': '三亚', '蜈支洲岛': '三亚',
  '阳朔': '桂林', '龙脊梯田': '桂林', '漓江': '桂林',
  '千里岩': '烟台',
  '鼓浪屿': '厦门',
  '西湖': '杭州',
};

// 热门旅居城市正则表（用于快速预筛，避免调 LLM）
const HOT_CITIES = [
  '北海', '桂林', '南宁', '巴马', '昆明', '大理', '丽江',
  '三亚', '海口', '厦门', '西双版纳', '文昌', '琼海',
  '成都', '杭州', '苏州', '青岛',
];

/**
 * 将景点名归一化为所属城市名
 * @param {string} rawName - 原始名称（可能是景点名或城市名）
 * @returns {string} 归一化后的城市名
 */
export function normalizeCity(rawName) {
  if (!rawName) return rawName;
  return SCENIC_TO_CITY[rawName] || rawName;
}

/**
 * 从文本中匹配热门城市（正则快速预筛）
 * @param {string} text - 用户消息或相关文本
 * @returns {string[]} 匹配到的热门城市数组（归一化、去重后）
 */
export function matchHotCity(text) {
  if (!text) return [];
  const matches = new Set();
  for (const city of HOT_CITIES) {
    if (text.includes(city)) {
      matches.add(normalizeCity(city));
    }
  }
  // 同时检查景点名
  for (const [scenic, city] of Object.entries(SCENIC_TO_CITY)) {
    if (text.includes(scenic)) {
      matches.add(city);
    }
  }
  return Array.from(matches);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/city-extractor.test.js`
Expected: PASS — 4 tests pass

- [ ] **Step 5: 提交**

```bash
git add src/core/city-extractor/normalize.js tests/city-extractor.test.js
git commit -m "feat: 城市提取器归一化模块（景点→城市 + 热门城市正则）"
```

---

### Task 2: 创建城市提取主模块

**Files:**
- Create: `src/core/city-extractor/index.js`
- Test: `tests/city-extractor.test.js`（追加）

- [ ] **Step 1: 追加提取器测试**

在 `tests/city-extractor.test.js` 末尾追加：

```javascript
import { extractCities } from '../src/core/city-extractor/index.js';

test('extractCities 正则命中热门城市不调 LLM', async () => {
  const result = await extractCities({
    message: '想去北海旅居',
    business_data: {},
  });
  assert.equal(result.primary, '北海');
  assert.deepEqual(result.cities, ['北海']);
  assert.equal(result.source, 'regex');
});

test('extractCities 未命中热门城市时调 LLM', async () => {
  const mockLlm = async () => ({
    ok: true,
    content: '{"primary":"防城港","cities":["防城港"],"confidence":0.9}',
  });
  const result = await extractCities({
    message: '想去防城港旅居',
    business_data: {},
  }, { llmCall: mockLlm });
  assert.equal(result.primary, '防城港');
  assert.deepEqual(result.cities, ['防城港']);
  assert.equal(result.source, 'llm');
});

test('extractCities LLM 多城市 + 景点归一化', async () => {
  const mockLlm = async () => ({
    ok: true,
    content: '{"primary":"防城港","cities":["防城港","涠洲岛"],"confidence":0.85}',
  });
  const result = await extractCities({
    message: '想去防城港和涠洲岛',
    business_data: {},
  }, { llmCall: mockLlm });
  assert.equal(result.primary, '防城港');
  assert.deepEqual(result.cities, ['防城港', '北海']);
  assert.equal(result.source, 'llm');
});

test('extractCities LLM 失败降级到正则', async () => {
  const mockLlm = async () => ({ ok: false, error: 'timeout' });
  const result = await extractCities({
    message: '想去北海旅居',
    business_data: {},
  }, { llmCall: mockLlm });
  assert.equal(result.primary, '北海');
  assert.equal(result.source, 'regex');
});

test('extractCities 无城市时返回 null', async () => {
  const mockLlm = async () => ({
    ok: true,
    content: '{"primary":null,"cities":[],"confidence":0.1}',
  });
  const result = await extractCities({
    message: '帮我规划旅居',
    business_data: {},
  }, { llmCall: mockLlm });
  assert.equal(result.primary, null);
  assert.deepEqual(result.cities, []);
  assert.equal(result.source, 'llm');
});

test('extractCities LLM 未配置时走正则', async () => {
  const result = await extractCities({
    message: '桂林天气怎么样',
    business_data: {},
  });
  assert.equal(result.primary, '桂林');
  assert.equal(result.source, 'regex');
});

test('extractCities 从 business_data 的 jtd 产品中提取目的地', async () => {
  const result = await extractCities({
    message: '帮我看看这个产品',
    business_data: { jtd: { selected_product: { destination: '北海' } } },
  });
  assert.equal(result.primary, '北海');
  assert.equal(result.source, 'regex');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/city-extractor.test.js`
Expected: FAIL — `extractCities` 未定义

- [ ] **Step 3: 实现提取主模块**

```javascript
// src/core/city-extractor/index.js

import { normalizeCity, matchHotCity } from './normalize.js';
import { pickChatModel } from '../model-runtime/model-registry.js';
import { callOpenAiCompatibleModel } from '../model-runtime/openai-compatible-client.js';

const LLM_TIMEOUT_MS = 3000;

/**
 * 构建 LLM 提取 prompt
 */
function buildExtractionPrompt(message, jtdDestination, historyText) {
  return [
    {
      role: 'system',
      content: `你是一个城市提取助手。从用户的旅居咨询消息中提取涉及的城市。

## 规则
1. 提取所有提到的城市（包括景点/景区对应的所属城市）
2. 景点归一化：涠洲岛→北海，亚龙湾→三亚，阳朔→桂林
3. primary 为主要目的地（消息中首先强调的或产品数据中的目的地）
4. 如果没有明确城市，primary 为 null，cities 为空数组

## 输出（严格 JSON，不要 markdown 代码块）
{"primary": "城市名或null", "cities": ["城市A","城市B"], "confidence": 0.0-1.0}`,
    },
    {
      role: 'user',
      content: `用户消息: "${message || ''}"
业务数据中的目的地: "${jtdDestination || ''}"
对话历史: "${historyText || ''}"`,
    },
  ];
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseCityJson(content) {
  if (!content) return null;
  try {
    // 去除可能的 markdown 代码块标记
    const clean = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed.cities)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 从上下文中提取城市
 * @param {object} ctx - 提取上下文
 * @param {string} ctx.message - 用户消息
 * @param {object} ctx.business_data - 业务数据（含 jtd 产品/路线）
 * @param {Array} ctx.conversation_history - 对话历史
 * @param {object} [deps] - 依赖注入（测试用）
 * @param {Function} [deps.llmCall] - 自定义 LLM 调用函数
 * @returns {Promise<{primary: string|null, cities: string[], source: string, confidence: number}>}
 */
export async function extractCities(ctx = {}, deps = {}) {
  const { message = '', business_data = {}, conversation_history = [] } = ctx;
  const llmCall = deps.llmCall || defaultLlmCall;

  // 合并所有文本用于正则匹配
  const jtdDest = business_data?.jtd?.selected_product?.destination
    || business_data?.jtd?.route?.destination
    || '';
  const allText = `${message} ${jtdDest}`;

  // 1. 正则预筛
  const hotCities = matchHotCity(allText);
  if (hotCities.length > 0) {
    return {
      primary: hotCities[0],
      cities: hotCities,
      source: 'regex',
      confidence: 0.95,
    };
  }

  // 2. LLM 提取
  const historyText = Array.isArray(conversation_history)
    ? conversation_history.slice(-3).map((h) => h.message || h.text || '').join(' | ')
    : '';

  try {
    const result = await llmCall(buildExtractionPrompt(message, jtdDest, historyText));
    if (!result || !result.ok) {
      // LLM 失败，降级
      return { primary: null, cities: [], source: 'none', confidence: 0 };
    }
    const parsed = parseCityJson(result.content);
    if (!parsed) {
      return { primary: null, cities: [], source: 'none', confidence: 0 };
    }

    // 归一化 + 去重
    const normalizedCities = (parsed.cities || [])
      .map(normalizeCity)
      .filter((c, i, arr) => c && arr.indexOf(c) === i);
    const primary = parsed.primary ? normalizeCity(parsed.primary) : null;

    return {
      primary,
      cities: normalizedCities,
      source: 'llm',
      confidence: parsed.confidence ?? 0.8,
    };
  } catch {
    return { primary: null, cities: [], source: 'none', confidence: 0 };
  }
}

/**
 * 默认 LLM 调用（复用项目已有的 model-registry + openai-compatible-client）
 */
async function defaultLlmCall(messages) {
  const model = pickChatModel({ purpose: '城市提取' });
  if (!model || !model.api_base) {
    return { ok: false, error: 'model_not_configured' };
  }
  return callOpenAiCompatibleModel(model, messages, {
    timeoutMs: LLM_TIMEOUT_MS,
    maxTokens: 200,
    temperature: 0,
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/city-extractor.test.js`
Expected: PASS — all tests pass

- [ ] **Step 5: 提交**

```bash
git add src/core/city-extractor/index.js tests/city-extractor.test.js
git commit -m "feat: 城市提取主模块（正则预筛 + LLM 提取 + 降级）"
```

---

### Task 3: orchestrator 集成 — 预提取城市注入

**Files:**
- Modify: `src/core/orchestrator/chat-orchestrator.js`（第 28-38 行 resolveWeatherCity、第 78-94 行 businessData 之后）
- Test: `tests/city-extractor.test.js`（追加集成测试）

- [ ] **Step 1: 追加集成测试**

在 `tests/city-extractor.test.js` 末尾追加：

```javascript
test('orchestrator 预提取城市注入 business_data（travel_route 场景）', async () => {
  const { createChatOrchestrator } = await import('../src/core/orchestrator/chat-orchestrator.js');
  const mockModelService = {
    fillTemplateSlots: ({ message, business_data }) => ({
      template_id: 'route_card',
      answer_text: 'mock',
      data: { destination: business_data?.primary_city || '' },
      actions: [],
      followup_suggestions: [],
    }),
  };
  const orch = createChatOrchestrator({
    dataService: { knowledgeData: { retrieve: () => ({ matches: [] }) }, loadBusinessData: async () => ({}) },
    ragService: { retrieveKnowledge: async () => ({ matches: [] }) },
    modelService: mockModelService,
  });
  const result = await orch.run({
    message: '想去北海旅居',
    role: 'elder_family',
  });
  // 验证城市被注入
  assert.ok(result.envelope?.data?.destination === '北海' || result.stages?.some(s => s.stage === 'city_extract'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/city-extractor.test.js`
Expected: FAIL — orchestrator 未注入 city

- [ ] **Step 3: 修改 orchestrator — 添加导入和预提取**

在 `chat-orchestrator.js` 文件顶部导入区添加：

```javascript
import { extractCities } from '../city-extractor/index.js';
```

在 `run()` 方法中，`loadBusinessData` 之后（约第 78-79 行之间）、`selectRoutedTemplateId` 之前，添加城市预提取：

```javascript
        const businessData = await loadBusinessData({ sceneDecision: acceptedScene || sceneDecision, request, dataService });

        // 城市预提取（仅 travel_route 场景）：从消息+业务数据中提取城市，注入 business_data
        const skillKey = (acceptedScene || sceneDecision)?.scene_key || '';
        if (skillKey === 'travel_route') {
          try {
            const cityResult = await extractCities({
              message: request.message,
              business_data: businessData,
              conversation_history: request.history,
            });
            if (cityResult?.primary) {
              businessData.primary_city = cityResult.primary;
              businessData.cities = cityResult.cities;
            }
            mark('city_extract', '城市提取', { primary: cityResult?.primary, cities: cityResult?.cities, source: cityResult?.source });
          } catch (e) {
            mark('city_extract', '城市提取', { error: e.message });
          }
        }
```

- [ ] **Step 4: 修改 resolveWeatherCity 支持多城市**

将第 28-38 行的 `resolveWeatherCity` 替换为：

```javascript
// 从上下文/业务数据中解析天气查询的城市（优先 action 传入的目的地）
function resolveWeatherCity(request = {}, businessData = {}) {
  const params = request.context?.action_params || {};
  const fromParams = params.city || request.context?.city;
  if (fromParams && String(fromParams).trim()) return String(fromParams).trim();
  // 从预提取结果读取
  const cities = businessData?.cities;
  if (Array.isArray(cities) && cities.length) return cities;
  const bd = businessData || {};
  const jtd = bd.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);
  const route = bd.route || (Array.isArray(bd.routes) ? bd.routes[0] : null);
  const fallback = String(product?.destination || product?.city || route?.destination || bd.primary_city || bd.destination || '防城港').trim();
  return [fallback];
}
```

注意：返回值从 `string` 改为 `string[]`（数组），后续天气查询分支需配合调整。

- [ ] **Step 5: 修改天气查询分支支持多城市并行**

将第 82-95 行的天气分支替换为：

```javascript
        // 天气风险动作：结合上下文城市，调用腾讯天气接口，由模型合成天气风险卡片
        const weatherActionCities = (acceptedScene?.scene_key === 'travel_route' && request.context?.action_key === 'travel_route.check_weather_risk')
          ? resolveWeatherCity(request, businessData)
          : [];
        let modelResult;
        const fallbackActionKey = request.context?.action_key
          && !SPECIAL_CASE_ACTION_KEYS.includes(request.context.action_key)
          ? request.context.action_key
          : null;
        const actionResourceMap = options.actionResourceMap ?? loadActionResourceMap();

        if (weatherActionCities.length > 0) {
          // 并行查询多城市天气
          const weatherResults = await Promise.all(
            weatherActionCities.map((city) =>
              weatherService ? weatherService.getWeather(city).catch(() => null) : null
            )
          );
          const primaryCity = weatherActionCities[0];
          const primaryWeather = weatherResults[0];
          modelResult = fillTravelWeatherRisk({
            city: primaryCity,
            weather: primaryWeather,
            business_data: businessData,
            all_cities: weatherActionCities.length > 1
              ? weatherActionCities.map((city, i) => ({ city, weather: weatherResults[i] })).filter((c) => c.weather?.ok)
              : null,
          });
          mark('model', '天气风险研判', {
            cities: weatherActionCities,
            primary_ok: !!(primaryWeather && primaryWeather.ok),
            source: primaryWeather?.source || 'none',
          });
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/city-extractor.test.js`
Expected: PASS

同时运行回归测试：
Run: `node --test tests/scene-router-travel-route.test.js`
Expected: PASS（所有现有测试不受影响）

- [ ] **Step 7: 提交**

```bash
git add src/core/orchestrator/chat-orchestrator.js tests/city-extractor.test.js
git commit -m "feat: orchestrator 集成城市预提取 + 多城市并行天气查询"
```

---

### Task 4: model-service 天气按钮携带 city 参数

**Files:**
- Modify: `src/core/model-service.js`（fillRouteCard 约 1666-1679 行、fillTravelWeatherRiskCard 约 1765-1851 行）

- [ ] **Step 1: 修改 fillRouteCard 天气按钮带 city 参数**

在 `fillRouteCard` 函数中（约第 1606 行），destination 变量定义后添加 primary_city 读取：

```javascript
  const destination = sanitizeText(product?.destination || product?.city || route?.destination || business_data?.primary_city || inferDestination(message));
```

然后修改 followup_suggestions 的天气建议（约第 1674-1678 行），添加 `params`：

```javascript
      {
        label: '查天气风险',
        user_prompt: '请检查这条旅居路线近期天气风险',
        action_key: 'travel_route.check_weather_risk',
        params: { city: destination },
      },
```

- [ ] **Step 2: 修改 fillTravelWeatherRiskCard 支持 all_cities 多城市数据**

在 `fillTravelWeatherRiskCard` 函数签名和渲染逻辑中，增加 `all_cities` 参数处理。

函数签名改为：

```javascript
export async function fillTravelWeatherRiskCard({ message, business_data, weatherService, all_cities } = {}) {
```

在单城市天气渲染完成后（约第 1879 行 `const current = ...` 之后），增加多城市对比渲染：

```javascript
  // 多城市天气对比（如果 all_cities 存在）
  const multiCityRows = Array.isArray(all_cities) && all_cities.length > 1
    ? all_cities.map((c) => {
        const cur = c.weather?.current || {};
        return `- **${c.city}**：${cur.weather || '未知'} ${cur.temp != null ? cur.temp + '°C' : ''} ${cur.windDir || ''} ${cur.windPower || ''}`.trim();
      })
    : [];

  if (multiCityRows.length) {
    lines.push('');
    lines.push('### 多城市天气对比');
    lines.push(...multiCityRows);
  }
```

- [ ] **Step 3: 运行回归测试**

Run: `node --test tests/scene-router-travel-route.test.js tests/app.test.js`
Expected: PASS（现有测试不受影响）

- [ ] **Step 4: 提交**

```bash
git add src/core/model-service.js
git commit -m "feat: fillRouteCard 天气按钮携带 city 参数 + 多城市天气对比渲染"
```

---

### Task 5: 全量回归测试与验证

- [ ] **Step 1: 运行全量测试**

Run: `npm test`
Expected: 所有测试通过（包括之前失败的 travel_route 相关测试应因 city-extractor 而改善，至少不新增失败）

- [ ] **Step 2: 手动验证天气 API**

```bash
# 单城市
curl "http://127.0.0.1:5298/api/weather?city=北海"

# 多城市（通过 route_card 查天气风险按钮触发，检查 orchestrator 日志中 city_extract 阶段）
```

- [ ] **Step 3: 验证降级路径**

确认以下场景不崩溃：
- LLM 未配置时 → 走正则
- 正则未命中 → primary=null → 天气按钮引导用户指定城市
- 天气 API 超时 → 卡片显示降级提醒

- [ ] **Step 4: 最终提交（如有遗漏的修复）**

```bash
git add -A
git commit -m "test: 城市提取器全量回归验证通过"
```
