# 飞猪 FlyAI 本地知识库接入 + 地图序 SSE 设计

> 日期：2026-08-06  
> 状态：已批准（用户继续推进）  
> 方案：knowledge-data 接入（方案 2）  
> 参考：[飞猪 AI 开放平台 Quick Start](https://flyai.open.fliggy.com/#quick-start)  
> 探测：`scripts/test-output/flyai-probe/VERIFY_REPORT_WITH_KEY.md`

## 一、目标

把飞猪 **FlyAI** 的自然语言旅行检索能力接入 flatTalk，形成「本地知识库优先、低召回再现场补拉、夜间重刷」的闭环；卡片内地图**不嵌入**飞猪运行时地图资源，改为自建飞猪风格 SVG；同时按地图/行程**点序**通过 **SSE 结构化流式输出**，体验对齐 FlyAI：「我想去巴马旅游」→ 结构化行程/商品结果。

### 成功标准

1. 先对 **19 条线路**完成 FlyAI（或等价检索）全量拉取并入库，形成可检索本地知识。
2. 用户对话默认**只读本地 KB**；未命中或综合分过低时再 live 调用 FlyAI，结果 upsert 为新知识。
3. 每晚 **0:00** 按已有条目的 `fliggyId`（或稳定外部 ID）+ `keywords` 重刷，保持鲜活。
4. 卡片地图始终自建 SVG；SSE 事件顺序与 SVG waypoint 顺序一致。
5. 凭证仅环境变量，不进 git。

### 非目标（本期不做）

- 在卡片内嵌入飞猪/千问运行时地图 SDK 或对方地图瓦片。
- 以 `api.fliggy.net/vacation` 账密登录作为默认上游（仅允许作备选探测，不进主路径）。
- 推广佣金/下单闭环（可后续按 FlyAI Partner 再开 spec）。

## 二、背景与约束

| 项 | 说明 |
|----|------|
| 上游主路径 | [FlyAI 开放平台](https://flyai.open.fliggy.com/)：`FLYAI_API_KEY` + 自然语言查询（如 `fliggy-fast-search` 类能力） |
| 现有资产 | `data/sojourn-maps/` 19 包、`src/services/knowledge-data/`、路线卡 SVG / mapstudio |
| 合规 | 遵守 FlyAI ToS；`raw` 仅内网审计；对外卡片只用规范化字段 |
| 降级 | FlyAI 不可用 → 静默用 sojourn-maps / JTD，不阻断对话 |

## 三、架构

### 3.1 数据流

```
Bootstrap（19 seed）
  → FlyAI adapter（自然语言 / ID+关键词查询）
  → 规范化 Document + Chunk（+ raw 快照）
  → knowledge-data（关键词 + 向量）

用户：「我想去巴马旅游」
  → 本地检索（精确 ID / 向量+关键词）
      ├ 命中且分数 ≥ 阈值 → 规范化视图
      └ 未命中 / 低分 → live FlyAI → upsert → 规范化视图
  → 填路线卡（文案来自 KB）+ 自建 SVG（点序同源）
  → SSE 按 waypoint 顺序推送结构化事件

Cron 0:00
  → 遍历 KB 已有条目（fliggyId + keywords）→ 重拉 → content_hash 变化则更新
```

### 3.2 组件职责

| 组件 | 职责 |
|------|------|
| `flyai-adapter`（新建） | 封装 FlyAI CLI/HTTP；输入 query/keywords；输出原始 JSON + 规范化字段 |
| `fliggy-knowledge-sync`（脚本/任务） | bootstrap、0 点重刷、对话触发的 upsert |
| `knowledge-data` | 存储、检索、阈值判定 |
| `travel_route` 填卡路径 | 消费规范化视图；地图走现有 SVG 管线 |
| SSE composer | 按 `waypoints[]` 顺序发事件；与 SVG 同源列表 |

## 四、知识模型

### 4.1 主文档（每条线路一条）

- `skill_key`: `travel_route`
- `source`: `flyai`
- `fliggyId` / `external_id`: 稳定外部主键（无则用 content_hash 派生）
- `keywords[]`: 目的地、产品名、别名（如「巴马」「盘阳河」）
- `title`, `highlights[]`, `itinerary[]`（含日序与景点序）
- `product`: 标题、卖点、价格区间、预订相关链接（若有）
- `waypoints[]`: **有序**；与自建 SVG 标点一一对应（name、day、lat/lng 可空、order）
- `linked_route_id`: 对齐 `data/sojourn-maps/{id}`
- `raw_path`: 原始响应快照路径
- `updated_at`, `content_hash`

### 4.2 命中规则（可配置初值）

1. `linked_route_id` / `fliggyId` **精确命中** → 直接用本地。
2. 向量 + 关键词综合分 ≥ **0.72** → 用本地。
3. &lt; 0.72 或无结果 → live FlyAI；成功则 upsert 再填卡 / 再 SSE。
4. live 失败 → 降级 sojourn-maps / JTD。

阈值键名建议：`FLYAI_KB_HIT_THRESHOLD`（默认 `0.72`）。

## 五、同步策略

### 5.1 Bootstrap

- Seed 表：现有 19 条线路的 `route_id` + 目的地/产品关键词（必要时附示例自然语言，如「我想去巴马旅游」）。
- 对每条执行 FlyAI 检索 → 规范化 → 写入 KB + raw 快照 →（可选）触发/校验自建 SVG 与 `waypoints` 对齐。

### 5.2 对话补拉

- 仅当本地未命中或分数 &lt; 阈值时触发。
- 成功写回的条目自动进入次日 0 点重刷集合。

### 5.3 夜间重刷（0:00）

- 只处理 KB **已有**条目。
- 按 `fliggyId` + `keywords`（或归档的 seed query）重拉。
- `content_hash` 不变则跳过写库；变化则更新 chunk/向量。

## 六、SSE 结构化输出（地图点序）

### 6.1 原则

- **不**推送飞猪地图二进制/SDK。
- 事件顺序 = `waypoints[]` 顺序 = 自建 SVG 标点顺序。
- 客户端可边收边高亮对应标点。

### 6.2 事件类型（初版）

| event | 含义 | 主要 payload |
|-------|------|----------------|
| `route_meta` | 线路头信息 | title, linked_route_id, source |
| `product_meta` | 商品摘要 | 卖点、价格区间、外链（若有） |
| `map_point` | 按点序一条 | order, name, day, lat?, lng?, highlight? |
| `itinerary_day` | 按日汇总 | day, summary, point_orders[] |
| `done` | 结束 | counts, from_cache \| live |

**默认推送顺序**：`route_meta` → `product_meta` → 按日循环（该日所有 `map_point` → 该日 `itinerary_day`）→ `done`。  
实现时与现有 chat SSE/envelope 约定对齐；若需新 event name，在实现计划中列兼容表。

## 七、地图

- 卡片内展示：现有 / 增强的**自建飞猪风格 SVG**（行政区划、点序、连线）。
- 视觉可参考飞猪千问示意风格，但渲染与数据主权在 flatTalk。
- FlyAI 若偶发返回地图图 URL：只作运营参考或离线风格调研，**不**作为运行时嵌入源。

## 八、凭证与安全

| 变量 | 用途 |
|------|------|
| `FLYAI_API_KEY` | FlyAI 正式调用（主） |
| `FLYAI_KB_HIT_THRESHOLD` | 可选，默认 0.72 |
| （备选）`FLIGGY_VACATION_*` | 仅探测旧 vacation 入口时使用，默认关闭 |

禁止：把账号口令、API Key 写入仓库、设计附件或客户端打包。

## 九、风险与缓解

| 风险 | 缓解 |
|------|------|
| FlyAI 返回结构不稳定 / 无稳定 ID | 规范化层容错；无 ID 时用 hash；保留 raw |
| 「示意地图」不在 API 内 | 已设计为自建 SVG + SSE 点序，不阻塞主路径 |
| 低分误触发 live 过多 | 可调阈值；对 19 条 seed 强制精确/关键词优先 |
| ToS / 配额 | 夜间+对话限流；监控失败率；官方 Key |

## 十、实现分期（概要，详细计划另开 writing-plans）

1. **探测**：用官方 Key 对「我想去巴马旅游」打通 FlyAI，固化响应 schema 样例（不入库密钥）。
2. **Adapter + 规范化 + bootstrap 19 条**。
3. **检索阈值接入 travel 填卡路径**。
4. **SSE 点序事件**与前端高亮对齐。
5. **0 点 cron** 与监控。

## 十一、已拍板决策摘要

- 目标产物：地图体验（自建）+ 结构化行程 + 商品信息（FlyAI）。
- 缺飞猪地图图：自建飞猪风格 SVG。
- 同步：本地 KB 优先 + 低召回 live + 0 点重刷。
- 架构：knowledge-data 方案 2。
- 上游：FlyAI 开放平台，体验对齐 quick-start。
- SSE：按地图点序结构化输出；不嵌入飞猪运行时地图。

## 十二、探测结论（2026-08-06）

| 结论 | 细节 |
|------|------|
| `FLYAI_API_KEY` 有效 | `ai-search` 从 504 变为成功（~32s） |
| `ai-search` 形态 | `data` 为 **Markdown 字符串**（非 `itemList`）；需解析景点名后再对齐 POI |
| `keyword-search` | `data.itemList[].info` 商品/酒店摘要；`price` 常 null |
| `search-poi` | 含 `id/name/lat/lng/address/description/ticketInfo`，可作 `waypoints[]` |
| `api.fliggy.net/vacation` | 商家开放平台**文档站**，账密脚本登录失败；**不进主路径** |
| 规范化策略 | `ai-search`（文案）+ `search-poi`（坐标点序）+ `keyword-search`（商品）拼成一条 KB 文档 |
