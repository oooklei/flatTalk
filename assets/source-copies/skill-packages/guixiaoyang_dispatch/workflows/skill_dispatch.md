# 技能调度

## 目标

将已确认的意图和上下文交给当前智能体已挂载的目标技能，并保证动作可审计、可回放、可降级。

## 调度规则

- 只允许调度 `mounted_skills` 中存在的技能。
- 只允许使用 `platform/action-map.json` 注册的 action_key。
- 跨技能交接只传摘要和必要字段，不传未经确认的敏感明细。
- 目标技能不可用或上下文不足时，返回澄清或状态卡片。

## 输出

- `target_skill_key`
- `target_intent_key`
- `action_key`
- `handoff_context`
- `next_template_id`
- `audit_level`
