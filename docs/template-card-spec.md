# 模板卡片渲染包 · 规范与调用指南

> 用途：给定「一个存放 HTML 原型的目录」+「大模型返回的一段 JSON」，从中选出最匹配的 HTML 原型，把 JSON 数据置换进去，输出**格式/样式完全不变**的卡片 HTML（支持横向/纵向布局、数组重复渲染、分页）。

---

## 1. 定位与范围

- **输入**：① 模板目录（一堆 `.html` 原型，可能自带示例数据）；② 一段 JSON（大模型产出）。
- **输出**：若干份完整 HTML 文档（`pages: string[]`），每份都是「内联样式 + 数据置换后的卡片」。
- **核心保证**：渲染过程只替换 `{{占位符}}` 文本，**不生成任何 DOM 结构、不改动任何 CSS**，因此原型样式像素级不变。
- **选型**：三层机制（模型指定 id → 字段覆盖率兜底 → 通用默认模板），无需手写规则即可把 JSON 路由到正确原型。

代码位置：`src/template-card/`
- `render.js`：轻量 Mustache 子集渲染器（无依赖）
- `discover.js`：扫描目录、抽取样式/主体/默认数据、识别布局
- `select.js`：三层选型
- `index.js`：对外 API `renderCard`

---

## 2. 原型编写规范（必须遵循）

为了让「保样式 + 数据置换」成立，原型需满足：

1. **样式与结构分离**：所有 CSS 放在 `<style>` 或外链 `<link rel="stylesheet" href="x.css">` 中；卡片结构写在 HTML 里。
2. **数据用占位符**：动态内容一律写成 `{{字段名}}`。例如：
   ```html
   <h3>{{title}}</h3>
   {{#metrics}}<div class="metric"><span>{{label}}</span><b>{{value}}</b></div>{{/metrics}}
   ```
3. **可选：自带示例数据**（作为字段缺省值）。放在 `<script type="application/json">` 里，**渲染时会被真实数据覆盖**；当真实数据缺字段时回退到示例值，避免空白：
   ```html
   <script type="application/json">
   { "title": "示例标题", "metrics": [{"label":"心率","value":"72 bpm"}] }
   </script>
   ```
4. **可选：声明布局 / 必填字段**（同名 `.manifest.json`）：
   ```json
   {
     "id": "health_card",
     "layout": "vertical",
     "match": "展示健康监测指标（心率/血压/睡眠）的竖向卡片",
     "required": ["title", "metrics"]
   }
   ```
   - `layout`：`horizontal` | `vertical`，覆盖自动识别。
   - `required`：用于兜底打分（JSON 需覆盖这些字段才被认为匹配）。
   - `match`：适用场景描述，会进入 `library` 回传给大模型。

### 占位符语法（支持的子集）
| 写法 | 含义 |
|------|------|
| `{{a}}` | 转义输出（防 XSS） |
| `{{{a}}}` 或 `{{&a}}` | 原文输出（不转义） |
| `{{#s}}...{{/s}}` | 区间：数组→逐项迭代；对象/真值→进入；假/空→跳过 |
| `{{^s}}...{{/s}}` | 反区间：空/假/空数组/空对象时渲染 |
| `{{! 注释 }}` | 注释，不输出 |
| `{{a.b}}` / `{{.}}` | 点路径；`.` 表示当前项 |

> 不支持：局部模板(`{{>partial}}`)、lambda 复杂用法。保持简单即可覆盖绝大多数卡片。

---

## 3. 输入契约（JSON 结构）

`renderCard(dir, json, options)` 接受的 `json` 允许以下形态（自动归一化）：

```js
// A. 模型指定模板 + 单卡数据（推荐）
{ "template_id": "health_card", "data": { "title": "...", "metrics": [...] } }

// B. 数组数据（自动重复）
{ "items": [ {..}, {..}, {..} ] }

// C. 模型指定 + 数组
{ "template_id": "route_card", "items": [ {..}, {..} ] }

// D. 纯对象（渲染一次，未指定模板则走兜底选型）
{ "title": "...", "metrics": [...] }
```

字段说明：
- `template_id` / `template_key`：模型选中的原型 id（第一优先）。
- `data`：单卡数据；若本身是数组则视为 `items`。
- `items`：记录数组，逐条渲染。
- 数组也可放在 `data.<repeatKey>`（默认 `repeatKey="items"`），例如 `data.cards`。

`options`：
| 参数 | 默认 | 说明 |
|------|------|------|
| `pageLimit` | `0` | `>0` 时分页，每页最多 N 张卡片 |
| `repeatKey` | `"items"` | 数组数据所在字段名（当未用 `items` 包装时） |
| `fallbackTemplateId` | `null` | 强制兜底模板 id |

---

## 4. 输出契约

`renderCard` 返回对象：
```js
{
  templateId: "health_card",   // 实际选中的原型 id
  layout: "vertical",          // 布局方向
  reason: "model-id",          // 选型依据：model-id | field-coverage | low-coverage-fallback | no-match-fallback
  score: 1,                    // 匹配度 0~1
  cardCount: 3,                // 渲染卡片数
  pageCount: 1,                // 页数
  pages: [ "<!doctype html>...", ... ], // 每页一份完整 HTML 文档
  library: [ { id, layout, match }, ... ] // 模板清单，可回传给大模型
}
```
- 单页时 `pages` 长度 1；分页时按 `pageLimit` 切片，每页带「第 x / y 页」。
- `pages[i]` 已内联全部样式，直接用浏览器打开或嵌入 iframe 即可，**无需再引用任何外部资源**。

