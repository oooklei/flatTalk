# 对话交付策略

`guixiaoyang_dispatch` 的默认交付形态为对话内模板渲染。模型只负责选择已注册模板、组织结构化数据和推荐已注册 action_key，最终渲染与执行由 BFF 校验后完成。

## 分层

- M1：纯文本兜底。用于知识不足、权限不足、系统异常、需要人工介入的场景。
- M2：`render_document` 对话卡片。用于政策答复、技能路由、澄清问题、执行状态反馈。
- M3：跨技能 handoff。用于将上下文交给 `meal_plan` 或 `dispatch_manage` 等已挂载技能。

## 输出规则

每次可视化答复必须包含：

- `template_id`：来自 `templates/registry.json`。
- `slots`：只允许使用模板注册表声明的 slot。
- `data`：只提供业务字段，不包含脚本、样式覆盖或外部地址。
- `actions`：只允许使用 `platform/action-map.json` 中注册的 action_key。

## BFF 校验

BFF 必须执行以下校验：

1. 模板是否属于当前技能或可路由技能。
2. slot 是否属于该模板的允许序列。
3. action_key 是否存在、角色是否允许、目标技能是否已挂载。
4. data 是否满足 `references/contracts/output.schema.json`。
5. 不满足校验时降级为 M1 文本，并记录审计事件。

## 兜底

当知识库、模型、技能路由或业务系统不可用时，输出 `guixiaoyang_dispatch.status.v1` 或 M1 文本，说明当前可完成事项与下一步动作，不生成不可执行入口。
