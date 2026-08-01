# 模板匹配优化设计文档

> **日期**：2026-08-01  
> **状态**：待实现  
> **背景**：56 个测试用例命中率仅 25%，三大根因：场景路由误拦截、模板硬编码映射、兜底回退错误

---

## 一、问题诊断

### 1.1 三层缺陷叠加

| 层 | 问题 | 影响案例数 |
|---|---|---|
| 场景路由 | elder-policy 含 "帮我"(权重6.5) + 阈值仅5，大量误拦截 | 20 |
| 模板映射 | `selectRoutedTemplateId()` 硬编码，travel_route 无条件返回 route_card | 7 |
| 兜底回退 | 所有未匹配输入无条件落到 policy_card | 10 |

### 1.2 各场景命中率

| 场景 | 命中/总数 | 命中率 |
|---|---|---|
| common | 2/5 | 40% |
| find_service | 4/13 | 31% |
| dispatch_manage | 2/7 | 29% |
| health_risk_warning | 0/5 | **0%** |
| meal_plan | 2/5 | 40% |
| nearby_resource | 3/12 | 25% |
| travel_route | 1/9 | **11%** |
| **总计** | **14/56** | **25%** |

### 1.3 关键根因链路

**"帮我找个护工" → policy_card 的完整因果链**：

1. elder_policy 命中："帮我" 同时匹配 `assistantUsageTerms`(权重4) 和 `serviceIntentTerms`(权重2.5) → 得分 6.5
2. elder_policy 阈值 5 → confidence = 6.5/5 = 1.0 → **accept**
3. find_service 命中："护工"(3) + "找"(3) → 得分 6，阈值 8 → confidence = 0.75 → review
4. elder_policy(1.0) 胜出 → skillKey = `common`
5. common 模板库只有 policy 模板 → 输出 policy_card

---

## 二、解决方案：意图驱动的模板选择（方案B）

### 2.1 架构概览

```
用户输入
  │
  ▼
阶段1: 场景路由（修复关键词+阈值）
  │  → 确定 skill_key + intent
  │
  ▼
阶段2: intent→template 映射表
  │  → 返回 { suggested, candidates }
  │
  ▼
阶段3: LLM 在候选范围内选择
  │  → 模型返回 template_id（必须在 candidates 内）
  │  → 无效时回退到 suggested
  │
  ▼
渲染输出
```

### 2.2 与旧架构对比

| 维度 | 旧架构 | 新架构 |
|---|---|---|
| 模板选择 | 代码硬编码单一模板 | intent 映射 + LLM 候选选择 |
| LLM 权限 | 无（"必须使用指定模板"） | 候选范围内自由选择 |
| 兜底 | policy_card | answer |
| 可扩展性 | 每加场景改代码 | 加映射表条目 |

---

## 三、详细设计

### 3.1 场景路由修复

#### 3.1.1 elder-policy.js 去宽泛化

| 修改项 | 旧值 | 新值 | 理由 |
|---|---|---|---|
| `assistantUsageTerms` | 含 "帮我"、"助手" | 移除两者 | "帮我"是通用动词 |
| `threshold` | 5 | 8 | 与其他场景对齐 |
| `serviceIntentTerms` 权重 | 2.5 | 1.5 | 降低通用动作词贡献 |

#### 3.1.2 各场景规则补强

**health_risk_warning**（当前 0% 命中）：

| 修改项 | 旧值 | 新值 |
|---|---|---|
| `healthRiskAlertTerms` | "健康风险"等专业词 | 增加 "血压"、"血糖"、"心率"、"跌倒"、"风险"、"偏高"、"异常"、"报告"、"评估" |
| `healthRiskVital` 权重 | 1.5 | 3 |
| threshold | 5 | 4 |

**find_service**：

| 修改项 | 旧值 | 新值 |
|---|---|---|
| threshold | 8 | 6 |

**travel_route**：

