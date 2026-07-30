# guixiaoyang_dispatch / 08 交接执行

## 目标

执行已校验 action_key，完成 BFF 事件、业务事件或跨技能交接。

## 规则

- 目标技能必须已挂载。
- 目标 action_key 必须已注册。
- 高风险动作必须进入人工复核。
- 执行失败时返回 `guixiaoyang_dispatch.status.v1`。

## 输出

- `execution_status`
- `target_skill_key`
- `next_template_id`
- `audit_level`
- `error_message`
