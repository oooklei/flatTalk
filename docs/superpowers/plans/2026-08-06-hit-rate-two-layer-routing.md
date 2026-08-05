# 命中率优先 · 两层分拣 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第一期打赢对话命中率：消歧闭环 + 场景门加固（含决策日志）+ 旅居第二刀 `publish.json` 索引命中 `route_svg`；mobile 只修挡闭环的部分。

**Architecture:** 第一刀只产出 `scene_id`（scoring + transition + 消歧硬锁定）；第二刀仅在 `travel_route` 内读 `data/sojourn-maps/{route_id}/publish.json`（`status=published`）做目的地/关键词/产品类型匹配。场景门不读发布索引。

**Tech Stack:** Node.js ESM、`node:test`、现有 scene-router / map-kit / mapstudio / mobile 管线

**Spec:** `docs/superpowers/specs/2026-08-06-hit-rate-two-layer-routing-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `docs/hit-rate-golden-cases.json` | 新增 | 串扰 / 消歧 / 线路命中黄金用例 |
| `tests/hit-rate-golden.test.js` | 新增 | 用例驱动回归（场景门 + 第二刀纯函数） |
| `tests/ambiguity-closure.test.js` | 新增 | 消歧硬锁定与 orchestrator 行为 |
| `tests/publish-index.test.js` | 新增 | publish 读写与包匹配 |
| `src/core/scene-router/decision-log.js` | 新增 | 统一路由决策日志（内存 ring + console） |
| `src/core/scene-router/publish-index.js` | 新增 | 扫描/匹配 published 线路包（第二刀） |
| `src/core/scene-router/ambiguity-resolver.js` | 修改 | 选项携带可回传的 `skill_key` |
| `src/core/scene-router/scene-transition-manager.js` | 修改 | 必要时放宽真正双竞争消歧条件（保持可测） |
| `src/core/scene-router/rules/travel-route.js` | 修改 | 强化 vs health/find_service 冲突；`inferRouteType` 可消费 publish 命中 |
| `src/core/scene-router/rules/health-risk-warning.js` | 修改 | 对称强化 vs travel 冲突（避免双向串） |
| `src/core/scene-router/rules/find-service.js` | 修改 | 视基线补 travel 冲突词 |
| `src/core/scene-router/rules/service-quality-eval.js` | 修改 | 确认 vs travel 惩罚足够（已有则只测） |
| `src/core/orchestrator/chat-orchestrator.js` | 修改 | 消歧硬锁、决策日志、第二刀注入 map/route |
| `src/core/map/map-kit.js` | 修改 | 包查找优先 published；多命中排序 |
| `src/admin/mapstudio.js` | 修改 | `POST /publish`；保存不默认 published |
| `src/public/admin/mapstudio.js` | 修改 | 「发布」按钮写 publish |
| `src/public/admin/mapstudio.html` | 修改 | 发布按钮 UI |
| `src/public/mobile.js` | 修改 | 消歧点击带 `skill_key` + `context.ambiguity_pick` |

---

### Task 1: 黄金用例基线

**Files:**
- Create: `docs/hit-rate-golden-cases.json`
- Create: `tests/hit-rate-golden.test.js`

- [ ] **Step 1: 写入黄金用例 JSON**

```json
{
  "version": 1,
  "crosstalk": [
    { "id": "ct-01", "message": "查看桂林夕阳红养老服务中心本月的服务质量评估报告", "expect_scene": "service_quality_eval", "not_scene": "travel_route" },
    { "id": "ct-02", "message": "老人最近血压偏高有什么风险", "expect_scene": "health_risk_warning", "not_scene": "travel_route" },
    { "id": "ct-03", "message": "帮我找一下附近的上门护理服务", "expect_scene": "find_service", "not_scene": "travel_route" },
    { "id": "ct-04", "message": "想去防城港滨海三日游旅居", "expect_scene": "travel_route", "not_scene": "find_service" },
    { "id": "ct-05", "message": "巴马康养旅居线路怎么安排", "expect_scene": "travel_route", "not_scene": "health_risk_warning" },
    { "id": "ct-06", "message": "机构护理员被投诉了怎么整改", "expect_scene": "service_quality_eval", "not_scene": "travel_route" }
  ],
  "ambiguity_labels": [
    { "id": "am-01", "label": "旅居规划", "skill_key": "travel_route" },
    { "id": "am-02", "label": "健康预警", "skill_key": "health_risk_warning" },
    { "id": "am-03", "label": "养老服务", "skill_key": "find_service" },
    { "id": "am-04", "label": "服务质量", "skill_key": "service_quality_eval" }
  ],
  "publish_match": [
    {
      "id": "pm-01",
      "message": "防城港三日游滨海",
      "fixtures": [
        {
          "route_id": "fixture_fcg_coastal",
          "status": "published",
          "destination": ["防城港"],
          "keywords": ["三日游", "滨海"],
          "product_type": "coastal",
          "title": "防城港滨海三日游",
          "updated_at": "2026-08-01T00:00:00.000Z"
        },
        {
          "route_id": "fixture_draft_only",
          "status": "draft",
          "destination": ["防城港"],
          "keywords": ["三日游"],
          "product_type": "coastal",
          "title": "草稿勿命中",
          "updated_at": "2026-08-05T00:00:00.000Z"
        }
      ],
      "expect_route_id": "fixture_fcg_coastal"
    }
  ]
}
```

- [ ] **Step 2: 写场景门基线测试（先允许失败，记录通过率）**

```javascript
// tests/hit-rate-golden.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { identifyScene } from '../src/core/scene-router/index.js';

