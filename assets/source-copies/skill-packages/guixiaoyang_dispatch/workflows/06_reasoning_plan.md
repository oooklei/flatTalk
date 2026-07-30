# guixiaoyang_dispatch / 06 推理计划

## 目标

基于输入、权限、上下文、知识命中和可用技能，生成调度决策。

## 决策

- 当前技能直接答复。
- 请求用户补充上下文。
- 路由到 `meal_plan`。
- 路由到 `dispatch_manage`。
- 提交人工复核。

## 输出

- `intent_key`
- `confidence`
- `target_skill_key`
- `template_id`
- `slot_sequence`
- `candidate_actions`
