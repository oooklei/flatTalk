# FlyAI 本地知识库接入 + 地图序 SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 FlyAI（`FLYAI_API_KEY`）灌满 19 条旅居线路本地知识库；对话本地优先、低分补拉；按 waypoint 点序 SSE 推结构化事件；卡片地图仍自建 SVG。

**Architecture:** `flyai-client` 调 CLI → `normalize` 把 `ai-search` Markdown + `search-poi` + `keyword-search` 合成文档 → 落盘 `data/flyai-kb/` 并挂入 knowledge-data；travel 填卡前走检索阈值；可选 `Accept: text/event-stream` 按点序推送后附最终 envelope。

**Tech Stack:** Node.js ESM、`@fly-ai/flyai-cli`（子进程）、现有 `knowledge-data` / travel_route / sojourn-maps、`node:test`

**Spec:** `docs/superpowers/specs/2026-08-06-fliggy-flyai-knowledge-ingest-design.md`

**Probe:** `scripts/test-output/flyai-probe/VERIFY_REPORT_WITH_KEY.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/config/env.js` | 修改 | `flyaiApiKey` / `flyaiKbHitThreshold` |
| `.env.example` | 修改 | 文档化 `FLYAI_API_KEY`（无真实值） |
| `src/services/flyai/flyai-client.js` | 新增 | 封装 `keyword-search` / `ai-search` / `search-poi` |
| `src/services/flyai/normalize-flyai-doc.js` | 新增 | Markdown+POI+商品 → 规范化文档 |
| `src/services/flyai/flyai-kb-store.js` | 新增 | `data/flyai-kb/` 读写、content_hash、upsert |
| `src/services/flyai/flyai-knowledge-bridge.js` | 新增 | 检索本地 KB；低分 live 补拉并写回 |
| `data/flyai-kb/seeds.json` | 新增 | 19 条 seed（route_id / destination / query / city） |
| `data/flyai-kb/.gitkeep` | 新增 | 目录占位；`raw/` 可 gitignore |
| `scripts/flyai-bootstrap-19.mjs` | 新增 | 首灌 19 条 |
| `scripts/flyai-nightly-refresh.mjs` | 新增 | 0 点按 ID/关键词重刷 |
| `src/services/knowledge-data/index.js` | 修改 | 合并 flyai-kb 文档进 travel_route chunks |
| `src/core/agents/agents/travel-route-agent.js` | 修改 | 填卡前调用 bridge；注入 waypoints/stream 元数据 |
| `src/contracts/envelope.js` | 修改 | 允许 `data.stream_events` / `data.waypoints` |
| `src/app.js` | 修改 | chat 支持 SSE（`stream=1` 或 Accept） |
| `src/public/mobile.js` | 修改 | 可选消费 SSE / 本地按序高亮（最小改动） |
| `tests/flyai-normalize.test.js` | 新增 | Markdown/POI 规范化 |
| `tests/flyai-kb-bridge.test.js` | 新增 | 阈值命中 / 未命中补拉（mock client） |
| `tests/flyai-sse-order.test.js` | 新增 | 事件顺序 = waypoints 顺序 |

---

### Task 1: 环境变量与 fixture

**Files:**
- Modify: `src/config/env.js`
- Modify: `.env.example`
- Create: `tests/fixtures/flyai-ai-search-bama.md.json`（从探测样例裁剪，无密钥）

- [ ] **Step 1: 扩展 `loadEnv`**

在 `src/config/env.js` 的 return 对象增加：

```js
flyaiApiKey: process.env.FLYAI_API_KEY || "",
flyaiKbHitThreshold: Number(process.env.FLYAI_KB_HIT_THRESHOLD || 0.72),
flyaiCliTimeoutMs: Number(process.env.FLYAI_CLI_TIMEOUT_MS || 120000),
```

- [ ] **Step 2: 更新 `.env.example`**

追加（不要写入真实 key）：

