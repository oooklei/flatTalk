# 外部接口接入与本地知识库入库方案（方案B）

> 目标：所有外部接口数据在「运行时获取后，除供模型/卡片使用外，同时写入对应技能的本地知识库」，按 `provider + id` 幂等去重。

## 1. 统一基础设施

| 文件 | 作用 |
|------|------|
| `src/services/interface-base.js` | `BaseInterfaceService` 基类，提供 `capture(records)`（按 `id` 幂等写入） |
| `src/services/interface-knowledge-capture.js` | `captureToLocalKnowledge({skillKey, provider, sourcePath, records})`，落盘到 `src/skills/<skillKey>/knowledge/interface_cache/<provider>_index.json` |

落盘规则：每条 `record` 必须含 `id`；重复 `id` 覆盖更新（不无限增长）；写入 `data`、`_captured_at`、`_source`、`_provider` 等字段。

## 2. 业务接口（继承 `BaseInterfaceService`，取数即入库）

| 接口 | 服务文件 | skillKey | provider | 入库存入口 |
|------|----------|----------|----------|------------|
| 云诊365 | `src/services/yz365/yz365-service.js` | `health_risk_warning` | `yunzhen365` | `getElderHealthCheck` 取数后 `capture` |
| 云诊舌诊 | `src/services/shezhen/shezhen-service.js` | `health_risk_warning` | `yunzhen-shezhen` | `getElderReports` 取数后 `capture` |
| 金跳动旅居 | `src/services/travel/jtd-service.js` | `travel_route` | `jintiaodong` | `buildRouteProductContext` 取得真实数据（`source_status==='real_data'`）后 `capture` |
| 桂小养订单 | `src/services/order/order-service.js` | `find_service` | `guangxi_order` | `getOrderPage/getOrderDetail/getOrderTimeline` 等取数后 `capture` |
| 桂小养工单 | `src/services/workorder/workorder-service.js` | `dispatch_manage` | `guangxi_workorder` | `getWorkorderPage/getWorkorderDetail/getWorkorderTimeline` 等取数后 `capture` |

> `order` 的 `getOrderTimeline` 同时覆盖工单（workorder）与消息（message），统一入库。

## 3. 公共服务（运行时真实取数，复用 `captureToLocalKnowledge` 入库）

| 接口 | 取数点 | skillKey | provider | 入库内容 |
|------|--------|----------|----------|----------|
| 腾讯天气 | `src/services/weather/tencent-weather.js` `getWeather` | `travel_route` | `tencent_weather` | 按 `城市+日期` 幂等写入当日天气 |
| 腾讯地图 POI | `src/services/nearby-resource/nearby-augmentor.js` `enrich` | `nearby_resource` | `nearby_external` | `_source==='tencent'` 的补充 POI（type=`tencent_poi`） |
| Tavily 富化 | 同上 `enrich` | `nearby_resource` | `nearby_external` | 被 Tavily 富化的本地设施（type=`tavily_enriched`） |

> 公共服务不继承基类（保持原有工厂函数 API 不变），直接调用统一的 `captureToLocalKnowledge` 工具，效果与方案B一致。

## 4. 运行时接入点（`src/core/orchestrator/chat-orchestrator.js` → `loadBusinessData`）

- `travel_route` → `dataService.travelData.jtd.buildRouteProductContext`（已入库）
- `health_risk_warning` → `dataService.remoteHealth.buildRiskRemoteContext`（yz365+shezhen，已入库）
- `find_service` → 新增：`createOrderService()` 远程取数（详情/分页），合入 `businessData.orders` 并入库（容错，失败不阻塞）
- `dispatch_manage` → 新增：`createWorkorderService()` 远程取数，合入 `businessData.workorders` 并入库（容错）
- `nearby_resource` → `nearbyEnrich`（腾讯地图 + Tavily，已入库）

## 5. 本轮修复

- `src/third/order/gxy-order-sdk.js`、`src/third/workorder/gxy-workorder-sdk.js` 的签名工具引用路径由 `./lib/hmac-signature.js` 修正为 `../lib/hmac-signature.js`（实际位于 `src/third/lib/`），使 SDK 可正常加载。

## 6. 云诊舌诊真实联调结论

- 接口、HMAC 签名、`fetchRecords` 解析路径（响应 `data.result.records`）均验证正确（真实请求返回 `ok=true, status=200`）。
- 当前 `.env` 的 `SHEZHEN_USER_ID=user001` 在云诊平台**无舌诊报告数据**（`records.length=0`），属账号无数据，非代码问题。
- 依据 `云诊/shezhen/README.md` 的真实 `YunzhenCheckReport` 字段，已校准 `analyzeReport`：
  - 主键 `id`、检测人 `name`/`userName`、性别 `sex`(1/2→男/女)、时间 `checkTime`、体质 `constitutionNames`；
  - 风险在 `diseaseRisksJson`（JSON 字符串，需 `JSON.parse`），项结构 `{diseaseName, riskIndex, riskLevel}`；
  - 等级映射支持「低/中/高风险」及 `riskIndex` 数值（≥60 紧急、≥30 关注）。
- 注入模拟真实报告验证：解析、风险等级、自动入库全链路通过。提供有数据的真实 `userId` 即可即取即用。

## 7. 后续建议

- 用有舌诊数据的真实 `userId` 运行 `getElderReports`，确认端到端落库与卡片渲染。
- `order`/`workorder` 仅在 `find_service`/`dispatch_manage` 场景触发远程取数；如需更细粒度（按 `orderId`/`workOrderId`），可在动作参数中透传并在 `loadBusinessData` 中优先走详情接口（已实现该分支）。
- admin 知识库增加「接口缓存」查看/稽核入口。
- 天气/nearby 入库为同步写文件，低频场景可接受；如高频可改为带内存缓冲的批量写。
