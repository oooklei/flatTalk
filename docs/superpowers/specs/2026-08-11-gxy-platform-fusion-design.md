# AI对接包-v3 → flatTalk 融合设计

> 日期：2026-08-11
> 状态：待批准
> 范围：将 `d:\GuiCare\AI对接包-v3` 的全部 5 个模块（elder / service-item / order / workorder / feedback）移植到 flatTalk，替换 find_service 和 dispatch_manage 的硬编码种子数据为真实平台 API。

---

## 1. 背景与目标

### 1.1 现状

flatTalk 的 find_service 和 dispatch_manage 两个 skill 使用 `repository.js` 中的硬编码种子数据：
- 22 条服务项目（`fs_service_catalog`）
- 13 个护工（`fs_worker`）
- 4 条派单（`dm_dispatch_order`）
- 若干订单（`fs_service_order`）

写操作（`placeOrder` / `syncOrder`）是死代码——零调用点。

AI对接包-v3 是一个独立的 FastAPI 网关，已验证可连通桂小养平台，返回真实数据：
- 33 条老人档案（本机 PG）
- 5 个服务项目（平台 API）
- 234 条订单（平台 API）
- 9974 条工单（平台 API）

### 1.2 目标

将包的全部业务逻辑用 Node.js 重写，融入 flatTalk 代码库，实现：
1. find_service / dispatch_manage 的数据源从种子数据切换为真实平台 API
2. 激活下单、创建工单、取消、评价等写操作
3. 新增老人档案和服务项目目录能力（flatTalk 当前完全缺失）
4. 移除所有硬编码种子数据，API 不可用时返回友好"无数据"卡片

### 1.3 非目标

- 不修改 LIS-System 的任何代码
- 不修改 flatTalk 的意图识别、场景路由、动作分发逻辑
- 不修改模板填充函数（`fillFindServiceCard` / `fillDispatchManageCard`）
- 不修改其他 skill（meal_plan / travel_route / health_risk_warning / nearby_resource）的任何代码
- 不保留 Python 进程（全量移植到 Node.js）
- 不保留种子数据作为降级 fallback

---

## 2. LIS 边界定义

### 2.1 不可触碰的文件

以下文件的**控制流逻辑**完全不动。融合只改**数据源**，不改**意图识别、场景路由、动作分发**。

| 层 | 文件 | 职责 |
|---|---|---|
| LIS 客户端 | `src/core/lis/lis-client.js` | 调 `:8100/v1/sort` |
| 意图匹配 | `src/core/lis/matcher.js` | IntentSupply → 技能目录 |
| 场景路由 | `src/core/scene-router/rules/find-service.js` | find_service 场景判定 |
| 场景路由 | `src/core/scene-router/rules/dispatch-manage.js` | dispatch_manage 场景判定 |
| Agent 评分 | `src/core/agents/agents/find-service-agent.js` | 证据打分 |
| Agent 评分 | `src/core/agents/agents/dispatch-manage-agent.js` | 证据打分 |
| 动作分发 | `src/core/actions/action-dispatcher.js` L111-134 | action→template 映射 |
| 模板填充 | `src/core/model-service.js` L2025 `fillFindServiceCard` | 消费 business_data 填模板 |
| 模板填充 | `src/core/model-service.js` L2416 `fillDispatchManageCard` | 消费 business_data 填模板 |
| Orchestrator | `src/core/orchestrator/chat-orchestrator.js` L1466/L1505 | 分支条件 + 数据装配 |

### 2.2 已知问题：冗余意图识别

flatTalk 存在两套并行的意图识别系统：

| 系统 | 机制 | 运行条件 |
|---|---|---|
| LIS-System (`:8100`) | ML 模型 + 规则 + 置信度 | `LIS_GATE_ENABLED=1`（当前已开启） |
| 本地 scene-router | 关键词列表 + 加权打分 + 阈值 | LIS 门控关闭或不命中时 |

优先级链路（`chat-orchestrator.js` L247-444）：

```
LIS 门控开启
  ├─ LIS 命中 → sceneDecision = LIS 结果（本地路由跳过）
  ├─ LIS 需澄清 → 返回澄清选项（本地路由跳过）
  └─ LIS 不可达 → 返回 common 兜底卡（本地路由跳过）
LIS 门控关闭
  └─ identifyScene() → 本地 scene-router 执行
```