const cases = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'docs/hit-rate-golden-cases.json'), 'utf8')
);

test('golden crosstalk: scene gate baseline/target', () => {
  let pass = 0;
  const failures = [];
  for (const c of cases.crosstalk) {
    const r = identifyScene({ text: c.message, message: c.message });
    const ok = r?.scene_key === c.expect_scene && r?.scene_key !== c.not_scene;
    if (ok) pass += 1;
    else failures.push({ id: c.id, got: r?.scene_key, expect: c.expect_scene });
  }
  const rate = pass / cases.crosstalk.length;
  // 实现 Task 3 后应变为 >= 0.9；基线阶段先打印
  console.log('[hit-rate] crosstalk pass_rate=', rate, 'failures=', failures);
  assert.ok(rate >= 0.9, `crosstalk pass_rate ${rate} < 0.9: ${JSON.stringify(failures)}`);
});
```

- [ ] **Step 3: 跑基线**

Run: `node --test tests/hit-rate-golden.test.js`  
Expected: 可能 FAIL（记录 failures）；若已 ≥0.9 则 Task 3 只做防回归。

- [ ] **Step 4: Commit**

```bash
git add docs/hit-rate-golden-cases.json tests/hit-rate-golden.test.js
git commit -m "test: add hit-rate golden crosstalk cases"
```

---

### Task 2: 消歧闭环（P0）

**问题：** `mobile.js` 消歧点击只 `sendMessage(label)`，不带 `skill_key`；`acceptScene` 对普通 `skill_key` 仍走 supervisor 守卫，标签短句可能再次串场景。

**Files:**
- Modify: `src/core/scene-router/ambiguity-resolver.js`
- Modify: `src/core/orchestrator/chat-orchestrator.js`（`acceptScene`）
- Modify: `src/public/mobile.js`（`sendMessage` / `appendAmbiguityOptions`）
- Create: `tests/ambiguity-closure.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// tests/ambiguity-closure.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';
import { resolveAmbiguity } from '../src/core/scene-router/ambiguity-resolver.js';

test('resolveAmbiguity options expose skill_key for client round-trip', () => {
  const r = resolveAmbiguity([
    { scene_key: 'travel_route', confidence: 0.7 },
    { scene_key: 'health_risk_warning', confidence: 0.68 },
  ], { message: '不太确定' });
  assert.equal(r.ambiguity_options[0].skill_key, 'travel_route');
  assert.equal(r.ambiguity_options[1].skill_key, 'health_risk_warning');
});

test('ambiguity_pick hard-locks scene even if label is short', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'answer',
        answer_text: 'ok',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });
  const result = await orchestrator.run({
    message: '旅居规划',
    skill_key: 'travel_route',
    conversation_id: 'amb-1',
    turn_id: 'amb-1-t',
    context: { ambiguity_pick: true },
  });
  assert.equal(result.skill_key, 'travel_route');
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `node --test tests/ambiguity-closure.test.js`  
Expected: FAIL（缺 `skill_key` 字段和/或硬锁）