```
# FlyAI（飞猪 AI 开放平台）
FLYAI_API_KEY=
FLYAI_KB_HIT_THRESHOLD=0.72
FLYAI_CLI_TIMEOUT_MS=120000
```

- [ ] **Step 3: 写入精简 fixture**

从 `scripts/test-output/flyai-probe/withkey-ai-bama.pretty.json` 与 `withkey-poi-bama.pretty.json` 复制到 `tests/fixtures/`，删减到前 3 个 POI + 截断 Markdown（保证测试稳定离线）。

- [ ] **Step 4: Commit**

```bash
git add src/config/env.js .env.example tests/fixtures/flyai-*.json
git commit -m "chore: add FlyAI env knobs and offline fixtures"
```

---

### Task 2: FlyAI CLI client

**Files:**
- Create: `src/services/flyai/flyai-client.js`
- Create: `tests/flyai-client.test.js`

- [ ] **Step 1: 写失败测试（mock spawn）**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlyaiClient } from '../src/services/flyai/flyai-client.js';

test('keywordSearch parses itemList JSON', async () => {
  const client = createFlyaiClient({
    runner: async () => ({
      stdout: JSON.stringify({ data: { itemList: [{ info: { title: '百鸟岩景区' } }] }, status: 'ok' }),
      stderr: '',
      code: 0,
    }),
  });
  const r = await client.keywordSearch('我想去巴马旅游');
  assert.equal(r.ok, true);
  assert.equal(r.data.itemList[0].info.title, '百鸟岩景区');
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `node --test tests/flyai-client.test.js`  
Expected: FAIL module not found

- [ ] **Step 3: 实现 client**

```js
import { spawn } from 'node:child_process';

export function createFlyaiClient({
  apiKey = process.env.FLYAI_API_KEY || '',
  timeoutMs = 120000,
  runner = null,
} = {}) {
  async function run(args) {
    if (runner) return runner(args);
    return new Promise((resolve, reject) => {
      const child = spawn('flyai', args, {
        env: { ...process.env, FLYAI_API_KEY: apiKey },
        shell: process.platform === 'win32',
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`flyai_timeout_${timeoutMs}`));
      }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  }

  function parseStdout(stdout) {
    const cut = stdout.search(/\nAssertion failed/);
    const t = (cut >= 0 ? stdout.slice(0, cut) : stdout).trim();
    if (!t.startsWith('{')) return { ok: false, error: 'not_json', raw: t.slice(0, 500) };
    try {
      return { ok: true, data: JSON.parse(t) };
    } catch (e) {
      return { ok: false, error: e.message, raw: t.slice(0, 500) };
    }
  }

  return {
    async keywordSearch(query) {
      const r = await run(['keyword-search', '--query', String(query)]);
      const p = parseStdout(r.stdout);
      return p.ok ? { ok: true, data: p.data.data ?? p.data, raw: p.data } : p;
    },
    async aiSearch(query) {
      const r = await run(['ai-search', '--query', String(query)]);
      const p = parseStdout(r.stdout);
      return p.ok ? { ok: true, data: p.data.data ?? p.data, raw: p.data } : p;
    },
    async searchPoi({ keyword, cityName }) {
      const args = ['search-poi', '--keyword', String(keyword)];
      if (cityName) args.push('--city-name', String(cityName));
      const r = await run(args);
      const p = parseStdout(r.stdout);
      return p.ok ? { ok: true, data: p.data.data ?? p.data, raw: p.data } : p;
    },
  };
}
```

- [ ] **Step 4: 跑测通过**

Run: `node --test tests/flyai-client.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/flyai/flyai-client.js tests/flyai-client.test.js
git commit -m "feat: add FlyAI CLI client wrapper"
```

---

### Task 3: 规范化（Markdown + POI + 商品）

**Files:**
- Create: `src/services/flyai/normalize-flyai-doc.js`
- Create: `tests/flyai-normalize.test.js`

- [ ] **Step 1: 写测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFlyaiDoc, extractTitlesFromMarkdown } from '../src/services/flyai/normalize-flyai-doc.js';

test('extractTitlesFromMarkdown finds linked spot names', () => {
  const md = '### **[巴马水晶宫](https://router.feizhu.com/x)**\n- **亮点**：溶洞';
  assert.deepEqual(extractTitlesFromMarkdown(md), ['巴马水晶宫']);
});

test('normalize merges poi latlng by name', () => {
  const doc = normalizeFlyaiDoc({
    linked_route_id: 'bama_5d4n',
    query: '我想去巴马旅游',
    aiMarkdown: '### **[百鸟岩景区](https://x)**\n',
    poiList: [{ id: '17165738', name: '百鸟岩景区', latitude: '24.23', longitude: '107.12' }],
    products: [{ info: { title: '巴马温泉酒店', jumpUrl: 'https://y' } }],
  });
  assert.equal(doc.waypoints[0].name, '百鸟岩景区');
  assert.equal(doc.waypoints[0].lat, 24.23);
  assert.equal(doc.source, 'flyai');
  assert.ok(doc.content_hash);
});
```

- [ ] **Step 2: 实现 normalize**

要点：
- `extractTitlesFromMarkdown`: 匹配 `### **[名称](url)**` 与 `**[名称](url)**`
- `waypoints[]`: 按 Markdown 出现顺序；用名称模糊对齐 POI（包含/去后缀「景区」）
- `products[]`: 取 keyword-search `itemList` 前 N 条
- `text`: 拼接 title + markdown + waypoint 名，供 chunk/向量
- `content_hash`: md5(JSON of stable fields)

- [ ] **Step 3: 跑测**

Run: `node --test tests/flyai-normalize.test.js`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/flyai/normalize-flyai-doc.js tests/flyai-normalize.test.js
git commit -m "feat: normalize FlyAI markdown+poi into KB document"
```

---

### Task 4: KB 落盘 + seeds + bootstrap

**Files:**
- Create: `src/services/flyai/flyai-kb-store.js`
- Create: `data/flyai-kb/seeds.json`
- Create: `data/flyai-kb/.gitkeep`
- Create: `scripts/flyai-bootstrap-19.mjs`
- Modify: `.gitignore`（忽略 `data/flyai-kb/raw/**` 与 `*.raw.json`）

- [ ] **Step 1: seeds.json**

从 `data/sojourn-maps/index.json` 生成 19 条，字段：

```json
{
  "version": 1,
  "seeds": [
    {
      "linked_route_id": "bama_5d4n",
      "destination": "巴马",
      "city_name": "河池",
      "keywords": ["巴马", "康养", "长寿"],
      "query": "我想去巴马旅游"
    }
  ]
}
```

其余线路：`query` = `我想去{destination}旅游`；`city_name` 按目的地映射（防城港→防城港，桂林→桂林，贺州→贺州，南宁→南宁，巴马→河池；未知则用 destination）。

- [ ] **Step 2: store API**

```js
// upsertDoc(doc) -> writes data/flyai-kb/{linked_route_id}.json
// + raw snapshot under data/flyai-kb/raw/{id}-{ts}.json
// listDocs() / getByRouteId() / getByKeyword()
```

- [ ] **Step 3: bootstrap 脚本**

对每个 seed：`aiSearch(query)` + `searchPoi` + `keywordSearch` → normalize → upsert。  
支持 `--dry-run`、`--only=bama_5d4n`、失败不中断（记入 summary）。

Run（需本机 Key）：

```bash
node scripts/flyai-bootstrap-19.mjs --only=bama_5d4n
```

Expected: `data/flyai-kb/bama_5d4n.json` 生成且含 `waypoints`

- [ ] **Step 4: Commit（不含 raw 大文件与真实 key）**

```bash
git add src/services/flyai/flyai-kb-store.js data/flyai-kb/seeds.json data/flyai-kb/.gitkeep scripts/flyai-bootstrap-19.mjs .gitignore
git commit -m "feat: FlyAI KB store and bootstrap script for 19 routes"
```

---

### Task 5: Bridge（本地优先 + 阈值 + live 补拉）

**Files:**
- Create: `src/services/flyai/flyai-knowledge-bridge.js`
- Create: `tests/flyai-kb-bridge.test.js`
- Modify: `src/services/knowledge-data/index.js`（把 flyai-kb 文档注入 `travel_route` document list）

- [ ] **Step 1: bridge 行为测试（全 mock）**

```js
test('score>=threshold returns local without live', async () => { /* ... */ });
test('score<threshold calls live and upserts', async () => { /* ... */ });
test('exact linked_route_id bypasses threshold', async () => { /* ... */ });
```

打分初版（可测）：
- 精确 route_id / destination 命中 → 1.0
- 关键词命中数 / keywords.length → 0~1
- 与 retriever 向量分取 max（若传入 `vectorScore`）

- [ ] **Step 2: knowledge-data 合并**

在加载 documents 时读取 `data/flyai-kb/*.json`（非 raw），转为：

```js
{
  document_id: `flyai-${linked_route_id}`,
  skill_key: 'travel_route',
  title: doc.title,
  source_path: path,
  text: doc.text,
  meta: { source: 'flyai', linked_route_id, waypoints: doc.waypoints },
}
```

- [ ] **Step 3: 跑测**

Run: `node --test tests/flyai-kb-bridge.test.js`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/flyai/flyai-knowledge-bridge.js tests/flyai-kb-bridge.test.js src/services/knowledge-data/index.js
git commit -m "feat: FlyAI knowledge bridge with hit threshold and live upsert"
```

---

### Task 6: travel_route 接入 + stream_events

**Files:**
- Modify: `src/core/agents/agents/travel-route-agent.js`
- Modify: `src/contracts/envelope.js`（如需注释/透传，不破坏 validate）
- Create: `tests/flyai-sse-order.test.js`

- [ ] **Step 1: 纯函数生成事件序**

在 `normalize-flyai-doc.js` 或新建 `src/services/flyai/build-stream-events.js`：

```js
export function buildMapOrderedStreamEvents(doc) {
  const events = [
    { event: 'route_meta', payload: { title: doc.title, linked_route_id: doc.linked_route_id, source: 'flyai' } },
    { event: 'product_meta', payload: { products: (doc.products || []).slice(0, 5) } },
  ];
  const byDay = new Map();
  for (const wp of doc.waypoints || []) {
    const day = wp.day || 'Day1';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(wp);
  }
  for (const [day, points] of byDay) {
    for (const wp of points) {
      events.push({
        event: 'map_point',
        payload: { order: wp.order, name: wp.name, day, lat: wp.lat, lng: wp.lng },
      });
    }
    events.push({
      event: 'itinerary_day',
      payload: { day, point_orders: points.map((p) => p.order), summary: points.map((p) => p.name).join('、') },
    });
  }
  events.push({ event: 'done', payload: { counts: { points: (doc.waypoints || []).length }, from_cache: doc.from_cache !== false } });
  return events;
}
```

测试：事件中 `map_point` 顺序与 `waypoints` 一致。

- [ ] **Step 2: travel agent**

在生成路线卡前调用 `resolveFlyaiKnowledge({ query, linked_route_id })`；把 `waypoints` / `highlights` 合并进模板数据；`data.stream_events = buildMapOrderedStreamEvents(doc)`。  
FlyAI 失败时保持现有 sojourn-maps 路径。

- [ ] **Step 3: 跑测**

Run: `node --test tests/flyai-sse-order.test.js`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/flyai/build-stream-events.js src/core/agents/agents/travel-route-agent.js tests/flyai-sse-order.test.js
git commit -m "feat: attach map-ordered stream_events from FlyAI KB in travel agent"
```

---

### Task 7: 真正 SSE 输出（chat）

**Files:**
- Modify: `src/app.js`（`/api/chat/message`）
- Modify: `src/public/mobile.js`（最小：`stream=1` 时边收边高亮；无则忽略）

- [ ] **Step 1: 服务端**

当请求 `url.searchParams.get('stream') === '1'` 或 `Accept` 含 `text/event-stream`：
1. `res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })`
2. 跑现有 orchestrator 得到 envelope
3. 若 `envelope.data.stream_events` 存在，逐条：

```js
res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.payload)}\n\n`);
```

4. 最后：

```js
res.write(`event: envelope\ndata: ${JSON.stringify(envelope)}\n\n`);
res.end();
```

非 stream 请求保持原 JSON。

- [ ] **Step 2: mobile 最小消费**

仅当 `localStorage.ft_sse === '1'` 或调试开关打开时走 SSE；解析 `map_point` 后 `console.debug` / 若地图 iframe 有 `postMessage` 则转发 `highlight_waypoint`。默认路径不变，避免回归。

- [ ] **Step 3: 手工验证**

```bash
curl -N -H "Accept: text/event-stream" -H "Content-Type: application/json" \
  --data "{\"message\":\"我想去巴马旅游\"}" \
  "http://127.0.0.1:5298/api/chat/message?stream=1"
```

Expected: 先见若干 `map_point`，最后 `envelope`

- [ ] **Step 4: Commit**

```bash
git add src/app.js src/public/mobile.js
git commit -m "feat: SSE map-ordered events on chat message stream mode"
```

---

### Task 8: 夜间重刷

**Files:**
- Create: `scripts/flyai-nightly-refresh.mjs`

- [ ] **Step 1: 脚本**

读取 `listDocs()`；对每条用 `seed.query` 或 `keywords` 重拉；`content_hash` 相同则 skip；写 summary JSON 到 `scripts/test-output/flyai-probe/nightly-last.json`。

- [ ] **Step 2: 文档说明**

在 design 或 README 片段注明 Windows 任务计划 / cron：

```
0 0 * * * cd /path/to/flatTalk && node scripts/flyai-nightly-refresh.mjs
```

- [ ] **Step 3: Commit**

```bash
git add scripts/flyai-nightly-refresh.mjs
git commit -m "feat: nightly FlyAI KB refresh by id and keywords"
```

---

### Task 9: 全量 bootstrap 与冒烟

- [ ] **Step 1: 全量灌库**

```bash
node scripts/flyai-bootstrap-19.mjs
```

Expected: 19 个 `data/flyai-kb/*.json`（允许个别 live 失败记入 summary）

- [ ] **Step 2: 回归测试**

```bash
node --test tests/flyai-*.test.js
```

Expected: 全部 PASS

- [ ] **Step 3: 对话冒烟**

本地发「我想去巴马旅游」，确认：本地命中 / envelope 含 `stream_events` / 卡片仍出 SVG（非飞猪地图嵌入）。

---

## Spec coverage self-check

| Spec 要求 | Task |
|-----------|------|
| FlyAI 上游 + API Key | 1–2 |
| ai-search Markdown + poi 规范化 | 3 |
| 19 条 bootstrap | 4, 9 |
| 本地优先 + 阈值 + live upsert | 5 |
| 自建 SVG（不嵌飞猪地图） | 6（沿用 sojourn；不引入飞猪地图） |
| 点序 SSE | 6–7 |
| 0 点重刷 | 8 |
| vacation 账密不进主路径 | 遵守（无相关任务） |

## Placeholder scan

无 TBD；阈值默认 0.72；SSE 默认兼容旧 JSON 客户端。

---

Plan complete and saved to `docs/superpowers/plans/2026-08-06-fliggy-flyai-knowledge-ingest.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新开子代理，任务间复审  
2. **Inline Execution** — 本会话按 executing-plans 连续推进  

Which approach?
