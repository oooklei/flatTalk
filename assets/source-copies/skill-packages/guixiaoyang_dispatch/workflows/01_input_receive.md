# guixiaoyang_dispatch / 01 输入接收

## 目标

接收用户输入，生成调度技能统一请求对象。

## 输入

- 用户原始文本。
- BFF 会话上下文。
- 当前智能体已挂载技能清单。
- 可用模板与 action_key 清单。

## 输出

- `normalized_text`
- `session_context`
- `mounted_skills`
- `template_registry`
- `action_registry`
