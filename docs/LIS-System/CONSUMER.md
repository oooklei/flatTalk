# flatTalk 消费 LIS-System 契约

## 边界

| 系统 | 职责 |
|------|------|
| **LIS-System** | 自然语言 → `IntentSupply`；澄清问句；签发/解读 `routing_ticket`；越界裁决；**不执行**业务 |
| **flatTalk** | Catalog 注册、Matcher、执行 Intent 包、LLM 自由问答；**SessionStore 为唯一上下文真相源** |

阈值：`0.5`（与 LIS `decision.threshold` 一致）。

---

## Gatekeeper Ticket 路由门控

启用 Gatekeeper Ticket 后（`LIS_GATE_ENABLED=1`），flatTalk 在 scene-router 之前经 **ContextProjector + routing-gate** 选择三条路径之一：

| 模式 | 何时 | LIS 调用 |
|------|------|----------|
| **SORT** | 无票 / 票 TTL 过期 / `reenter_chat` / 跨 domain 点选后 / 有效票但对话轮次 &lt; 3 | `POST /v1/sort` |
| **BOUNDARY** | 票有效 + 自由文本 + `DialogueView.turns.length ≥ 3` | `POST /v1/boundary` |
| **SKILL_LOCK** | 票有效 + `action_key` 或 `followup_source`（域内按钮/追问） | **不经 LIS** |

### boundary 响应 → flatTalk 行为

| `status` | flatTalk |
|----------|----------|
| `STAY` | 留在当前 domain；可附域内 `intents[]` 执行 |
| `ESCAPE` | 作废票 → `POST /v1/sort` |
| `LLM_FALLBACK` | 转 LLM 自由问答；**作废票** |

### 决策消费（sort / clarify，与 V1 一致）

| `decision.status` | flatTalk 行为 |
|-------------------|---------------|
| `MATCH_OK` | 取 `role=primary`（及可组合 `secondary`）→ Catalog.entry 执行；**签发票**存会话 |
| `NEED_CLARIFY` | 展示 `clarify`；用户答复后调 LIS `/v1/clarify` mode=resolve |
| `LLM_FALLBACK_HINT` | **转 LLM 自由问答**（不再二次澄清）；**作废票** |

---

## 上下文投影（flatTalk → LIS）

flatTalk **不**把原始 SessionStore 直接传给 LIS，而是经 **ContextProjector** 投影为两个契约对象：

| 对象 | 说明 |
|------|------|
| **DialogueView** | 最近 N 轮对话（role / text / intent_id / decision_status / source 等）；boundary 调用时 **硬约束 `turns.length ≥ 3`** |
| **BizHints** | 业务附载：**全量、不脱敏**（user、geo、scene、entity_lock、semantic、catalog 白名单等） |

- `/v1/sort`：必带 `utterance`；有历史时建议附 `dialogue` + `biz_hints`。
- `/v1/boundary`：必带 `utterance` + `routing_ticket` + `dialogue`(≥3) + `biz_hints`。
- 实现：`src/core/lis/context-projector.js`（`projectDialogueView` / `projectBizHints`）。

---

## routing_ticket 存取

| 项 | 约定 |
|----|------|
| **存储位置** | `session.global_context.routing_ticket` |
| **签发** | sort `MATCH_OK` 或 clarify resolve 成功 |
| **保留** | boundary `STAY` |
| **作废** | TTL 过期、`reenter_chat`、boundary `ESCAPE` / `LLM_FALLBACK`、`LLM_FALLBACK_HINT` |

票由 LIS 签发，flatTalk 存取；LIS 无状态，不持久化会话。

---

## 环境变量

| 变量 | 含义 | 默认 |
|------|------|------|
| `LIS_GATE_ENABLED` | 设为 `1` 启用 Gatekeeper Ticket 门控 | 关闭 |
| `LIS_BASE_URL` | LIS 服务根 URL | `http://127.0.0.1:8100` |

接入点：`POST /api/chat/message`，在 `identifyScene` / scene-router 之前（`src/core/lis/lis-gate-hook.js`）。

---

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

---

## 设计文档

Gatekeeper Ticket 完整架构见 LIS-System 设计 spec（**注意**：本目录 `../LIS-System/...` 相对链接在 flatTalk 独立仓库中可能无法解析）：

- **设计 spec**：`D:\GuiCare\LIS-System\docs\superpowers\specs\2026-08-08-lis-flattalk-gatekeeper-ticket-design.md`
- **实现计划**：`D:\GuiCare\LIS-System\docs\superpowers\plans\2026-08-08-lis-flattalk-gatekeeper-ticket.md`

Monorepo 根目录下相对路径：`LIS-System/docs/superpowers/specs/2026-08-08-lis-flattalk-gatekeeper-ticket-design.md`。
