# 模板清理 + 紧密追问 + 表单输入设计

> 日期: 2026-07-31
> 状态: 已确认，待实施
> 备份: `backup/templates-20260731-223033/`（177 文件全量备份）

## 1. 背景与目标

### 问题
- 底部对话框输入会触发意图识别 → 场景路由全流程重跑，打断当前技能流程
- 模板内内置按钮（收藏/预定/购票等）与消息级追问职责重叠，视觉杂乱
- 用户在即时场景下无法通过结构化输入表达需求（只能自由文本）

### 目标
1. 清除所有模板内的场景动作按钮和伪按钮元素（外链按钮保留）
2. 将被删除的按钮转为紧密追问（compact_followups），绑定到对应卡片模板
3. 新增表单输入能力（text/select/form），通过追问胶囊触发，走 action 通道锁定场景
4. 卡片紧密追问与消息追问互斥去重，紧密追问有优先展示权

## 2. 模板层改造规则

### 2.1 改造范围

**第一类：删除按钮 + 伪按钮（11 个文件）**

| 文件 | 删除内容 | compact_followups 迁移 |
|------|----------|----------------------|
| nearby_food_card.html | `<button>收藏</button>` | 收藏 |
| nearby_list.html | `<button>收藏</button>` | 收藏 |
| nearby_recommend.html | `<button>收藏</button>` | 收藏 |
| nearby_spot_card.html | `<button>收藏</button>` | 收藏 |
| nearby_stay_card.html | `<button>收藏</button>` | 收藏 |
| nearby_wellness.html | `<button>收藏</button>` | 收藏 |
| nearby_summary.html | `<button>朗读</button>` `<button>看地图</button>` | 朗读、看地图 |
| travel_base_card.html | `<div class="chat-btn solid">订房</div>` `<div class="chat-btn">查看详情</div>` | 订房、查看详情 |
| travel_plan_summary_card.html | `<button class="chat-btn">立即预定</button>` | 立即预定 |
| travel_transport_card.html | `<button class="buy-btn">去12306购票</button>` | 去12306购票 |

> nearby 卡片中的 `<a class="nb-btn">导航</a>` 和 `<a class="nb-btn">电话</a>` 为功能外链，保留不动。

**第二类：删除模板内旧追问区（2 个文件）**

| 文件 | 删除 | 替换为 |
|------|------|--------|
| travel_plan_summary_card.html | `{{#followUps}}...{{/followUps}}` 整块 | `{{compact_followups}}` |
| weekly-plan.html | `{{followup_suggestions}}` | `{{compact_followups}}` |

**第三类：删除 onclick 伪交互（1 个文件）**

| 文件 | 删除 |
|------|------|
| diet_card.html | `<div onclick>`、`<span onclick>`、`<div class="related-card" onclick>` — 改为纯展示，选项迁移为 compact_followups |

**第四类：保留不动（49 个文件）**

不含任何按钮或仅含功能外链的模板（common 6 个、dispatch_manage 7 个、health_risk_warning 7 个等）不做任何改动。

### 2.2 占位符放置

每个被改造的模板，在主卡片容器闭合 `</div>` 前插入：

```html
<!-- 紧密追问区 -->
{{compact_followups}}
```

空变量在 Mustache 渲染时输出为空字符串，不影响模板布局。

## 3. 编排层 — compact_followups 生成

### 3.1 数据结构

```javascript
// fill*Card 返回值新增 compact_followups 字段
{
  template_id: "route_card",
  answer_html: "<div>...</div>",
  compact_followups: [
    {
      label: "查天气风险",
      action_key: "travel_route.check_weather_risk",
      params: { city: "防城港" },
      style: "default",           // default | primary | danger
    },
    {
      label: "查其他城市天气",
      action_key: "travel_route.check_weather_risk",
      params: { city: "" },
      input: {
        type: "text",             // text | select | form
        placeholder: "输入城市名",
        param_key: "city",
      },
    },
  ],
}
```

### 3.2 HTML 渲染输出

编排层（interaction-composer）将 compact_followups 渲染为 HTML 胶囊标签：

```html
<div class="compact-followups">
  <button class="compact-chip" data-action-key="travel_route.check_weather_risk"
          data-params='{"city":"防城港"}'>查天气风险</button>
  <button class="compact-chip compact-chip--input"
          data-action-key="travel_route.check_weather_risk"
          data-input='{"type":"text","placeholder":"输入城市名","param_key":"city"}'>
    查其他城市天气
  </button>
</div>
```

### 3.3 各 fill*Card 函数迁移清单

| 函数 | 新增的 compact_followups |
|------|------------------------|
| fillRouteCard | 查天气风险 |
| fillTravelPlanSummaryCard | 立即预定、查看详情；删除旧 followUps 模板块 |
| fillTravelBaseCard | 订房、查看详情 |
| fillTravelTransportCard | 去12306购票 |
| fillNearbySpotCard 等 6 个 nearby | 收藏（导航/电话保留在模板） |
| fillNearbySummary | 朗读、看地图 |
| fillWeeklyPlan | 原 followup_suggestions 迁移 |
| fillDietCard | 原 onclick 选项迁移 |

### 3.4 互斥去重规则

compact_followups 与 followup_suggestions 同时出现时，遵循互斥原则：