**当前 `LIS_GATE_ENABLED=1`，本地 scene-router 完全不执行。** 它是 LIS 不可用时的降级兜底。

存在的问题：
1. 关键词表在 scene-router rules 和 agents 中各维护一份，已出现漂移
2. 降级时可能给出与 LIS 不同的判定
3. 三处（LIS intent_kb / scene-router rules / agents）需手工同步

**本融合方案不修复此问题。** 这是一个独立的"统一意图识别层"重构课题，不应与数据源迁移混在一起。记录为技术债。

### 2.3 可修改的文件

| 文件 | 修改内容 |
|---|---|
| `src/services/table-data/index.js` | `getFindServiceTables()` / `getDispatchManageTables()` 改调真实 API |
| `src/services/table-data/repository.js` | 删除 `fs_*` / `dm_*` 种子，保留 `meal_*` / `gxy_travel_*` / `health_risk_*` / `skill_configs` |
| `src/services/order/order-service.js` | 覆写（当前 write 方法零调用点，安全覆写） |
| `src/services/workorder/workorder-service.js` | 覆写（同上） |

---

## 3. 三层架构

```
用户消息
  ↓
LIS-System :8100 → IntentSupply          ← 不动
  ↓
scene-router → scene_key                 ← 不动
  ↓
orchestrator 分支进入                     ← 控制流不动
  ↓
┌─────────────────────────────────────────────────────┐
│  ① skill/lib/          技能本地层                     │
│  field-mapper.js       平台字段 → 模板字段            │
│  data-assembler.js     多 API 编排 → business_data    │
│  action-handlers.js    action → {装配, 模板}          │
│  validators.js         下单/取消 字段校验             │
└─────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────┐
│  ② src/services/gxy-platform/   共享服务层            │
│  elder-service.js       老人列表+地址                 │
│  service-item-service.js  服务项目目录                │
│  order-service.js       订单 CRUD（覆写死代码）       │
│  workorder-service.js   工单 CRUD（覆写死代码）       │
│  feedback-service.js    反馈提交+查询                 │
│  shared.js              信封解析+错误处理             │
└─────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────┐
│  ③ src/third/gxy/      传输层                        │
│  base-client.js         HTTP + HMAC（移植 base.py）   │
│  elder-client.js        移植 gxy_elder.py             │
│  service-item-client.js 移植 gxy_service_item.py      │
│  feedback-client.js     移植 gxy_feedback.py          │
│  ─── existing (不动) ───                             │
│  src/third/order/       已有 gxy-order-sdk.js         │
│  src/third/workorder/   已有 gxy-workorder-sdk.js     │
└─────────────────────────────────────────────────────┘
  ↓
桂小养平台 https://aiyl-m.yunxida.com
```

### 3.1 分层原则

