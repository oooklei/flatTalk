# 对话存储与审计

调度技能的对话数据由 BFF 统一写入服务端存储，不依赖前端离线缓存作为业务事实来源。

## 存储对象

- `session_id`：会话 ID。
- `user_id` / `elder_id` / `role`：由登录态或 BFF 上下文提供。
- `skill_key`：固定为 `guixiaoyang_dispatch`，跨技能执行时记录目标技能。
- `intent_key`：模型识别出的意图。
- `template_id`：实际渲染模板。
- `action_key`：用户点击或系统自动触发的注册动作。
- `input_summary` / `output_summary`：用于后续上下文压缩。
- `audit_status`：success、fallback、blocked、manual_review。

## 写入流程

1. BFF 接收用户输入并生成会话事件。
2. 调度技能返回结构化结果。
3. BFF 校验模板与 action_key。
4. 校验通过后写入对话事件、模板渲染事件、动作审计事件。
5. 校验失败时写入 fallback 事件，并返回纯文本兜底。

## 审计要求

- 所有 action_key 必须可追溯到 `platform/action-map.json`。
- 跨技能 handoff 必须记录源技能、目标技能、上下文摘要和执行结果。
- 人工复核必须记录原因、风险等级和建议处理角色。