- [ ] **Step 3: 改 `ambiguity-resolver.js`**

在 `options` 映射中增加：

```javascript
return {
  scene_key: c.scene_key,
  skill_key: c.scene_key, // 客户端回传用
  icon: desc.icon,
  label: desc.label,
  desc: desc.desc,
  confidence: c.confidence,
};
```

- [ ] **Step 4: 改 `acceptScene` 硬锁**

在 `acceptScene` 顶部、`forcedSceneKey` 逻辑之前插入：

```javascript
const ambiguityPick = request.context?.ambiguity_pick === true
  || request.context?.ambiguity_pick === 'true';
const ambiguityScene = normalizeForcedSkillKey(
  request.context?.ambiguity_scene_key || (ambiguityPick ? request.skill_key : '')
);
if (ambiguityPick && ambiguityScene) {
  return {
    scene_key: ambiguityScene,
    intent: request.intent || `${ambiguityScene}.ambiguity_pick`,
    decision: 'accept',
    confidence: 1,
    routed: true,
    forced: true,
    ambiguity_pick: true,
  };
}
```

- [ ] **Step 5: 改 `mobile.js`**

1. `sendMessage(text, options = {})`：把 `options.skill_key`、`options.context` 并入 POST body（字段名与现有 API 一致：`skill_key` + `context`）。
2. 消歧点击：

```javascript
btn.addEventListener("click", () => {
  const label = btn.getAttribute("data-label");
  const scene = btn.getAttribute("data-scene");
  this.sendMessage(label, {
    skill_key: scene,
    context: { ambiguity_pick: true, ambiguity_scene_key: scene },
  });
});
```

3. `flushPendingQueue`：若队列元素是对象则展开；否则保持字符串兼容。建议队列存 `{ message, skill_key, context }`。

- [ ] **Step 6: 跑测通过**

Run: `node --test tests/ambiguity-closure.test.js`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/scene-router/ambiguity-resolver.js src/core/orchestrator/chat-orchestrator.js src/public/mobile.js tests/ambiguity-closure.test.js
git commit -m "fix: hard-lock scene on ambiguity pick end-to-end"
```

---

### Task 3: 场景门加固 + 决策日志（P0）

**Files:**
- Create: `src/core/scene-router/decision-log.js`
- Modify: `src/core/orchestrator/chat-orchestrator.js`（在 `identifyScene` / `decideTransition` 后写日志）
- Modify: `src/core/scene-router/rules/travel-route.js`
- Modify: `src/core/scene-router/rules/health-risk-warning.js`
- Modify: `src/core/scene-router/rules/find-service.js`（按失败用例最小补词）
- Modify: `tests/hit-rate-golden.test.js`（保持 ≥0.9）

- [ ] **Step 1: 实现 `decision-log.js`**

```javascript
// src/core/scene-router/decision-log.js
const MAX = 200;
const ring = [];

export function logSceneDecision(entry) {
  const row = {
    ts: new Date().toISOString(),
    utterance: String(entry.utterance || '').slice(0, 200),
    candidates: (entry.candidates || []).slice(0, 5).map((c) => ({
      scene_key: c.scene_key,
      score: c.score,
      confidence: c.confidence,
      decision: c.decision,
    })),
    margin: entry.margin,
    conflict_notes: entry.conflict_notes || [],
    transition_type: entry.transition_type || null,
    ambiguity: Boolean(entry.ambiguity),
    final_scene: entry.final_scene || null,
  };
  ring.push(row);
  if (ring.length > MAX) ring.shift();
  if (process.env.FLAT_TALK_ROUTE_LOG !== '0') {
    console.log('[scene-decision]', JSON.stringify(row));
  }
  return row;
}

