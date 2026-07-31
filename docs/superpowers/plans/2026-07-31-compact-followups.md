# 模板清理 + 紧密追问 + 表单输入 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除全部模板内的场景动作按钮/伪按钮，转为紧密追问（compact_followups）胶囊，新增表单输入能力，实现卡片追问与消息追问的互斥去重。

**Architecture:** 三层改造——模板层删除按钮并加占位符；编排层（model-service）生成 compact_followups 数据并经 interaction-composer 互斥去重后渲染为 HTML；前端层（mobile.js/css）绑定胶囊事件并实现 text/select/form 三种输入展开。所有 action 走现有 /api/chat/action 通道，复用 skill_key 场景锁定。

**Tech Stack:** Node.js ESM, Mustache 模板, 原生 DOM (mobile.js), CSS

**Spec:** `docs/superpowers/specs/2026-07-31-compact-followups-design.md`

---

## 实际代码位置参考

| 目标 | 文件 | 行号 |
|------|------|------|
| composeInteractions | src/core/interaction-composer.js | L224 |
| followup_suggestions 组装 | src/core/interaction-composer.js | L246-252 |
| fillRouteCard | src/core/model-service.js | L1634 |
| fillTravelItineraryCard | src/core/model-service.js | L1723 |
| fillTravelWeatherRiskCard | src/core/model-service.js | L1804 |
| fillWeeklyPlan | src/core/model-service.js | L584 |
| fillDietCard | src/core/model-service.js | L714 |
| fillNearbyResourceCard | src/core/model-service.js | L926 |
| handleAssistantAction | src/public/mobile.js | L1801 |
| appendFollowupSuggestions | src/public/mobile.js | L1854 |
| followup CSS | src/public/mobile.css | L261-282 |

> 注：设计中提到的 fillTravelPlanSummaryCard / fillTravelBaseCard / fillTravelTransportCard / fillNearbySummary 函数在代码库中不存在，对应的模板 HTML 由 orchestrator 直接渲染或由 fillRouteCard / fillNearbyResourceCard 间接消费。compact_followups 数据注入点在 orchestrator 的模板渲染步骤中统一处理。

---

### Task 1: compact-followups 渲染模块

**Files:**
- Create: `src/core/compact-followups/renderer.js`
- Test: `tests/compact-followups.test.js`

- [ ] **Step 1: 编写测试**

Create `tests/compact-followups.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderCompactFollowups, dedupeFollowups } from '../src/core/compact-followups/renderer.js';

test('renderCompactFollowups 渲染胶囊 HTML', () => {
  const html = renderCompactFollowups([
    { label: '查天气风险', action_key: 'travel_route.check_weather_risk', params: { city: '防城港' } },
    { label: '立即预定', action_key: 'travel_route.book', style: 'primary' },
  ]);
  assert.ok(html.includes('class="compact-followups"'));
  assert.ok(html.includes('查天气风险'));
  assert.ok(html.includes('立即预定'));
  assert.ok(html.includes('data-action-key="travel_route.check_weather_risk"'));
  assert.ok(html.includes('data-params='));
  assert.ok(html.includes('compact-chip--primary'));
});

test('renderCompactFollowups 空数组返回空字符串', () => {
  assert.equal(renderCompactFollowups([]), '');
  assert.equal(renderCompactFollowups(null), '');
});

test('renderCompactFollowups 带 input 定义渲染 data-input', () => {
  const html = renderCompactFollowups([
    {
      label: '查其他城市',
      action_key: 'travel_route.check_weather_risk',
      input: { type: 'text', placeholder: '输入城市', param_key: 'city' },
    },
  ]);
  assert.ok(html.includes('compact-chip--input'));
  assert.ok(html.includes('data-input='));
  assert.ok(html.includes('"type":"text"'));
});

test('dedupeFollowups 按 action_key 去重', () => {
  const compact = [{ label: '查天气', action_key: 'travel_route.check_weather_risk' }];
  const message = [
    { label: '查天气风险', action_key: 'travel_route.check_weather_risk' },
    { label: '其他建议', action_key: 'travel_route.replan' },
  ];
  const result = dedupeFollowups(compact, message);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, '其他建议');
});

test('dedupeFollowups 按 label 语义相近去重', () => {
  const compact = [{ label: '立即预定', action_key: 'travel_route.book' }];
  const message = [
    { label: '预定旅居', action_key: 'travel_route.book_now' },
    { label: '查看路线', action_key: 'travel_route.view' },
  ];
  const result = dedupeFollowups(compact, message);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, '查看路线');
});

test('dedupeFollowups 互逆动作去重', () => {
  const compact = [{ label: '收藏', action_key: 'nearby_resource.favorite' }];
  const message = [
    { label: '取消收藏', action_key: 'nearby_resource.unfavorite' },
    { label: '导航', action_key: 'nearby_resource.navigate' },
  ];
  const result = dedupeFollowups(compact, message);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, '导航');
});

test('dedupeFollowups compact 为空时原样返回 message', () => {
  const result = dedupeFollowups([], [{ label: 'A', action_key: 'a' }]);
  assert.equal(result.length, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/compact-followups.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现渲染模块**

Create `src/core/compact-followups/renderer.js`:

```javascript
// src/core/compact-followups/renderer.js