| 修改项 | 旧值 | 新值 |
|---|---|---|
| `routePlanSignalTerms` | "旅居"、"路线" | 增加 "行程"、"基地"、"景点"、"交通"、"高铁"、"天气"、"医院"、"方案"、"确认" |
| threshold | 8 | 6 |

**nearby_resource**：

| 修改项 | 旧值 | 新值 |
|---|---|---|
| `nearbySpecificTerms` | "附近"、"周边" | 增加 "餐厅"、"民宿"、"景区"、"住宿"、"住哪里"、"康养配套" |
| `placeTerms` | 具体地名 | 增加 "海边"、"医院"、"配套" |

### 3.2 intent→template 映射表

新建 `src/core/scene-router/intent-template-map.js`，集中管理 7 个场景的 intent→template 映射：

| 场景 | intent 数量 | default 模板 |
|---|---|---|
| travel_route | 10 | route_card |
| health_risk_warning | 6 | health_warning_card |
| find_service | 7 | service_recommend |
| nearby_resource | 12 | nearby_map_overview |
| meal_plan | 5 | diet_card |
| dispatch_manage | 7 | dispatch_list |
| common | 4 | **answer**（非 policy_card） |

`resolveTemplateId(sceneKey, intent, availableIds)` 查找逻辑：
1. intent 精确匹配
2. intent 模糊匹配（intent.includes(key)）
3. 返回 default

### 3.3 LLM 候选模板选择

#### 提示词改造

`fill-template.md`：
- `{{requested_template_id}}` → `{{suggested_template_id}}` + `{{candidate_templates}}`
- 规则第2条："必须使用" → "推荐参考，可选择候选列表中更合适的"

#### `sanitizeShape()` 优先级调整

```
模型返回的 template_id 在 candidates 内 → 使用模型选择
否则 → 回退到 suggested_template_id
```

#### 安全边界

- 模型只能在候选列表（同场景模板）内选择
- mock 模式直接用 suggested，不调用 LLM
- 模型返回无效 template_id → 回退 suggested

### 3.4 兜底回退修复

| 位置 | 旧 | 新 |
|---|---|---|
| `selectPolicyTemplate()` 第154行 | 返回 policy_card | 返回 answer |
| 场景路由全部 reject | → policy_card | → answer |

---

## 四、预期效果

| 场景 | 当前 | 修复后预期 |
|---|---|---|
| common | 40% | 80%+ |
| find_service | 31% | 70%+ |
| dispatch_manage | 29% | 60%+ |
| health_risk_warning | 0% | 70%+ |
| meal_plan | 40% | 80%+ |
| nearby_resource | 25% | 65%+ |
| travel_route | 11% | 70%+ |
| **总计** | **25%** | **70%+** |

---

## 五、修改文件清单

| 文件 | 改动类型 | 改动内容 |
|---|---|---|
| `rules/elder-policy.js` | 修改 | 移除宽泛词，阈值调整 |
| `rules/health-risk-warning.js` | 修改 | 大幅扩充关键词 |
| `rules/find-service.js` | 修改 | 阈值调整 |
| `rules/travel-route.js` | 修改 | 扩充关键词，阈值调整 |
| `rules/nearby-resource.js` | 修改 | 补充分类关键词 |
| **新建** `intent-template-map.js` | 新增 | intent→template 集中映射 |
| `chat-orchestrator.js` | 修改 | selectRoutedTemplateId 改为查映射表 |
| `model-service.js` | 修改 | 兜底改为 answer |
| `template-card-llm-service.js` | 修改 | sanitizeShape 优先模型选择 |
| `prompts/template-card/fill-template.md` | 修改 | 提示词约束放松 |

---

## 六、测试验证

修改完成后重新运行 `scripts/test-templates.mjs`（56 个用例），目标：
- 命中率 ≥ 70%
- 无 policy_card 误拦截
- travel_route/health_risk 子模板可命中

---

*文档结束*