export function getRecentSceneDecisions(limit = 50) {
  return ring.slice(-limit);
}
```

- [ ] **Step 2: 在 orchestrator 路由处调用**

在拿到 `sceneDecision` 与 `transition` 之后、返回消歧或最终 scene 之前：

```javascript
import { logSceneDecision } from '../scene-router/decision-log.js';
// ...
logSceneDecision({
  utterance: request.message || request.text || '',
  candidates: sceneDecision?.candidates || [],
  margin: sceneDecision?.margin,
  transition_type: transition?.type,
  ambiguity: transition?.type === TRANSITION_TYPE.AMBIGUOUS,
  final_scene: transition?.type === TRANSITION_TYPE.AMBIGUOUS
    ? null
    : (transition?.scene?.scene_key || sceneDecision?.scene_key || null),
});
```

- [ ] **Step 3: 按 Task 1 failures 加固冲突词（示例，以实测为准）**

`travel-route.js` `conflicts` 增加/加重：

```javascript
{ group: 'health_risk_warning', penalty: 6, terms: ['血压', '血糖', '风险评估', '健康预警', '体质', '舌诊', '慢病风险', '预警报告'] },
{ group: 'find_service', penalty: 5, terms: ['上门护理', '护工', '找服务', '养老机构', '服务目录', '下单服务'] },
```

`health-risk-warning.js` 中 `travel_route` 冲突保持或略增 `滨海`/`三日游`/`旅居线路` 等旅游强词。

**原则：** 只改导致黄金用例失败的最小词表；每改一轮跑 `node --test tests/hit-rate-golden.test.js`。

- [ ] **Step 4: 验收**

Run: `node --test tests/hit-rate-golden.test.js tests/routing-guard.test.js tests/scene-router-travel-route.test.js`  
Expected: crosstalk ≥90%；既有路由测不回归。

- [ ] **Step 5: Commit**

```bash
git add src/core/scene-router/decision-log.js src/core/orchestrator/chat-orchestrator.js src/core/scene-router/rules/*.js tests/hit-rate-golden.test.js
git commit -m "feat: scene decision log and crosstalk conflict hardening"
```

---

### Task 4: 第二刀 publish 索引模块（P0）

**Files:**
- Create: `src/core/scene-router/publish-index.js`
- Create: `tests/publish-index.test.js`

- [ ] **Step 1: 写测试（可用临时目录，注入 `baseDir`）**

```javascript
// tests/publish-index.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  matchPublishedPackages,
  PRODUCT_TYPE_TO_ROUTE_TEMPLATE,
} from '../src/core/scene-router/publish-index.js';

test('matchPublishedPackages prefers published destination+keywords over draft', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-idx-'));
  for (const id of ['fixture_fcg_coastal', 'fixture_draft_only']) {
    const pkg = path.join(dir, id);
    fs.mkdirSync(pkg);
    const status = id.includes('draft') ? 'draft' : 'published';
    fs.writeFileSync(path.join(pkg, 'publish.json'), JSON.stringify({
      route_id: id,
      status,
      destination: ['防城港'],
      keywords: ['三日游', '滨海'],
      product_type: 'coastal',
      title: id,
      updated_at: '2026-08-01T00:00:00.000Z',
    }));
  }
  const hits = matchPublishedPackages('防城港三日游滨海', { baseDir: dir });
  assert.equal(hits[0].route_id, 'fixture_fcg_coastal');
  assert.equal(PRODUCT_TYPE_TO_ROUTE_TEMPLATE.coastal, 'route_coastal');
});
```

- [ ] **Step 2: 实现 `publish-index.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';

export const PRODUCT_TYPE_TO_ROUTE_TEMPLATE = {
  wellness: 'route_wellness',
  coastal: 'route_coastal',
  culture: 'route_culture',
  ecology: 'route_ecology',
};

function stripAdmin(s) {
  return String(s || '').replace(/省|市|县|区|自治区|特别行政区/g, '');
}

export function readPublishMeta(routeDir) {
  const f = path.join(routeDir, 'publish.json');
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

export function listPublishedPackages(baseDir = path.join(process.cwd(), 'data', 'sojourn-maps')) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(baseDir).filter((n) => fs.statSync(path.join(baseDir, n)).isDirectory());
  } catch {
    return [];
  }
  const out = [];
  for (const id of dirs) {
    const meta = readPublishMeta(path.join(baseDir, id));
    if (!meta || meta.status !== 'published') continue;
    out.push({ ...meta, route_id: meta.route_id || id, _dir: id });
  }
  return out;
}

/** @returns ranked hits: [{ route_id, score, meta, product_template_id }] */
export function matchPublishedPackages(utterance, { baseDir } = {}) {
  const text = String(utterance || '');
  const textNorm = stripAdmin(text);
  const pkgs = listPublishedPackages(baseDir);
  const scored = [];
  for (const p of pkgs) {
    let score = 0;
    const dests = Array.isArray(p.destination) ? p.destination : [p.destination].filter(Boolean);
    for (const d of dests) {
      const dn = stripAdmin(d);
      if (dn && (textNorm.includes(dn) || dn.includes(textNorm))) score += 10;
    }
    for (const kw of p.keywords || []) {
      if (kw && text.includes(kw)) score += 3;
    }
    if (score <= 0) continue;
    const updated = Date.parse(p.updated_at || 0) || 0;
    scored.push({
      route_id: p.route_id,
      score,
      updated,
      meta: p,
      product_template_id: PRODUCT_TYPE_TO_ROUTE_TEMPLATE[p.product_type] || 'route_wellness',
    });
  }
  scored.sort((a, b) => (b.score - a.score) || (b.updated - a.updated));
  return scored;
}
```

- [ ] **Step 3: 跑测**

Run: `node --test tests/publish-index.test.js`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/scene-router/publish-index.js tests/publish-index.test.js
git commit -m "feat: published sojourn package match index (layer-2)"
```

