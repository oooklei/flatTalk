# 模板制作规范

> 供人工与大模型共同遵循。**目标**：新意图缺卡时，能派生出一张与现有卡片
> 视觉完全一致、语义正确、可被系统自动发现的模板。

## 0. 为什么必须有这份规范

`intent_id ↔ template_id` 是**强制 1:1**：

- LIS `IntentKB` 下发 `template_id`，flatTalk 直接据此渲染，不再做二次映射
- 一张模板被多个意图共用 = 语义错配。实测案例：`diet_card` 的 manifest 写明
  "一日三餐完整膳食"，被 `meal_plan_breakfast_advice` 共用后，用户问"早餐吃什么"
  却收到全天卡片
- `admin PUT /admin/intents` 会在检测到共用时返回 **409 template_already_bound**

所以缺卡时**不能挑一张相近的凑用**，必须派生新模板。

## 1. 落盘位置（强制单层）

```
src/skills/<skill_key>/templates/html/<template_id>.html
src/skills/<skill_key>/templates/html/<template_id>.manifest.json
src/skills/<skill_key>/templates/html/<template_id>.sample.json      # 可选
src/skills/<skill_key>/templates/followups/<template_id>.json        # 可选
```

**不允许在 `html/` 下再建子目录。**

历史上 `common/templates/html/common/` 多套了一层，能工作只因 admin 的扫描是
递归的、而渲染方靠硬编码路径 —— 两处一旦不同步就会出现"admin 能看到、
渲染找不到"的断链。该层已扁平化。

由 `scripts/check-template-layout.mjs` 守卫（违规则退出码 1）。

## 2. 派生流程（推荐做法）

**不要从零手写**。从同技能里语义最接近的模板派生，这样样式令牌天然一致：

1. 选源模板（如做「早餐推荐」就选 `diet_card`）
2. 复制 `.html` 与 `.manifest.json`，改名为新 `template_id`
3. **只改三处**：
   - `<title>` 与卡片主标题
   - manifest 的 `id` / `name` / `description` / `match` / `intent_id`
   - 内联 `application/json` 示例数据（收敛到该意图的语义范围）
4. **一个字节都不要改**：CSS 变量、圆角、阴影、字体、间距

`scripts/split-shared-templates.mjs` 已把这套流程自动化，新增条目登记在 `PLAN`
数组里即可。

> 已知易漏点：早期版本只改了 `description`/`match` 而**漏改 `name`**，
> 导致 14 个新模板顶着源模板名（`route_compare_card` 的 name 一度是
> "旅居路线SVG示意图"）。`name` 是 admin 列表与模板选择器的展示字段，必须改。

## 3. 样式令牌（必须继承，不得新造）

以 `diet_breakfast_card.html`（派生自 `diet_card`）为例，实际使用 11 个变量：

```css
--bg-page: #FAF8F5;        /* 页面底色 */
--meal-bg: #FDF6F0;        /* 区块底色 */
--card-bg: #FFFFFF;        /* 卡片白 */
--accent-orange: #E8843C;  /* 强调色（各技能不同，沿用源模板即可）*/
--text-primary: #3D3A36;   /* 主文本 */
--text-secondary: #666666; /* 次文本 */
--text-light: #8A8278;     /* 弱文本 */
--border-dot: #E8D9C8;     /* 虚线/点状分隔 */
--border-card: #EFEFEF;    /* 卡片描边 */
--radius-lg: 16px;         /* 大圆角 */
--radius-md: 12px;         /* 中圆角 */
```

**规则**：派生时逐字保留。要新颜色，先问是否真需要 —— 统一感来自复用而非新造。

