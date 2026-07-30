# JTD / 金跳动旅居接口配置

## 来源核对

- 已核对旧工程：`D:\GuiCare0717\guixiaoyang-chat-system copy`
- 旧工程旅居链路是 `travel_route` stub / 女娲技能分发，并未保存真实 JTD `appSecret`。
- 旧集成注册只出现旅居业务入口字段：`TRAVEL_PRODUCT_API_BASE_URL`、`TRAVEL_ORDER_API_BASE_URL`、`JTD_H5_BASE_URL`、`JTD_MINI_PROGRAM_APPID`。

## 当前配置

当前 JTD 客户端优先读取：

- `JTD_API_MODE`: `auto` / `real` / `mock`
- `JTD_BASE_URL`
- `JTD_PATH_PREFIX`
- `JTD_AI_APP_ID`
- `JTD_AI_APP_SECRET`
- `JTD_TIMEOUT_MS`

兼容旧配置名：

- `TRAVEL_PRODUCT_API_BASE_URL` -> `JTD_BASE_URL`
- `TRAVEL_PRODUCT_API_APP_ID` -> `JTD_AI_APP_ID`
- `TRAVEL_PRODUCT_API_APP_SECRET` 或 `TRAVEL_PRODUCT_API_SECRET` -> `JTD_AI_APP_SECRET`

## 运行策略

- `JTD_API_MODE=real`: 必须配置完整密钥，失败时返回供应商不可用。
- `JTD_API_MODE=mock`: 固定使用本地供应商 mock 数据。
- `JTD_API_MODE=auto`: 密钥完整时调用真实接口；密钥缺失时直接使用 mock 数据，不再产生 `config_missing` fallback。
