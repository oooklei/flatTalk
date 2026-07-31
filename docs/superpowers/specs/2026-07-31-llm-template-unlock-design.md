# LLM 模板解锁设计

## 1. 背景与问题

### 1.1 当前状态

项目已有完整的 LLM 驱动模板服务（`template-card-llm-service.js`），但 3 个技能被 `shouldUseDeterministicTemplate` 硬编码强制走本地代码路径：

- `travel_route`（旅居路线）
- `meal_plan`（膳食计划，含 weekly_plan / diet_card）
- `health_risk_warning`（健康风险预警）

其余技能（nearby_resource / find_service / dispatch_manage / elder_policy）已走 LLM。

### 1.2 问题

被封锁的 3 个技能存在以下限制：

1. **模板选择靠正则**：`selectTemplateId` 用正则匹配用户消息选模板，无法理解语义
2. **数据填充靠硬编码**：每个模板需要手写 `fill*Card` 函数从表格数据拼字段
3. **answer_text 不自然**：本地拼接的字符串缺乏语义连贯性
4. **扩展成本高**：新增模板必须写 fill 函数 + 正则规则

### 1.3 已有基础设施

| 组件 | 文件 | 状态 |
|------|------|------|
| LLM 客户端 | `src/core/model-runtime/openai-compatible-client.js` | ✅ 可用 |
| 模型注册表 | `src/core/model-runtime/model-registry.js` | ✅ 可用 |
| System Prompt | `src/prompts/template-card/system.md` | ✅ 可用 |
| Fill Prompt | `src/prompts/template-card/fill-template.md` | ✅ 可用（需增强） |
| JSON Schema 生成 | `src/template-card/prompt.js` → `jsonSchemaFor()` | ✅ 可用 |
| 数据归一化 | `template-card-llm-service.js` → `sanitizeShape()` / `normalizeWeeklyItems()` | ✅ 可用 |

## 2. 目标

1. 解除 3 个技能的 LLM 封锁，所有技能统一走 LLM 路径
2. 本地 fill 函数保留为降级兜底，保证可用性
3. LLM 超时 8 秒，超时自动降级
4. 动态生成模板字段说明注入 prompt，不硬编码字段名

## 3. 架构设计

### 3.1 改造后执行流程

```
fillTemplateSlots(input)
  │
  ├─ modelMode == 'mock' ?
  │   YES → 本地 fill（现有逻辑不变）
  │
  ├─ NO → 统一走 LLM（所有技能）
  │        ├─ buildTemplateFields(library)  ← 动态生成字段说明
  │        ├─ buildMessages(input + fields)
  │        ├─ callOpenAiCompatibleModel(timeoutMs: 8000)
  │        │
  │        ├─ LLM 成功 → sanitizeShape → 校验 required → 返回
  │        ├─ LLM 超时 → 降级本地 fill
  │        ├─ LLM 返回非法 JSON → 降级本地 fill
  │        └─ LLM 返回 template_id 不存在 → 降级本地 fill
  │
  └─ 本地 fill（保留所有现有 fill*Card 函数）
```

### 3.2 降级链

```
LLM 调用
  ├─ 成功 → sanitizeShape → 返回
  ├─ 超时(8s) → localFill(input, 'timeout')
  ├─ 非 JSON → localFill(input, 'invalid_json', rawReply)
  ├─ HTTP 错误 → localFill(input, 'http_error', errorMsg)
  └─ 无可用模型 → localFill(input, 'no_available_model')

localFill = fillTemplateSlotsMock（现有 model-service.js 中所有 fill*Card 函数）
```

### 3.3 数据质量三重保障

| 层 | 机制 | 位置 |
|----|------|------|
| 第 1 层 | sanitizeShape 结构归一化 | template-card-llm-service.js |
| 第 2 层 | template_id 存在性校验 | sanitizeShape 内 |
| 第 3 层 | renderCard selectTemplate 兜底 | template-card/select.js |

## 4. 改动详情

### 4.1 template-card-llm-service.js

**删除**：`shouldUseDeterministicTemplate` 函数（L112-124）

**修改 `fillTemplateSlots`**：
- 去掉 `shouldUseDeterministicTemplate` 判断
- LLM 调用增加 `timeoutMs: 8000`
- `buildMessages` 注入 `template_fields`

**修改 `sanitizeShape`**：
- 新增 required 字段缺失检测（记录到 template_fit_notes，不阻断）

**新增 `buildTemplateFields`**：
- 从 template_library 提取每个模板的 id / required / layout / match
- 供 prompt 动态渲染字段说明

### 4.2 fill-template.md

删除 meal_plan 硬编码字段说明（L30-58），改为：
- 动态 `{{template_fields}}` 占位符
- 通用字段填充规则

### 4.3 chat-orchestrator.js

`fillTemplateSlots` 调用处（L240），input 增加 `template_fields`（由 `describeLibrary` 已有的 library 数据生成）。

## 5. 性能预算

| 路径 | 环节 | 耗时 |
|------|------|------|
| LLM 成功 | loadBusinessData + LLM + render | 1.1-3.3s |
| LLM 降级 | loadBusinessData + 本地 fill + render | 0.3-0.5s |
| mock 模式 | 本地 fill + render | 0.1-0.3s |

当前纯本地路径约 0.3-0.5s。LLM 路径增加约 1-2.5s，换取语义化回答和模板自动选择。

## 6. 文件影响

### 修改（3 个）

| 文件 | 改动量 |
|------|--------|
| `src/core/model-runtime/template-card-llm-service.js` | ~40 行 |
| `src/prompts/template-card/fill-template.md` | ~30 行 |
| `src/core/orchestrator/chat-orchestrator.js` | ~5 行 |

### 不改动

- `src/core/model-service.js`（所有 fill*Card 保留为 fallback）
- `src/template-card/prompt.js`（jsonSchemaFor 已实现）
- `src/prompts/template-card/system.md`（角色定义完善）
- 12 个 HTML 模板（模板不变）
- `src/core/compact-followups/renderer.js`

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 填错 travel_route 字段 | renderCard selectTemplate 按字段覆盖率兜底 |
| weekly_plan 7天数据不完整 | normalizeWeeklyItems 自动补齐 |
| LLM 延迟波动 | 8秒超时 + 本地降级 |
| 生产模型不可用 | pickChatModel null → 本地降级 |
| compact_followups 在 LLM 路径暂无 | 后续通过 prompt 增强（本期不做） |

## 8. 测试策略

| 类型 | 覆盖内容 |
|------|----------|
| 单元 | shouldUseDeterministicTemplate 删除验证；超时降级；sanitizeShape required 校验 |
| 集成 | travel_route 走 LLM → route_card；LLM 失效 → 降级 fillRouteCard |
| 回归 | mock 模式所有现有测试通过 |
| 性能 | LLM P95 < 4s；降级 P95 < 0.5s |