- **skill/lib/**：技能专属逻辑（字段映射、数据装配、action 路由）。不含平台调用逻辑，不含意图识别。
- **services/gxy-platform/**：平台 API 编排（调用顺序、参数构建、响应解析、业务规则如自动生成 orderNo）。不含模板逻辑，不含意图识别。
- **third/gxy/**：HTTP 传输 + HMAC 签名。纯管道，无业务逻辑。

### 3.2 为什么不用单一 service.js

单一 service.js 会把字段映射、API 编排、action 路由、输入校验混在一个文件里，随着 action 增多必然膨胀。拆成 4 个文件后：

| 文件 | 职责 | 预估行数 | 变更频率 |
|---|---|---|---|
| `field-mapper.js` | 平台 camelCase → flatTalk snake_case | ~80 | 低（只在平台字段变更时改） |
| `data-assembler.js` | 多 API 编排 → business_data | ~120 | 中（新增 action 时改） |
| `action-handlers.js` | action_id → {assembler, template} 映射表 | ~60 | 低（新增 action 时加一行） |
| `validators.js` | 下单/取消/评价必填字段校验 | ~40 | 低（只在平台校验规则变更时改） |

每个文件单一职责，可独立单测。新增 action 只在 `action-handlers.js` 加一行映射。

---

## 4. 目录结构

### 4.1 新增文件（✦）和修改文件（✎）

```
src/skills/find_service/
  index.js                         ← 不动
  manifest.json                    ← 不动
  templates/                       ← 不动（21 套模板保留）
  lib/                             ✦ 新增目录
    field-mapper.js                ✦ 平台 camelCase → flatTalk snake_case
    data-assembler.js              ✦ 编排 API → business_data
    action-handlers.js             ✦ find_service.* → {assembler, template}
    validators.js                  ✦ 下单/取消字段校验

src/skills/dispatch_manage/
  index.js                         ← 不动
  manifest.json                    ← 不动
  templates/                       ← 不动（8 套模板保留）
  lib/                             ✦ 新增目录
    field-mapper.js                ✦ 平台 → flatTalk 格式
    data-assembler.js              ✦ 编排 API → business_data
    action-handlers.js             ✦ dispatch_manage.* → {assembler, template}
    validators.js                  ✦ 工单创建字段校验

src/services/
  gxy-platform/                    ✦ 新增目录（全包移植）
    index.js                       ✦ re-export 5 个 service
    elder-service.js               ✦ 移植 elder_service.py
    service-item-service.js        ✦ 移植 service_item_service.py
    order-service.js               ✦ 覆写 order/order-service.js
    workorder-service.js           ✦ 覆写 workorder/workorder-service.js
    feedback-service.js            ✦ 移植 feedback_service.py
    shared.js                      ✦ 信封解析、错误码、服务类型推断
  order/                           ← 保留原文件（其他代码可能 import）
  workorder/                       ← 保留原文件
  table-data/
    index.js                       ✎ 修改 getFindServiceTables/getDispatchManageTables
    repository.js                  ✎ 删除 fs_*/dm_* 种子，保留其他种子

src/third/
  gxy/                             ✦ 新增目录
    base-client.js                 ✦ 移植 base.py（HTTP + HMAC）
    elder-client.js                ✦ 移植 gxy_elder.py
    service-item-client.js         ✦ 移植 gxy_service_item.py
    feedback-client.js             ✦ 移植 gxy_feedback.py
  order/                           ← 不动（gxy-order-sdk.js 已验证可用）
  workorder/                       ← 不动（gxy-workorder-sdk.js 已验证可用）