// 互逆动作对
const COMPLEMENTARY_PAIRS = [
  ['收藏', '取消收藏'],
  ['关注', '取消关注'],
  ['预定', '取消预定'],
  ['报名', '取消报名'],
];

/**
 * 将 compact_followups 数组渲染为胶囊 HTML
 * @param {Array} followups - 紧密追问数组
 * @returns {string} HTML 字符串（空数组返回空字符串）
 */
export function renderCompactFollowups(followups) {
  if (!Array.isArray(followups) || followups.length === 0) return '';

  const chips = followups.map((f) => {
    const styleClass = f.style === 'primary' ? ' compact-chip--primary'
      : f.style === 'danger' ? ' compact-chip--danger'
      : f.input ? ' compact-chip--input'
      : '';
    const paramsAttr = f.params ? ` data-params='${JSON.stringify(f.params)}'` : '';
    const inputAttr = f.input ? ` data-input='${JSON.stringify(f.input)}'` : '';
    const actionAttr = f.action_key ? ` data-action-key="${f.action_key}"` : '';
    return `  <button class="compact-chip${styleClass}"${actionAttr}${paramsAttr}${inputAttr}>${escapeHtml(f.label || '')}</button>`;
  });

  return `<div class="compact-followups">\n${chips.join('\n')}\n</div>`;
}

/**
 * 互斥去重：从 message followups 中剔除与 compact followups 重复的条目
 * @param {Array} compactFollowups - 卡片紧密追问（全量保留）
 * @param {Array} messageFollowups - 消息追问（被去重）
 * @returns {Array} 去重后的消息追问数组
 */
export function dedupeFollowups(compactFollowups = [], messageFollowups = []) {
  if (!compactFollowups.length) return messageFollowups;
  if (!messageFollowups.length) return [];

  // 收集 compact 的 action_key 集合
  const compactKeys = new Set(compactFollowups.map((f) => f.action_key).filter(Boolean));

  // 收集 compact 的 label 集合（归一化）
  const compactLabels = new Set(compactFollowups.map((f) => normalizeLabel(f.label)));

  // 收集互逆对
  const compactComplements = new Set();
  for (const f of compactFollowups) {
    for (const [a, b] of COMPLEMENTARY_PAIRS) {
      if (normalizeLabel(f.label).includes(normalizeLabel(a))) compactComplements.add(normalizeLabel(b));
      if (normalizeLabel(f.label).includes(normalizeLabel(b))) compactComplements.add(normalizeLabel(a));
    }
  }

  return messageFollowups.filter((mf) => {
    // 规则 1: action_key 相同
    if (mf.action_key && compactKeys.has(mf.action_key)) return false;
    // 规则 2: label 语义相近（词面重叠 ≥60%）
    const mfLabel = normalizeLabel(mf.label);
    for (const cl of compactLabels) {
      if (labelSimilarity(mfLabel, cl) >= 0.6) return false;
    }
    // 规则 3: 互逆动作
    for (const cc of compactComplements) {
      if (mfLabel.includes(cc)) return false;
    }
    return true;
  });
}