---

### Task 5: map-kit + travel 管线接入第二刀

**Files:**
- Modify: `src/core/map/map-kit.js`（`findPrebuiltPackageByDestination` / `buildRouteMapData`）
- Modify: `src/core/orchestrator/chat-orchestrator.js` 或 `travel-route-agent.js`（注入 `route_id` / `route_type`）
- Modify: `src/core/scene-router/rules/travel-route.js`（可选：`inferRouteType` 在有 publish 命中时用 `product_type`）
- Modify: `tests/hit-rate-golden.test.js`（增加 publish_match 断言）

- [ ] **Step 1: `buildRouteMapData` 优先 publish 命中**

在现有 `findPrebuiltPackage(routeId)` 之后、destination 兜底之前：

```javascript
import { matchPublishedPackages } from '../scene-router/publish-index.js';

// 若无 routeId：用 utterance/destination 走 publish 索引
if (!pkg && (destination || options?.utterance)) {
  const hits = matchPublishedPackages(options?.utterance || destination);
  if (hits.length === 1 || (hits[0] && hits[0].score > (hits[1]?.score || 0))) {
    pkg = findPrebuiltPackage(hits[0].route_id, version);
    if (pkg) pkg = { ...pkg, routeId: hits[0].route_id, publish: hits[0] };
  } else if (hits.length > 1 && hits[0].score === hits[1].score) {
    // 多命中同分：返回 ambiguous 标记，由上层消歧「选哪条线」
    return { ambiguous_routes: hits.slice(0, 3), map: null };
  }
}
```

注意：`findPrebuiltPackageByDestination` 对 **draft** 包也要命中——改为先 `matchPublishedPackages`；仅当无 published 命中时再走旧 destination 扫描，并在日志打 `fallback_unpublished_scan`。

- [ ] **Step 2: orchestrator / agent 注入**

在 travel 渲染前：

```javascript
const hits = matchPublishedPackages(sceneInput.text);
const top = hits[0];
if (top && (!hits[1] || top.score > hits[1].score)) {
  business_data.route_id = top.route_id;
  routeType = top.product_template_id; // route_coastal 等
}
```

未命中：保持现有兜底，并 `logSceneDecision` 或单独 `console.log('[publish-miss]', ...)`。

- [ ] **Step 3: 黄金用例第二刀**

在 `hit-rate-golden.test.js` 用临时 `baseDir` 写入 `publish_match` fixtures，断言 `matchPublishedPackages` 结果。

- [ ] **Step 4: Commit**

```bash
git add src/core/map/map-kit.js src/core/orchestrator/chat-orchestrator.js src/core/scene-router/rules/travel-route.js tests/hit-rate-golden.test.js
git commit -m "feat: wire publish index into route_svg package lookup"
```

---

### Task 6: 工坊发布 API + UI（P0）

**Files:**
- Modify: `src/admin/mapstudio.js`
- Modify: `src/public/admin/mapstudio.js`
- Modify: `src/public/admin/mapstudio.html`

- [ ] **Step 1: 后端 `POST /publish`**

在 `mapstudio.js` 路由表增加 `publish`；实现：