```

### 4.2 删除的种子数据

`repository.js` 中的以下 DEFAULT_TABLES 条目将被移除：

| 键 | 用途 | 替代 |
|---|---|---|
| `fs_service_catalog` | 22 条硬编码服务项目 | `gxy-platform/service-item-service.js` |
| `fs_org` | 硬编码机构 | 从订单/工单 API 返回的 `orgName`/`orgId` 字段去重提取（包无独立 org API） |
| `fs_worker` | 13 个硬编码护工 | 从订单/工单 API 返回的 `staffName`/`staffId` 字段去重提取（包无独立 worker API） |
| `fs_service_order` | 硬编码订单 | `gxy-platform/order-service.js` |
| `dm_dispatch_order` | 4 条硬编码派单 | `gxy-platform/workorder-service.js` |

保留的种子数据（其他 skill 依赖）：

| 键 | 依赖 skill |
|---|---|
| `elder_profile` | meal_plan |
| `meal_rules` | meal_plan |
| `diet_contraindications` | meal_plan |
| `gxy_travel_route_plan` | travel_route |
| `health_risk_warning_business` | health_risk_warning |
| `skill_configs` | 全局配置 |

---

## 5. 模块详细设计

### 5.1 skill/lib/field-mapper.js

**职责**：将平台 API 返回的 camelCase 字段映射为 flatTalk 模板期望的 snake_case 字段。

**设计要点**：
- 纯函数，无副作用，无 I/O
- 每个 mapper 函数对应一个平台响应类型
- 不改变数据语义，只做字段名转换和格式适配

**find_service 的映射表**（从 `fillFindServiceCard` L2027-2038 消费的字段反推）：

```
平台字段              → flatTalk business_data 字段
─────────────────────────────────────────────────
orderNo              → order_id
elderName            → elder_name
elderId              → elder_id
serviceItemName      → service_name
serviceItemId        → service_id
orgName              → org_name
orgId                → org_id
staffName            → worker_name
staffId              → worker_id
orderStatus          → order_status
amount               → price
address              → service_address
addressLat           → lat
addressLng           → lng
reserveDate          → reserve_date
reserveTime          → reserve_time
```

**dispatch_manage 的映射表**（从 `fillDispatchManageCard` L2418-2424 消费的字段反推）：

```
平台字段              → flatTalk business_data 字段
─────────────────────────────────────────────────
workOrderNo          → dispatch_id
orderNo              → order_id
staffName            → worker_name
staffId              → worker_id
elderName            → elder_name
elderId              → elder_id
workOrderStatus      → dispatch_status
workOrderType        → dispatch_type
```

### 5.2 skill/lib/data-assembler.js

**职责**：编排多个 gxy-platform service 调用，组装完整的 business_data 对象。

**设计要点**：
- 每个函数对应一个 action 的数据需求
- 返回值的 shape 与 `fillFindServiceCard` / `fillDispatchManageCard` 期望一致
- API 失败时返回空数组 + `source: 'gxy_platform_error'`，不抛异常
- 空数据时返回 `source: 'gxy_platform_empty'`，由模板层展示"无数据"卡片

**find_service 的 assembler 函数**：

| 函数 | 调用的 service | 返回 business_data 字段 |
|---|---|---|
| `assembleCatalog()` | service-item-service.list() | `{ service_catalog, source }` |
| `assembleOrderList(elderId)` | order-service.page({ elderId }) | `{ orders, source }` |
| `assembleOrderDetail(orderId)` | order-service.detail(orderId) | `{ orders: [single], source }` |
| `assembleOrderPreview(...)` | elder-service.addresses() + order-service.sync() | `{ orders, orgs, workers, source }` |
| `assembleBookingConfirm(...)` | order-service.sync() | `{ orders: [created], source }` |

**dispatch_manage 的 assembler 函数**：

| 函数 | 调用的 service | 返回 business_data 字段 |
|---|---|---|
| `assembleDispatchList(elderId)` | workorder-service.page({ elderId }) | `{ dispatch_orders, source }` |
| `assembleDispatchDetail(workOrderId)` | workorder-service.detail(id) | `{ dispatch_orders: [single], source }` |
| `assembleWorkOrder(workOrderId)` | workorder-service.detail(id) | `{ dispatch_orders: [single], source }` |
| `assembleDispatchStatus(workOrderId)` | workorder-service.progress(id) | `{ dispatch_orders: [single], source }` |

### 5.3 skill/lib/action-handlers.js

**职责**：将 action_id 映射到对应的 assembler 函数和模板 ID。

**设计要点**：
- 纯映射表，无逻辑分支
- 与 `action-dispatcher.js` L111-134 的映射保持一致
- 新增 action 只需加一行

**find_service 映射表**：

```javascript
{
  'find_service.recommend':    { assemble: assembleCatalog,      template: 'service_recommend' },
  'find_service.catalog':      { assemble: assembleCatalog,      template: 'service_catalog' },
  'find_service.detail_service': { assemble: assembleCatalog,    template: 'service_detail' },
  'find_service.list_orgs':    { assemble: assembleCatalog,      template: 'org_profile' },
  'find_service.list_workers': { assemble: assembleCatalog,      template: 'worker_profile' },
  'find_service.detail_order': { assemble: assembleOrderList,    template: 'order_status' },
  'find_service.preview_order': { assemble: assembleOrderPreview, template: 'order_preview' },
  'find_service.booking_confirm': { assemble: assembleBookingConfirm, template: 'service_booking_confirm' },
  'find_service.booking_success': { assemble: assembleBookingConfirm, template: 'booking_success' },
  'find_service.order_ticket': { assemble: assembleBookingConfirm, template: 'service_order_ticket' },
}
```

### 5.4 skill/lib/validators.js

**职责**：在调用写操作（下单/取消/评价/创建工单）前校验必填字段。

**移植来源**：`AI对接包-v3/backend/app/schemas/order.py` 和 `workorder.py` 的 Pydantic 校验规则。

**find_service 的下单校验**（19 个必填字段）：

```javascript
const ORDER_REQUIRED_FIELDS = [
  'category', 'elderId', 'orderSource', 'dispatchMode',
  'nurseId', 'serviceTypeId', 'serviceType', 'serviceItemId',
  'serviceItemName', 'provinceCode', 'cityCode', 'districtCode',
  'address', 'addressLat', 'addressLng',
  'contactName', 'contactPhone', 'reserveDate', 'reserveTime',
];
```

**关键安全规则**：`elderId` / `serviceItemId` / `nurseId` 等平台主键必须来自 API 返回值，禁止 LLM 编造。validator 会检查这些 ID 是否在之前 API 返回的候选列表中。

### 5.5 services/gxy-platform/

**移植映射**：

| Python 文件 | Node.js 文件 | 移植内容 |
|---|---|---|
| `services/elder_service.py` | `elder-service.js` | 老人列表（PG）、老人地址（平台 API） |
| `services/service_item_service.py` | `service-item-service.js` | 服务项目目录、详情 |
| `services/order_service.py` | `order-service.js` | 订单 sync/page/detail/cancel/evaluate/timeline |
| `services/workorder_service.py` | `workorder-service.js` | 工单 sync/page/detail/cancel/progress/timeline |
| `services/feedback_service.py` | `feedback-service.js` | 反馈 submit/page（已知 submit 平台侧故障，代码写好等修复） |
| `core/signature.py` | → `third/gxy/base-client.js` | HMAC-SHA256 签名 |
| `core/config.py` | → flatTalk 现有 `.env` | 配置合并 |
| `schemas/*.py` | → `validators.js` | 校验规则移到 skill/lib |

**shared.js 提供**：
- `parseEnvelope(response)` — 解析 `{ code, message, data }` 信封
- `mapErrorCode(code)` — 错误码映射（`FIELD_INVALID` → 422, `PLATFORM_ERROR` → 502）
- `inferServiceType(itemName)` — 按名称推断 serviceType（nurse/grid/doctor）
- `generateOrderNo()` / `generateWorkOrderNo()` — 幂等 ID 生成

### 5.6 third/gxy/

**base-client.js**（移植 `base.py`）：
- `request(method, path, body)` — 统一 HTTP 请求 + HMAC 签名
- 签名串：`method\npath\ntimestamp\nnonce\nbodySha256`
- 头部：`X-Timestamp` / `X-Nonce` / `X-Signature`
- 5 分钟时效校验

**elder-client.js**（移植 `gxy_elder.py`）：
- `getElderList(limit, offset)` — 从 PG `user_center_user` 查询
- `getElderAddresses(elderId)` — 调平台 `/openapi/elder/address/page`

**service-item-client.js**（移植 `gxy_service_item.py`）：
- `listItems(itemName, pageNo, pageSize)` — 调平台 `/serviceItem/pageByType`（GET，免签）
- `getItemDetail(itemId)` — 调平台 `/serviceItem/detail`（GET，免签）

**feedback-client.js**（移植 `gxy_feedback.py`）：
- `submitFeedback(...)` — 调平台 `/openapi/feedback/submit`
- `pageFeedback(...)` — 调平台 `/openapi/feedback/page`

**已有 SDK 保留不动**：
- `src/third/order/gxy-order-sdk.js` — 已验证可用，端点与包一致
- `src/third/workorder/gxy-workorder-sdk.js` — 已验证可用，端点与包一致

---

## 6. 数据流示例

### 6.1 查看服务订单

```
1. 用户: "查看我的服务订单"
2. LIS /v1/sort → intentSupply: { intent: 'find_service.detail_order' }
3. scene-router → scene_key: 'find_service'                    ← 不动
4. orchestrator L1466 分支进入                                  ← 控制流不动
5. table-data.getFindServiceTables()
   → 改为调用 find_service/lib/data-assembler.js.assembleOrderList(elderId)
     → gxy-platform/order-service.js.getOrderPage({ elderId, pageNo: 1 })
       → third/order/gxy-order-sdk.js → HMAC → 桂小养平台
     ← 返回平台原始数据（camelCase）
   → find_service/lib/field-mapper.js.mapOrders(rawOrders)
     ← { orderNo→order_id, elderName→elder_name, ... }
   → 返回 { orders: [...], source: 'gxy_platform' }
6. orchestrator 返回 business_data                              ← 数据流不动
7. fillFindServiceCard({ business_data, selectedTemplateId: 'order_status' })
   → 消费 bd.orders（shape 与之前一致）                         ← 不动
8. 模板渲染 → order_status.html                                  ← 不动
```

### 6.2 创建订单（写操作激活）

```
1. 用户: "帮黄秀英预约上门餐"
2. LIS → intentSupply: { intent: 'find_service.booking_confirm' }
3. scene-router → scene_key: 'find_service'                    ← 不动
4. orchestrator L1466 分支进入                                  ← 控制流不动
5. table-data.getFindServiceTables()
   → find_service/lib/data-assembler.js.assembleOrderPreview(...)
     → gxy-platform/elder-service.js.getElderAddresses(elderId)
     → gxy-platform/service-item-service.js.listItems('上门餐')
     → find_service/lib/validators.js.validateOrder(fields)
       ← 检查 19 个必填字段，验证 elderId/serviceItemId 在候选列表中
     → gxy-platform/order-service.js.syncOrder(fields)
       → third/order/gxy-order-sdk.js → HMAC → 桂小养平台
     ← 返回创建的订单
   → field-mapper.js.mapOrders([created])
   → 返回 { orders: [created], source: 'gxy_platform' }
6. fillFindServiceCard → service_booking_confirm.html           ← 不动
```

---

## 7. 对 table-data/index.js 的修改

**只改 2 个方法，其余 4 个方法原样保留**：

```javascript
// ✎ 修改前
async getFindServiceTables() {
  return {
    service_catalog: await repository.list('fs_service_catalog'),
    orgs: await repository.list('fs_org'),
    workers: await repository.list('fs_worker'),
    orders: await repository.list('fs_service_order'),
    source: 'flatTalk_table_data',
  };
},

// ✎ 修改后
async getFindServiceTables(params = {}) {
  const { assembleFindServiceData } = await import('../../skills/find_service/lib/data-assembler.js');
  return assembleFindServiceData(params);
},
```

```javascript
// ✎ 修改前
async getDispatchManageTables() {
  return {
    dispatch_orders: await repository.list('dm_dispatch_order'),
    orders: await repository.list('fs_service_order'),
    workers: await repository.list('fs_worker'),
    source: 'flatTalk_table_data',
  };
},

// ✎ 修改后
async getDispatchManageTables(params = {}) {
  const { assembleDispatchData } = await import('../../skills/dispatch_manage/lib/data-assembler.js');
  return assembleDispatchData(params);
},
```

**不变的方法**：
- `getMealPlanTables()` — 不动
- `getTravelRouteTables()` — 不动
- `getHealthRiskWarningTables()` — 不动
- `getSkillConfigs()` — 不动

---

## 8. 隔离保证

| 保证项 | 机制 |
|---|---|
| LIS 边界不被冲破 | 融合不新增任何意图识别/场景路由代码；orchestrator 分支条件不动 |
| 其他 skill 不受影响 | table-data/index.js 只改 2 个方法，其余 4 个方法原样保留 |
| service.js 不臃肿 | 拆成 4 个文件，每个 < 150 行，单一职责 |
| 模板填充层不动 | 字段映射在 data-assembler 里做，business_data 保持原 shape |
| 现有 SDK 不破坏 | order/workorder SDK 保留原位，新增 elder/service-item/feedback SDK |
| 死代码安全覆写 | order-service.js/workorder-service.js 当前 write 方法零调用点，覆写无风险 |
| PG 依赖隔离 | 仅 elder-service.js 依赖 PG，其他 service 全走 HTTP API；PG 不可用时 elder 数据返回空 |

---

## 9. 配置合并

包的 `.env` 配置合并到 flatTalk 现有 `.env`：

```env
# 桂小养平台 API（与包一致）
GXY_API_URL=https://aiyl-m.yunxida.com/backend-api/portal-api
GXY_API_SECRET=sign_U9IAnIMAFv
GXY_TIMEOUT=10000

# 本机 PostgreSQL（与 flatTalk 现有配置一致）
DATABASE_URL=postgresql://postgres:123456@localhost:5432/tag_system

# API Key（上线时启用）
GXY_PLATFORM_API_KEY=dev-local-api-key
```

flatTalk 已有的 `GXY_API_URL` / `GXY_API_SECRET` 配置可以直接复用，无需新增。

---

## 10. 已知问题与技术债

### 10.1 冗余意图识别（不修复，记录）

flatTalk 的 scene-router rules 和 agents 与 LIS-System 存在功能重叠。当前 `LIS_GATE_ENABLED=1` 时本地路由不执行，但代码仍需维护。建议未来作为独立的"统一意图识别层"重构课题处理。

### 10.2 反馈接口平台侧故障（不修复，等平台）

`/openapi/feedback/submit` 需登录用户上下文，返回 `PLATFORM_ERROR`。代码写好但调用时会返回平台错误。等平台修复后自动可用。

### 10.3 老人地址可能为空（需验证）

测试中发现部分老人无地址数据。下单流程依赖地址（省市区编码、经纬度），地址为空时需引导用户补充。

### 10.4 服务项目仅 5 条（需确认）

平台 `serviceItem/pageByType` 返回 total=5，远少于 flatTalk 当前硬编码的 22 条。需确认是否是测试环境数据，还是平台确实只有 5 个服务项目。

---

## 11. 迁移序列

### 阶段一：传输层 + 服务层（只读，不碰 skill）

1. 创建 `src/third/gxy/base-client.js`（移植 HMAC）
2. 创建 `src/third/gxy/elder-client.js`
3. 创建 `src/third/gxy/service-item-client.js`
4. 创建 `src/third/gxy/feedback-client.js`
5. 创建 `src/services/gxy-platform/shared.js`
6. 创建 `src/services/gxy-platform/elder-service.js`
7. 创建 `src/services/gxy-platform/service-item-service.js`
8. 创建 `src/services/gxy-platform/feedback-service.js`
9. 创建 `src/services/gxy-platform/order-service.js`（覆写）
10. 创建 `src/services/gxy-platform/workorder-service.js`（覆写）

**验证点**：每个 service 可独立调用，返回真实数据。

### 阶段二：技能本地层（只读数据装配）

11. 创建 `src/skills/find_service/lib/field-mapper.js`
12. 创建 `src/skills/find_service/lib/data-assembler.js`
13. 创建 `src/skills/find_service/lib/action-handlers.js`
14. 创建 `src/skills/find_service/lib/validators.js`
15. 创建 `src/skills/dispatch_manage/lib/` 同上 4 个文件

**验证点**：assembler 函数返回的 business_data shape 与 fillFindServiceCard 期望一致。

### 阶段三：接线（最小改动）

16. 修改 `src/services/table-data/index.js` 的 `getFindServiceTables()` 和 `getDispatchManageTables()`
17. 删除 `src/services/table-data/repository.js` 中的 `fs_*` / `dm_*` 种子

**验证点**：find_service 和 dispatch_manage 的只读场景（查看目录、查看订单、查看工单）端到端可用。

### 阶段四：写操作激活

18. 在 `data-assembler.js` 中接入 `validators.js` + `order-service.syncOrder()`
19. 在 `data-assembler.js` 中接入 `workorder-service.syncWorkorder()`

**验证点**：真实下单、创建工单端到端可用。

---

## 12. 验收标准

| 场景 | 验收条件 |
|---|---|
| 查看服务目录 | 返回平台真实服务项目（≥5 条），不再返回 22 条硬编码 |
| 查看订单列表 | 返回平台真实订单（234 条），按 elderId 过滤 |
| 查看工单列表 | 返回平台真实工单（9974 条），按 elderId 过滤 |
| 查看老人档案 | 返回 PG 中 33 条 ELDER 记录 |
| 创建订单 | 调用平台 sync 接口成功，返回 orderNo |
| 取消订单 | 调用平台 cancel 接口成功 |
| API 不可用 | 返回"无数据"卡片，不返回假数据 |
| 其他 skill | meal_plan / travel_route / health_risk_warning / nearby_resource 功能完全不受影响 |
| LIS 边界 | 意图识别、场景路由、动作分发行为完全不变 |