---

## 5. 选型规则（三层，确定性）

1. **第一层 · 模型指定 `template_id`**
   若 JSON 带了 `template_id` 且在目录中存在 → 直接采用，`reason="model-id"`。
   *（这是最准的方式：让大模型在返回数据时一并返回它选中的模板 id，把语义判断交给模型。）*

2. **第二层 · 字段覆盖率兜底**
   当没有 id 或 id 不存在时：
   - 收集数据出现的字段集合 `dataKeys`（顶层 + 首个数组元素的键）。
   - 对每个模板，取 `required`（无则取模板引用的所有变量名首段）作为要求字段。
   - `score = 命中的要求字段数 / 要求字段总数`。
   - 选 `score` 最高者；`score ≥ 0.5` 才接受，`reason="field-coverage"`。

3. **第三层 · 通用默认模板**
   上述都未命中（或覆盖率过低）时：优先选名为 `default` / `markdown` / `generic` 的原型；否则选**引用变量最少**的原型（最通用），`reason` 含 `fallback`。保证永远有输出、不崩溃。

> 调优建议：把 `library`（含 `id`、`match`）写进大模型的 system prompt，让模型直接回传 `template_id`，可把选型准确率拉到最高，并规避兜底误差。

---

## 6. 布局 / 重复渲染 / 分页 规则

- **布局识别**：原型里的 `data-layout="horizontal"` → 横向；class 含 `horizontal/h-scroll/row` 或样式含 `flex-direction:row` → 横向；否则竖向。manifest 的 `layout` 可强制覆盖。
- **重复渲染**：数组数据（`items`）逐条渲染为独立卡片，外层用 `.tc-deck` 容器按布局排成一行（横向）或一列（竖向）。每条记录上下文 = `{ ...原型自带示例数据, ...真实记录 }`，因此缺字段自动回退示例值。
- **分页**：`pageLimit > 0` 且卡片数超过限制时，按 `pageLimit` 切片，每页独立完整文档 + 页码。

---

## 7. 调用示例

```js
import { renderCard } from './src/template-card/index.js';

// 场景1：模型指定模板 + 单卡
const r1 = renderCard('./cards', {
  template_id: 'health_card',
  data: { title: '王女士今日健康',
          metrics: [{label:'心率',value:'68 bpm'},{label:'血压',value:'112/74'}],
          foot: '数据更新于 09:30' }
});

// 场景2：数组 → 纵向重复
const r2 = renderCard('./cards', { items: [ {title:'周一',metrics:[{label:'步数',value:'8200'}]}, ... ] });

// 场景3：横向 + 分页（每页2张）
const r3 = renderCard('./cards',
  { template_id: 'route_card', items: [ /* 5 条路线 */ ] },
  { pageLimit: 2 });   // → r3.pages.length === 3

console.log(r1.pages[0]); // 完整 HTML 字符串
```

配合大模型（闭环）：
```js
const { library } = renderCard('./cards', {}); // 取模板清单
// 把 library 注入 system prompt，要求模型返回 { template_id, data/items }
// 模型返回 json → 再次 renderCard('./cards', json) 即得卡片
```

---

## 8. 验证方法（调用验证）

### 8.1 自动测试
```bash
node --test tests/template-card.test.js
```
覆盖断言：模型指定模板命中、数组重复、横向+分页、无 id 时兜底命中、样式不因数据变化而丢失。

### 8.2 演示生成
```bash
node examples/demo.mjs
```
生成 `examples/output/*.html`，直接用浏览器打开核对布局与样式。

### 8.3 验收清单（每次接入新原型/新数据必查）
| # | 检查项 | 期望 |
|---|--------|------|
| 1 | 样式完整性 | 产物 `<style>` 内含原型全部 CSS（含 `box-shadow`/渐变等特征样式） |
| 2 | 结构不变 | 产物 DOM 结构与原型一致，仅文本被替换 |
| 3 | 无脚本泄漏 | 产物不含原型自带的 `<script type="application/json">` |
| 4 | 选型正确 | `reason`/`templateId` 符合预期（指定 id 应 `model-id`） |
| 5 | 布局正确 | 横向数据 `data-layout="horizontal"` 且卡片并排；竖向则纵向堆叠 |
| 6 | 数组重复 | `cardCount` 等于记录数；每卡数据正确 |
| 7 | 分页正确 | `pageLimit` 下 `pageCount = ceil(n/limit)`，且带页码 |
| 8 | 缺字段回退 | 真实数据缺字段时，显示原型示例值而非空白 |
| 9 | 兜底不崩 | 随意 JSON 必返回至少 1 页有效 HTML |

---

## 9. 边界与限制

- 原型必须是「静态结构 + `{{占位符}}`」；若原型把数据结构写死在 HTML 里未用占位符，则无法被数据驱动（需先改造原型）。
- 渲染器为 Mustache 子集，**不支持** 局部模板、复杂 lambda、HTML 注释外逻辑。
- 横向模板若自身就是「多子项容器」（如 `.deck` 内含多个 `.stop`），当前按「整模板=一张卡」重复；如需「单容器多子项」效果，请在原型内用 `{{#items}}` 区间迭代。
- 外部 CSS 通过相对路径内联；找不到的文件会在 `<style>` 留注释，不会报错中断。
- 数据全部经 HTML 转义（`{{{ }}}` 除外），默认防 XSS。