```javascript
async function handlePublish(req, res) {
  const body = await readJsonSafe(req, res);
  if (!body) return;
  const { route_id, destination, keywords, product_type, title, status } = body;
  if (!route_id) return json(res, 400, { ok: false, error: 'route_id_required' });
  const pkgDir = path.join(MAPS_DIR, route_id);
  if (!fs.existsSync(path.join(pkgDir, 'route_data.json'))) {
    return json(res, 404, { ok: false, error: 'package_not_found_save_first' });
  }
  const publish = {
    route_id,
    status: status === 'draft' ? 'draft' : 'published',
    destination: Array.isArray(destination) ? destination : [destination].filter(Boolean),
    keywords: Array.isArray(keywords) ? keywords : [],
    product_type: product_type || 'wellness',
    title: title || route_id,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pkgDir, 'publish.json'), JSON.stringify(publish, null, 2), 'utf8');
  return json(res, 200, { ok: true, publish });
}
```

`handleSave` **不**自动写 `status: published`（符合 spec：保存 ≠ 发布）。可选：若请求带 `also_publish: true` 可顺带写，默认 false。

- [ ] **Step 2: 前端「发布」按钮**

在保存按钮旁增加「发布」：收集目的地（可从 `route_data.destination`）、关键词（input）、`product_type` select，调用 `api('/publish', { method:'POST', body: ... })`。

- [ ] **Step 3: 手工验收**

1. 保存某线路 → 对话不应仅因 draft 命中（若本地已有旧包，用新 route_id 测）。
2. 发布后用目的地/关键词对话 → `route_svg` 带上该包。

- [ ] **Step 4: Commit**

```bash
git add src/admin/mapstudio.js src/public/admin/mapstudio.js src/public/admin/mapstudio.html
git commit -m "feat(mapstudio): explicit publish.json for route discovery"
```

---

### Task 7: S4 mobile 最小修补（P1）

**Files:**
- Modify: `src/public/mobile.js`（仅若发现消歧/旅居动作被剥脚本或白名单挡住）
- 按需：`src/core/actions/action-resource-map.json` / dispatch manifests

- [ ] **Step 1: 手工点验**

在 mobile 页：触发消歧 → 点「旅居规划」→ 确认进 `travel_route`（Network 里 body 含 `ambiguity_pick`）。

- [ ] **Step 2: 若卡片内 action 失效**

只放行挡闭环的 `action_key`（对照 `action-resource-map.json`）；**不做**全面取消 script strip。

- [ ] **Step 3: Commit（若有改动）**

```bash
git add src/public/mobile.js
git commit -m "fix(mobile): unblock hit-rate critical actions only"
```

---

### Task 8: 总验收

- [ ] **Step 1: 跑测试套件**

```bash
node --test tests/hit-rate-golden.test.js tests/ambiguity-closure.test.js tests/publish-index.test.js tests/routing-guard.test.js tests/scene-router-travel-route.test.js
```

Expected: 全部 PASS；crosstalk ≥ 90%。

- [ ] **Step 2: 对照 spec Done**

| Spec 项 | 证据 |
|---------|------|
| 消歧闭环 | Task 2 测 + mobile 点选 |
| 串扰进对率 | Task 1/3 黄金用例 ≥90% |
| published 包可命中 | Task 4–6 |
| draft 不命中 | publish-index 测 |
| 场景门不读索引 | 代码审查：`identifyScene` 路径无 `publish-index` import |

- [ ] **Step 3: 最终 commit（若有文档更新）**

```bash
git add docs/hit-rate-golden-cases.json
git commit -m "test: finalize hit-rate golden acceptance set"
```

---

## Self-Review vs Spec

| Spec 要求 | 对应 Task |
|-----------|-----------|
| S1 消歧闭环 + mobile | Task 2, 7 |
| S2 场景门 + 决策日志 | Task 3 |
| S3 publish 索引 → route_svg | Task 4, 5, 6 |
| S4 最小 mobile/派单 | Task 7 |
| 保存≠发布 | Task 6 |
| 黄金用例 | Task 1, 8 |
| 不做工坊 UI 大改 / legacy 全删 | 未列入 |

无 TBD 占位；`product_type`（publish）与 `route_*` 模板 id 映射在 `PRODUCT_TYPE_TO_ROUTE_TEMPLATE` 一处定义。