## 4. HTML 结构约定

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>早餐推荐</title>
  <style>
    :root { --bg-page: #FAF8F5; /* ...继承源模板全部令牌... */ }
    /* 样式必须内联在 <style> 中：discover.js 会抽取并内联化 */
  </style>
</head>
<body>
  <!-- 占位符用 {{fieldName}}，字段名与 manifest.required/optional_fields 对应 -->
  <div class="card">
    <h1>{{mealTitle}}</h1>
    <p>{{summary}}</p>
  </div>

  <!-- 示例数据：渲染缺字段时作为缺省值，也是 admin 预览的数据源 -->
  <script type="application/json">
    { "mealTitle": "今日早餐 · 单餐推荐", "summary": "清淡易消化" }
  </script>
</body>
</html>
```

要点：

- 样式**内联**，不引外部 css（`discover.js` 的 `collectCss` 会内联化）
- 占位符统一 `{{field}}`
- 内联 `application/json` 是**示例数据**，不是配置
- 含活地图/外部脚本时需 `needsIframe`，否则 `template-iframe-all-templates.test.js`
  会报 "needsIframe=false but raw has live map signals"

## 5. manifest 规范（缺失会直接报错）

```json
{
  "id": "diet_breakfast_card",
  "name": "早餐推荐",
  "description": "早餐单餐推荐卡：主食/蛋白/果蔬搭配与热量估算",
  "product_domain": "meal_plan",
  "intent_id": "meal_plan_breakfast_advice",
  "required": ["mealTitle", "items"],
  "optional_fields": ["summary", "calories", "healthNotice"],
  "slot_hints": { "mealTitle": "早餐标题，如：今日早餐 · 单餐推荐" },
  "match": "展示单顿早餐推荐的卡片，非一日三餐完整膳食",
  "derived_from": "diet_card",
  "render_priority": 1,
  "version": "1.0"
}
```

字段要求：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 必须与文件名一致，否则注册名与磁盘名不符 |
| `name` | ✅ | admin 列表展示名，必须反映本意图语义 |
| `intent_id` | ✅ | 绑定意图；缺失则不会被 LIS 路由命中 |
| `required` | ✅ | 缺字段时触发追问/降级 |
| `match` | ✅ | 写清"是什么"**和"不是什么"**，防再被共用 |
| `derived_from` | 建议 | 记录派生来源，便于样式追溯 |

### 5.1 match 唯一性稽核（新增模板必须通过）

`match` 是**唯一**进入大模型选模板 prompt 的语义依据（`template-card/prompt.js` →
`buildSelectPrompt`）。两个模板的 `match` 语义重叠时，LLM 选型必然抖动，
且这种抖动不会报错、只会让用户收到错误卡片。

实测反例：`nearby_recommend` 的 match 含裸词"推荐"，
用户问"单个服务推荐项"被判成周边助手 —— 因为 find_service 侧当时没有
更强的"服务推荐"特征词与之竞争。

**强制规则：**

1. **必须以唯一前缀开头**，格式 `【N字标签】`，全库不得重复。
   前缀是给 LLM 的显式特征锚点，也是机械稽核的判定依据。

   ```json
   "match": "【早餐单餐】仅展示早餐单餐推荐的竖向单卡，不含午晚餐"
   ```

2. **必须写"不是什么"**，显式排除最容易混淆的同族模板。
   同族模板越多，排除项越要写全。

   ```json
   "match": "【滨海线路】以海洋文化与海滩休闲为主题的旅居线路图（沙滩/海岛/海鲜/边境口岸），非康养疗养线路、非生态山水线路、非民族文化线路"
   ```

3. **禁止使用裸泛化词作为唯一特征**。
   "推荐""查询""详情""列表""状态"这类词在多个 skill 下都成立，
   必须叠加域限定词（`服务推荐` / `周边推荐` / `线路推荐`）。

4. **不得省略 `match` 字段**。缺失时 `discover.js` 会 fallback 到
   `description`，而 `description` 面向人类阅读、通常不含排除语义，
   LLM 拿不到区分依据。

**豁免情形：** `match` 为对象格式
（`{ "intent": ..., "scene": ..., "min_score": ... }`）时走确定性路由，
不参与 LLM 语义选型，无需前缀。

**稽核命令：**

```bash
npm run check:match          # 等价于 node scripts/verify-manifest-match.js
```

硬性违规（`violations`，阻塞）：JSON 损坏、缺 `match`、无前缀、前缀重复。
建议项（`warnings`，不阻塞）：前缀是裸泛化词、未写"不是什么"。

输出 `PASS` 且退出码 0 才算通过。已接入 `npm run check:pipeline`。

**manifest 缺失或 JSON 损坏会抛错**（`discover.js` 严格模式）。
静默返回 `{}` 会让模板以裸文件名注册、`required` 为空，问题被推迟到用户面前。
临时排查可设 `TEMPLATE_MANIFEST_STRICT=0`。

`templates/preview/` 与 `*.preview.html` 是渲染产物，不参与检查。

## 6. 登记到意图（两侧同源）

```bash
# 1. 写入 catalog（flatTalk 侧执行入口）
node scripts/generate-intent-registry.mjs

# 2. 同步到 LIS IntentKB（意图识别与 template_id 下发源）
cd ../LIS-System
python scripts/import_intent_seed.py ../flatTalk/build/intent_kb.seed.json
```

> `import_intent_seed.py` 早期写成 `old.template_id or template_id`，
> 导致旧值永不被覆盖 —— 拆分共用模板后 LIS 与 catalog 静默分叉
> （`elder_policy_benefit` 一度 LIS 还是 `policy_list_card`）。
> 现已改为 catalog 优先。

## 7. 验收（全部必须通过）

```bash
node scripts/check-template-layout.mjs      # 目录规范 + manifest + 1:1
node scripts/verify-manifest-match.js       # match 前缀唯一性（见 5.1）
node scripts/audit-intent-pipeline.mjs      # 意图→模板全链路
cd ../LIS-System && python scripts/check_catalog_sync.py   # 两侧零漂移
```

四者退出码均为 0 才算完成。

## 8. 给大模型的生成指令模板

```
为意图 <intent_id>（语义：<一句话>）派生模板。

源模板：src/skills/<skill>/templates/html/<source>.html
新模板：src/skills/<skill>/templates/html/<new_id>.html

硬性要求：
1. 完整复制源模板的 <style>，CSS 变量/圆角/阴影/字体逐字保留，不新增颜色
2. 只改：<title>、卡片主标题、内联 application/json 示例数据
3. 同步产出 <new_id>.manifest.json，其中
   id=<new_id>，name=<该意图的中文短名>，intent_id=<intent_id>，
   derived_from=<source>，match 必须以全库唯一的【N字标签】前缀开头，
   并写明"不是什么"（规则见规范 5.1）
4. 占位符用 {{field}}，与 manifest.required / optional_fields 一致
5. 不引外部 css/js；若含活地图需标记 needsIframe

产出后运行 scripts/check-template-layout.mjs 与
scripts/verify-manifest-match.js，两者均须 0 违规。
```

## 9. 常见错误

| 错误 | 后果 |
|---|---|
| `manifest.id` 与文件名不一致 | 注册名错乱，admin 显示错误模板 |
| 缺 `intent_id` | 不会被 LIS 路由命中，模板等于不存在 |
| 缺 `match` | LLM 只能读 `description`，选型无区分依据 |
| `match` 无唯一前缀 | 同族模板语义重叠，LLM 选型抖动且不报错 |
| `match` 只写"是什么"不写"不是什么" | 相邻模板互相抢命中 |
| `match` 用裸泛化词（推荐/查询/详情） | 跨 skill 误命中，如"推荐"把服务问题带到周边助手 |
| 只改 HTML 不改 manifest | LIS 仍按旧 `template_id` 下发 |
| 直接改 `intent-template-map.json` | 与 catalog 分叉 |
