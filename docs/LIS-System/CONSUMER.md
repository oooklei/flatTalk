# flatTalk 消费 LIS-System 契约

## 边界

| 系统 | 职责 |
|------|------|
| **LIS-System** | 自然语言 → `IntentSupply`；澄清问句；**不执行**业务 |
| **flatTalk** | Catalog 注册、Matcher、执行 Intent 包、LLM 自由问答 |

阈值：`0.5`（与 LIS `decision.threshold` 一致）。

## 决策消费

| `decision.status` | flatTalk 行为 |
|-------------------|---------------|
| `MATCH_OK` | 取 `role=primary`（及可组合 `secondary`）→ Catalog.entry 执行 |
| `NEED_CLARIFY` | 展示 `clarify`；用户答复后调 LIS `/v1/clarify` mode=resolve |
| `LLM_FALLBACK_HINT` | **转 LLM 自由问答**（不再二次澄清） |

## Matcher 规则

1. 只对 `IntentSupply.intents[]` 与本地 **已启用** Catalog 条目求交。  
2. 打分可用：LIS `confidence` × 描述相似度（可选）；**`domain` 仅加分，不淘汰**。  
3. 执行键唯一：`intent_id`。  
4. 全员匹配分 &lt; 0.5 且 LIS 已给 `NEED_CLARIFY` → 走澄清，不在此轮直接 LLM。  
5. 收到 `LLM_FALLBACK_HINT` → LLM。

## Catalog 来源（迁移）

第一版可由现有映射导出：

- `src/core/scene-router/intent-template-map.js` 的 intent → template  
- 各 `rules/*.js` 的 `infer_intent` 枚举  
- skill/template manifest 描述  

Schema：`intent-catalog.schema.json`。

## 建议接入点

1. `POST /api/chat/message` 在 scene-router 之前（或逐步替换）：调用 LIS `/v1/sort`。  
2. 传入 `catalog_intent_ids` = 当前启用 Intent 列表。  
3. 按上表状态机分支；`MATCH_OK` 时用 `entry.skill_key` + `template_id` 走现有 fill/render。  
4. 配置：`LIS_BASE_URL=http://127.0.0.1:8100`。

## 示例 Catalog 条目

```json
{
  "intent_id": "nearby_resource.food",
  "intent_desc": "查询周边餐饮、餐馆、美食",
  "examples": ["附近有什么好吃的", "周边餐厅"],
  "domain": "nearby_resource",
  "tags": ["poi", "food"],
  "entry": {
    "kind": "template",
    "skill_key": "nearby_resource",
    "template_id": "nearby_food_card"
  },
  "enabled": true
}
```