// --- 内部工具函数 ---

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeLabel(label = '') {
  return String(label).trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 计算两个标签的词面相似度（基于字符重叠）
 * @returns {number} 0.0-1.0
 */
function labelSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // 字符级 Jaccard 相似度
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const ch of setA) {
    if (setB.has(ch)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/compact-followups.test.js`
Expected: PASS — 7 tests pass

- [ ] **Step 5: 提交**

```bash
git add src/core/compact-followups/renderer.js tests/compact-followups.test.js
git commit -m "feat: compact-followups 渲染模块（胶囊 HTML + 互斥去重）"
```

---

### Task 2: interaction-composer 集成互斥去重

**Files:**
- Modify: `src/core/interaction-composer.js:246-252`

- [ ] **Step 1: 添加 import**

在 `src/core/interaction-composer.js` 文件顶部 import 区（约第 1-5 行附近），添加：

```javascript
import { dedupeFollowups } from './compact-followups/renderer.js';
```

- [ ] **Step 2: 修改 composeInteractions 返回值**

找到 `src/core/interaction-composer.js` 第 224 行的 `composeInteractions` 函数。在 return 语句前（约第 246 行），将 followup_suggestions 的组装改为接受 compact_followups 去重：

修改前（L246-252）：
```javascript
  return {
    actions,
    followup_suggestions: [...modelFollowups, ...defaultFollowups]
      .filter((followup) => isFollowupAllowed(followup, allowed))
      .filter(uniqueFollowup)
      .slice(0, 4),
  };
```

修改后：
```javascript
  const compactFollowups = Array.isArray(modelResult.compact_followups)
    ? modelResult.compact_followups
    : [];

  const rawFollowups = [...modelFollowups, ...defaultFollowups]
    .filter((followup) => isFollowupAllowed(followup, allowed))
    .filter(uniqueFollowup);

  return {
    actions,
    compact_followups: compactFollowups,
    followup_suggestions: dedupeFollowups(compactFollowups, rawFollowups).slice(0, 4),
  };
```

- [ ] **Step 3: 语法检查**

Run: `node --check src/core/interaction-composer.js`
Expected: 无输出（语法正确）

- [ ] **Step 4: 运行现有测试确认无回归**

Run: `node --test tests/compact-followups.test.js`
Expected: PASS — 7 tests

- [ ] **Step 5: 提交**

```bash
git add src/core/interaction-composer.js
git commit -m "feat: composeInteractions 集成 compact_followups 互斥去重"
```

---

### Task 3: 清理 travel_route 模板（3 个文件）

**Files:**
- Modify: `src/skills/travel_route/templates/html/travel_base_card.html`
- Modify: `src/skills/travel_route/templates/html/travel_plan_summary_card.html`
- Modify: `src/skills/travel_route/templates/html/travel_transport_card.html`

- [ ] **Step 1: 清理 travel_base_card.html**

打开 `src/skills/travel_route/templates/html/travel_base_card.html`，找到所有 `<div class="chat-btn` 开头的元素（约 2 个：订房、查看详情），删除这些 `div` 元素。

在主卡片容器闭合 `</div>` 前插入：
```html
    <!-- 紧密追问区 -->
    {{compact_followups}}
```

- [ ] **Step 2: 清理 travel_plan_summary_card.html**

打开 `src/skills/travel_route/templates/html/travel_plan_summary_card.html`：
1. 找到 `<button class="chat-btn">立即预定</button>`，删除该 button 元素
2. 找到 `{{#followUps}}` 到 `{{/followUps}}` 的整块（旧追问区），删除整块
3. 在主卡片容器闭合 `</div>` 前插入 `{{compact_followups}}` 占位符

- [ ] **Step 3: 清理 travel_transport_card.html**

打开 `src/skills/travel_route/templates/html/travel_transport_card.html`，找到 `<button class="buy-btn">去12306购票</button>`（或类似），删除该 button 元素。

在主卡片容器闭合 `</div>` 前插入：
```html
    <!-- 紧密追问区 -->
    {{compact_followups}}
```

- [ ] **Step 4: 验证模板无残留按钮**

用 Grep 检查这三个文件：
```
Grep pattern: <button|chat-btn|buy-btn|followUps
path: src/skills/travel_route/templates/html/
glob: travel_base_card.html|travel_plan_summary_card.html|travel_transport_card.html
```
Expected: 仅 `{{compact_followups}}` 出现，无残留 button/chat-btn/buy-btn/followUps

- [ ] **Step 5: 提交**

```bash
git add src/skills/travel_route/templates/html/travel_base_card.html src/skills/travel_route/templates/html/travel_plan_summary_card.html src/skills/travel_route/templates/html/travel_transport_card.html
git commit -m "refactor: travel_route 模板清理按钮 + 添加 compact_followups 占位符"
```

---

### Task 4: 清理 nearby_resource 模板（7 个文件）

**Files:**
- Modify: `src/skills/nearby_resource/templates/html/nearby_food_card.html`
- Modify: `src/skills/nearby_resource/templates/html/nearby_list.html`
- Modify: `src/skills/nearby_resource/templates/html/nearby_recommend.html`
- Modify: `src/skills/nearby_resource/templates/html/nearby_spot_card.html`
- Modify: `src/skills/nearby_resource/templates/html/nearby_stay_card.html`
- Modify: `src/skills/nearby_resource/templates/html/nearby_wellness.html`
- Modify: `src/skills/nearby_resource/templates/html/nearby_summary.html`

- [ ] **Step 1: 清理 6 个卡片的收藏按钮**

对以下 6 个文件执行相同操作——找到 `<button` 开头含"收藏"的元素，删除该 button：

- `nearby_food_card.html`
- `nearby_list.html`
- `nearby_recommend.html`
- `nearby_spot_card.html`
- `nearby_stay_card.html`
- `nearby_wellness.html`

> 注意：`<a class="nb-btn">导航</a>` 和 `<a class="nb-btn">电话</a>` 是功能外链，**保留不动**。

在每个文件的主卡片容器闭合 `</div>` 前插入：
```html
    <!-- 紧密追问区 -->
    {{compact_followups}}
```

- [ ] **Step 2: 清理 nearby_summary.html 的按钮**

打开 `src/skills/nearby_resource/templates/html/nearby_summary.html`，找到 `<button>朗读</button>` 和 `<button>看地图</button>`（或类似），删除这些 button 元素。

在主卡片容器闭合 `</div>` 前插入 `{{compact_followups}}` 占位符。

- [ ] **Step 3: 验证无残留场景按钮**

用 Grep 检查这 7 个文件：
```
Grep pattern: <button[^>]*>(收藏|朗读|看地图)
path: src/skills/nearby_resource/templates/html/
```
Expected: 无匹配

用 Grep 确认外链按钮保留：
```
Grep pattern: nb-btn
path: src/skills/nearby_resource/templates/html/
```
Expected: `<a class="nb-btn">` 仍存在

- [ ] **Step 4: 提交**

```bash
git add src/skills/nearby_resource/templates/html/nearby_food_card.html src/skills/nearby_resource/templates/html/nearby_list.html src/skills/nearby_resource/templates/html/nearby_recommend.html src/skills/nearby_resource/templates/html/nearby_spot_card.html src/skills/nearby_resource/templates/html/nearby_stay_card.html src/skills/nearby_resource/templates/html/nearby_wellness.html src/skills/nearby_resource/templates/html/nearby_summary.html
git commit -m "refactor: nearby_resource 模板清理收藏/朗读/看地图按钮 + compact_followups 占位符"
```

---

### Task 5: 清理 meal_plan 模板（2 个文件）

**Files:**
- Modify: `src/skills/meal_plan/templates/html/weekly-plan.html`
- Modify: `src/skills/meal_plan/templates/html/diet_card.html`

- [ ] **Step 1: 清理 weekly-plan.html**

打开 `src/skills/meal_plan/templates/html/weekly-plan.html`，找到 `{{followup_suggestions}}` 变量引用，替换为 `{{compact_followups}}`。

- [ ] **Step 2: 清理 diet_card.html**

打开 `src/skills/meal_plan/templates/html/diet_card.html`：
1. 找到所有含 `onclick` 的元素（`<div onclick>`、`<span onclick>`、`<div class="related-card" onclick>`）
2. 删除这些元素的 `onclick` 属性，保留元素的展示内容和结构（改为纯展示）
3. 如果 onclick 元素本身只是一个"伪按钮"（不含展示内容），整个删除

在主卡片容器闭合 `</div>` 前插入：
```html
    <!-- 紧密追问区 -->
    {{compact_followups}}
```

- [ ] **Step 3: 验证**

```
Grep pattern: onclick
path: src/skills/meal_plan/templates/html/diet_card.html
```
Expected: 无匹配

```
Grep pattern: followup_suggestions
path: src/skills/meal_plan/templates/html/weekly-plan.html
```
Expected: 无匹配（已被 compact_followups 替换）

- [ ] **Step 4: 提交**

```bash
git add src/skills/meal_plan/templates/html/weekly-plan.html src/skills/meal_plan/templates/html/diet_card.html
git commit -m "refactor: meal_plan 模板清理 onclick 伪交互 + followup 迁移为 compact_followups"
```

---

### Task 6: model-service fill 函数注入 compact_followups

**Files:**
- Modify: `src/core/model-service.js`

- [ ] **Step 1: 添加 import**

在 `src/core/model-service.js` 文件顶部 import 区添加：

```javascript
import { renderCompactFollowups } from './compact-followups/renderer.js';
```

- [ ] **Step 2: fillRouteCard 注入 compact_followups**

找到 `fillRouteCard`（约 L1634）。在该函数的 return 语句中（返回包含 template_id / answer_html 的对象），新增 `compact_followups` 字段。

在函数 return 前添加：
```javascript
  const compactFollowups = [
    { label: '查天气风险', action_key: 'travel_route.check_weather_risk', params: { city: destination } },
  ];
```

在 return 对象中添加（与其他字段并列）：
```javascript
    compact_followups: compactFollowups,
```

- [ ] **Step 3: fillNearbyResourceCard 注入 compact_followups**

找到 `fillNearbyResourceCard`（约 L926）。在 return 前添加：
```javascript
  const compactFollowups = [
    { label: '收藏', action_key: 'nearby_resource.favorite' },
  ];
```

在 return 对象中添加 `compact_followups: compactFollowups`。

- [ ] **Step 4: fillWeeklyPlan 注入 compact_followups**

找到 `fillWeeklyPlan`（约 L584）。在 return 前添加：
```javascript
  const compactFollowups = [
    { label: '调整饮食偏好', action_key: 'meal_plan.adjust_preference' },
  ];
```

在 return 对象中添加 `compact_followups: compactFollowups`。

- [ ] **Step 5: fillDietCard 注入 compact_followups**

找到 `fillDietCard`（约 L714）。在 return 前添加：
```javascript
  const compactFollowups = [
    { label: '换一个推荐', action_key: 'meal_plan.suggest_alternative' },
  ];
```

在 return 对象中添加 `compact_followups: compactFollowups`。

- [ ] **Step 6: 语法检查**

Run: `node --check src/core/model-service.js`
Expected: 无输出（语法正确）

- [ ] **Step 7: 运行测试**

Run: `node --test tests/compact-followups.test.js tests/city-extractor.test.js`
Expected: ALL PASS

- [ ] **Step 8: 提交**

```bash
git add src/core/model-service.js
git commit -m "feat: fill*Card 函数注入 compact_followups 数据"
```

---

### Task 7: 前端 mobile.js — 胶囊渲染与表单交互

**Files:**
- Modify: `src/public/mobile.js`

- [ ] **Step 1: 添加 bindCompactFollowups 方法**

在 `src/public/mobile.js` 中 `appendFollowupSuggestions` 方法之后（约 L1870+），添加以下方法：

```javascript
  bindCompactFollowups(cardEl) {
    if (!cardEl) return;
    const chips = cardEl.querySelectorAll(".compact-chip:not([data-bound])");
    chips.forEach((chip) => {
      chip.setAttribute("data-bound", "1");
      chip.addEventListener("click", (e) => this.handleCompactChipClick(e));
    });
  }
```

- [ ] **Step 2: 添加 handleCompactChipClick 方法**

紧接上一方法之后添加：

```javascript
  async handleCompactChipClick(e) {
    const chip = e.currentTarget;
    const actionKey = chip.dataset.actionKey;
    if (!actionKey || this.state.sending) return;

    const inputDef = chip.dataset.input ? JSON.parse(chip.dataset.input) : null;

    // 无 input 定义 → 直接发送（复用现有 action 通道）
    if (!inputDef) {
      const params = chip.dataset.params ? JSON.parse(chip.dataset.params) : {};
      this.handleAssistantAction({ action_key: actionKey, params, label: chip.textContent.trim() }, chip);
      return;
    }

    // 有 input 定义 → 展开输入控件
    // 先收起已展开的其他输入
    document.querySelectorAll(".compact-chip-expand").forEach((el) => el.remove());

    if (inputDef.type === "text") this.expandCompactTextInput(chip, inputDef, actionKey);
    else if (inputDef.type === "select") this.expandCompactSelect(chip, inputDef, actionKey);
    else if (inputDef.type === "form") this.expandCompactForm(chip, inputDef, actionKey);
  }
```

- [ ] **Step 3: 添加三种展开方法**

紧接上一方法之后添加：

```javascript
  expandCompactTextInput(chip, def, actionKey) {
    const wrap = document.createElement("span");
    wrap.className = "compact-chip-expand";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = def.placeholder || "";
    input.className = "compact-chip-input";
    const confirm = document.createElement("button");
    confirm.textContent = "✓";
    confirm.className = "compact-chip-confirm";
    const submit = () => {
      const baseParams = chip.dataset.params ? JSON.parse(chip.dataset.params) : {};
      baseParams[def.param_key] = input.value.trim();
      this.handleAssistantAction({ action_key: actionKey, params: baseParams, label: chip.textContent.trim() }, chip);
    };
    confirm.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    wrap.append(input, confirm);
    chip.after(wrap);
    input.focus();
  }

  expandCompactSelect(chip, def, actionKey) {
    const wrap = document.createElement("span");
    wrap.className = "compact-chip-expand";
    const select = document.createElement("select");
    select.className = "compact-chip-select";
    const placeholder = document.createElement("option");
    placeholder.textContent = def.placeholder || "请选择";
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    for (const opt of def.options || []) {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt;
      select.appendChild(o);
    }
    const confirm = document.createElement("button");
    confirm.textContent = "✓";
    confirm.className = "compact-chip-confirm";
    confirm.addEventListener("click", () => {
      if (!select.value) return;
      const baseParams = chip.dataset.params ? JSON.parse(chip.dataset.params) : {};
      baseParams[def.param_key] = select.value;
      this.handleAssistantAction({ action_key: actionKey, params: baseParams, label: chip.textContent.trim() }, chip);
    });
    wrap.append(select, confirm);
    chip.after(wrap);
  }

  expandCompactForm(chip, def, actionKey) {
    const panel = document.createElement("div");
    panel.className = "compact-chip-expand compact-form-panel";
    for (const field of def.fields || []) {
      const row = document.createElement("div");
      row.className = "compact-form-row";
      const label = document.createElement("label");
      label.textContent = field.label || "";
      let input;
      if (field.type === "select") {
        input = document.createElement("select");
        for (const opt of field.options || []) {
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          input.appendChild(o);
        }
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.placeholder = field.placeholder || "";
      }
      input.dataset.fieldKey = field.key;
      input.className = "compact-form-field";
      row.append(label, input);
      panel.appendChild(row);
    }
    const submitBtn = document.createElement("button");
    submitBtn.textContent = "提交";
    submitBtn.className = "compact-chip-confirm compact-form-submit";
    submitBtn.addEventListener("click", () => {
      const params = chip.dataset.params ? JSON.parse(chip.dataset.params) : {};
      panel.querySelectorAll(".compact-form-field").forEach((f) => {
        if (f.value.trim()) params[f.dataset.fieldKey] = f.value.trim();
      });
      this.handleAssistantAction({ action_key: actionKey, params, label: chip.textContent.trim() }, chip);
    });
    panel.appendChild(submitBtn);
    chip.after(panel);
  }
```

- [ ] **Step 4: 在 renderMessage 中调用 bindCompactFollowups**

找到 mobile.js 中消息渲染完成后调用 `appendFollowupSuggestions` 的位置（约 L1760）。在该调用之后添加：

```javascript
    // 绑定卡片内紧密追问胶囊
    const lastBubble = screen.querySelectorAll(".bubble.ai");
    const lastCard = lastBubble[lastBubble.length - 1];
    if (lastCard) this.bindCompactFollowups(lastCard);
```

- [ ] **Step 5: 语法检查**

Run: `node --check src/public/mobile.js`
Expected: 无输出（语法正确）

- [ ] **Step 6: 提交**

```bash
git add src/public/mobile.js
git commit -m "feat: 前端 compact-followups 胶囊渲染 + text/select/form 表单交互"
```

---

### Task 8: 前端 mobile.css — 胶囊样式

**Files:**
- Modify: `src/public/mobile.css`

- [ ] **Step 1: 添加 compact-followups 样式**

在 `src/public/mobile.css` 的 `.mobile-followup-btn:active` 规则之后（约 L282），追加：

```css
/* === 紧密追问胶囊 === */
.compact-followups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px 6px;
}

.compact-chip {
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 13px;
  border: 1px solid #d8e6dc;
  background: #f7fbf8;
  color: #2f6f4e;
  cursor: pointer;
  transition: all 0.15s;
}

.compact-chip:hover {
  background: #edf8f0;
}

.compact-chip:active {
  transform: scale(0.97);
}

.compact-chip--primary {
  background: #2f6f4e;
  color: #fff;
  border-color: #2f6f4e;
}

.compact-chip--danger {
  background: #fff0f0;
  color: #c44;
  border-color: #fcc;
}

.compact-chip--input::after {
  content: " ▾";
  font-size: 10px;
  opacity: 0.6;
}

/* === 展开输入控件 === */
.compact-chip-expand {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.compact-chip-input,
.compact-chip-select {
  padding: 5px 8px;
  border: 1px solid #d8e6dc;
  border-radius: 12px;
  font-size: 13px;
  outline: none;
  max-width: 140px;
}

.compact-chip-confirm {
  padding: 4px 10px;
  border: none;
  border-radius: 12px;
  background: #2f6f4e;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

/* === 表单面板 === */
.compact-form-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  margin-top: 6px;
}

.compact-form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compact-form-row label {
  font-size: 13px;
  color: #666;
  min-width: 60px;
}

.compact-form-field {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #d8e6dc;
  border-radius: 8px;
  font-size: 13px;
}

.compact-form-submit {
  align-self: flex-end;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/public/mobile.css
git commit -m "style: compact-followups 胶囊与表单输入 CSS 样式"
```

---

### Task 9: 全量回归测试

- [ ] **Step 1: 运行全部测试**

Run: `npm test`
Expected: 通过率不低于改动前（改动前 137 pass / 17 fail），且新增的 compact-followups 7 个测试全通过

- [ ] **Step 2: 语法检查所有改动文件**

Run:
```bash
node --check src/core/compact-followups/renderer.js
node --check src/core/interaction-composer.js
node --check src/core/model-service.js
node --check src/public/mobile.js
```
Expected: 全部无输出（语法正确）

- [ ] **Step 3: 确认无残留按钮**

```
Grep pattern: <button|chat-btn|buy-btn|onclick
glob: *.html
path: src/skills/travel_route/templates/html/
```
Expected: travel_itinerary_card.html 的 `<button class="day-tab">` 是标签页切换（保留），其余无残留

```
Grep pattern: <button[^>]*>收藏
glob: *.html
path: src/skills/nearby_resource/templates/html/
```
Expected: 无匹配

- [ ] **Step 4: 最终提交（如有修复）**

如果回归测试发现任何问题，修复后提交。否则跳过此步。
