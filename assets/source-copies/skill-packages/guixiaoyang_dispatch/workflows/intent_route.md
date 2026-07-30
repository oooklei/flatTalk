# 意图识别与路由

## 目标

识别用户意图并决定是否在当前技能内答复、进入澄清、提交人工复核，或路由到已挂载技能。

## 支持路由

- `policy_answer`：由 `guixiaoyang_dispatch` 结合政策知识库答复。
- `meal_plan_request`：路由到 `meal_plan`，动作 `guixiaoyang_dispatch.route_meal_plan`。
- `dispatch_manage_request`：路由到 `dispatch_manage`，动作 `guixiaoyang_dispatch.route_dispatch_manage`。
- `clarify_required`：动作 `guixiaoyang_dispatch.clarify`。
- `manual_review_required`：动作 `guixiaoyang_dispatch.manual_review`。

## 步骤

1. 使用模型判断意图、置信度和缺失上下文。
2. 用 `references/contracts/action-intent-map.json` 映射候选动作。
3. 检查目标技能是否在 `mounted_skills` 内。
4. 目标技能不可用时输出 `guixiaoyang_dispatch.status.v1`。
5. 返回模板选择所需的 `intent_key`、`route_options` 和 `actions`。