**优先级**：compact_followups 全量保留，followup_suggestions 剔除重复项。

**三条互斥判定规则**：

| 规则 | 判定方式 | 示例 |
|------|----------|------|
| action_key 相同 | 精确匹配，直接剔除 | 卡片有 `travel_route.check_weather_risk`，消息追问中同一 key 剔除 |
| label 语义相近 | 归一化后词面重叠 ≥60% 剔除 | 卡片有"立即预定"，消息有"预定旅居" → 剔除消息那条 |
| 互逆动作 | 互补对列表匹配 | 卡片有"收藏"，消息有"取消收藏" → 保留卡片，消息剔除 |

实现位置：`interaction-composer.js` 的 `composeInteractions` 函数，新增 `dedupeFollowups(compactFollowups, messageFollowups)` 步骤。

### 3.5 与现有 followup_suggestions 的关系

| | compact_followups（新增） | followup_suggestions（现有） |
|--|------|------|
| 位置 | 卡片内部底部，绑定到模板 | 消息底部，跨卡片 |
| 条数限制 | 无 | 有（通常 3 条） |
| 生成方 | 各 fill*Card 函数按模板语义 | interaction-composer 统一生成 |
| 渲染形态 | 胶囊/标签 | 按钮 |
| 数据通道 | card.compact_followups → 模板占位符 | response.followup_suggestions |
| 互斥优先级 | 高（全量保留） | 低（被去重） |

两者并存：卡片紧密追问绑在卡片上，消息级追问在消息底部。

## 4. 前端层 — 胶囊渲染与表单交互

### 4.1 胶囊样式

```css
.compact-followups {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding: 10px 14px 6px;
}
.compact-chip {
  padding: 6px 14px; border-radius: 16px;
  font-size: 13px; border: 1px solid var(--primary-light);
  background: var(--bg-chip); color: var(--text-primary);
  cursor: pointer; transition: all 0.15s;
}
.compact-chip:hover { background: var(--primary-light); }
.compact-chip--primary { background: var(--primary); color: #fff; }
.compact-chip--input::after { content: " ▾"; font-size: 10px; opacity: 0.6; }
```

### 4.2 事件绑定

```javascript
function bindCompactFollowups(cardEl) {
  const chips = cardEl.querySelectorAll('.compact-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', handleCompactChipClick);
  });
}
```

### 4.3 三种输入类型交互

**type=text**：点击胶囊 → 原地展开输入框 + 确认按钮 → 输入值填入 params[param_key] → 发送 action

**type=select**：点击胶囊 → 展开下拉选项 → 选择后填入 params[param_key] → 发送 action

**type=form**：点击胶囊 → 展开多字段表单面板 → 填写后 params 合并所有字段 → 发送 action

### 4.4 点击事件处理

所有胶囊点击最终走 `/api/chat/action`，与现有 followup 按钮完全相同的后端处理路径：

```javascript
async function handleCompactChipClick(e) {
  const chip = e.currentTarget;
  const actionKey = chip.dataset.actionKey;
  const inputDef = chip.dataset.input ? JSON.parse(chip.dataset.input) : null;

  if (!inputDef) {
    // 无 input 定义 → 直接发送
    const params = chip.dataset.params ? JSON.parse(chip.dataset.params) : {};
    sendChatAction(actionKey, params);
    return;
  }

  // 有 input 定义 → 展开输入控件
  if (inputDef.type === 'text')   expandTextInput(chip, inputDef);
  if (inputDef.type === 'select') expandSelect(chip, inputDef);
  if (inputDef.type === 'form')   expandForm(chip, inputDef);
}
```

### 4.5 设计约束

| 约束 | 说明 |
|------|------|
| 场景锁定 | 所有 action 都带 skill_key（从 action_key 前缀提取），不重跑意图识别 |
| 一次展开 | 同一时刻只展开一个输入控件，展开新的自动收起旧的 |
| 空值保护 | 用户未输入直接点确认 → 使用 params 中的默认值，无默认值则提示 |
| 移动端适配 | 输入框宽度自适应，表单字段垂直堆叠 |

## 5. 文件影响清单

### 新增文件（1 个）

| 文件 | 职责 |
|------|------|
| src/core/compact-followups/renderer.js | compact_followups HTML 渲染 + dedupeFollowups 互斥去重 |

### 修改文件

| 文件 | 改动 |
|------|------|
| 14 个 HTML 模板（见 2.1） | 删除按钮/伪按钮/旧追问区 + 新增 `{{compact_followups}}` 占位符 |
| model-service.js | 各 fill*Card 函数新增 compact_followups 生成 |
| interaction-composer.js | composeInteractions 新增 dedupeFollowups 步骤 |
| mobile.js | bindCompactFollowups 事件绑定 + 三种输入类型展开逻辑 |
| mobile.css | compact-followups 胶囊样式 |

## 6. 测试策略

| 测试类型 | 覆盖内容 |
|----------|----------|
| 单元测试 | renderer.js：compact_followups 渲染为正确的 HTML；dedupeFollowups 三条互斥规则 |
| 集成测试 | fill*Card → compact_followups → 模板占位符替换 → 互斥去重完整链路 |
| 回归测试 | 全量 npm test 保持现有通过项不新增失败 |
