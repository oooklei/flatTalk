---
name: guixiaoyang_dispatch
description: 桂小养主调度师。基于远程智能体、技能、知识库、业务表与用户身份上下文完成意图识别、知识检索、技能路由、模板选择与 action_key 编排；适用于 B/G/Admin 终端及全部业务角色。先探测再判定资源状态；仅在探测失败时返回缺资源页面，禁止编造调度结论。
---

# 桂小养智能调度技能

## 定位

`guixiaoyang_dispatch` 是桂小养通用型智能体的主调度技能。它负责接收用户自然语言输入，完成身份与上下文检查、意图识别、知识检索、技能路由、模板选择和 action_key 编排。

本技能只输出对话内可渲染结构，不输出未注册渲染载体、内联脚本或未注册动作。

## 输入

- 用户原始问题。
- 会话上下文：用户角色、老人档案摘要、最近对话摘要、已挂载技能清单。
- 知识库检索结果：政策知识库、调度业务知识库。
- BFF 注入上下文：可用模板、可用 action_key、当前终端能力。

## 主流程

1. 识别用户意图，判断是否需要澄清。
2. 检查身份、角色、终端和上下文是否满足执行条件。
3. 对政策、业务规则、历史会话进行检索。
4. 在已挂载技能范围内选择路由：
   - `guixiaoyang_dispatch`：政策问答、通用咨询、意图澄清、人工复核、打包技能（导出技能 zip）。
   - `meal_plan`：膳食评估、膳食计划、营养建议、订餐交接。
   - `dispatch_manage`：调度管理、工单跟进、服务协调。
5. 返回 `render_document`，由 BFF 根据 `templates/registry.json` 和 `platform/action-map.json` 校验后渲染。
6. 所有按钮、快捷操作、后续执行都必须使用注册过的 `action_key`。

## 输出合同

输出必须是结构化对象：

```json
{
  "skill_key": "guixiaoyang_dispatch",
  "intent_key": "policy_answer",
  "template_id": "guixiaoyang_dispatch.router.v1",
  "render_document": {
    "template_id": "guixiaoyang_dispatch.router.v1",
    "slots": ["intent-summary", "route-options", "action-bar"],
    "data": {}
  },
  "actions": [
    {
      "action_key": "guixiaoyang_dispatch.route_meal_plan",
      "label": "生成膳食方案"
    }
  ]
}
```

## 打包技能（导出技能 zip）

当用户要求「打包技能 / 导出技能 zip / 技能打包 / 把XX技能打成zip」时：

- 先从用户输入中识别目标技能：技能 key（如 `entity_profile`）、技能名称或技能 id；若无法确定，先走 `guixiaoyang_dispatch.clarify` 询问要打包哪个技能。
- 输出 `render_document`，并附带动作：

```json
{
  "action_key": "guixiaoyang_dispatch.package_skill",
  "label": "打包技能",
  "params": { "skillKey": "<目标技能 key 或名称>" }
}
```

- 该动作由代码插件 `guixiaoyang_dispatch_package_skill` 执行：解析目标技能 → 调用 `/api/skill/export/{id}` 导出 zip → 返回可下载的技能包。
- 禁止在无目标技能的情况下虚构「打包技能失败」或原样回显用户输入；无法确定目标技能时应走澄清。

## 禁止项

- 禁止输出未注册的模板 ID、slot key 或 action_key。
- 禁止输出未注册渲染载体、跳转指令、内联脚本、内联事件处理器。
- 禁止把未挂载技能伪装成可执行技能。
- 禁止在缺少必要上下文时直接执行高风险动作；应先走 `guixiaoyang_dispatch.clarify` 或 `guixiaoyang_dispatch.manual_review`。

## 关键文件

- 模板注册：`templates/registry.json`
- HTML 模板：`templates/html`
- 示例数据：`templates/data/dispatch.sample.json`
- 动作映射：`platform/action-map.json`
- 输出结构：`references/contracts/output.schema.json`
- 编排约束：`references/contracts/template-composition.schema.json`
