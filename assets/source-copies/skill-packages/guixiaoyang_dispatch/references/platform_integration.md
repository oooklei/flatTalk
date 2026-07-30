# 平台集成

`guixiaoyang_dispatch` 通过 BFF 接入桂小养通用型智能体。

## 集成点

- 技能类型：通用型智能体可调度技能。
- 模板合同：`guixiaoyang.render-document.v1`。
- 模板注册：`templates/registry.json`。
- 动作映射：`platform/action-map.json`。
- 业务表：`gxy_dispatch_session`。
- 业务知识库：`guixiaoyang_dispatch_business_kb`。
- 政策知识库：由智能体层挂载，技能内只引用。

## 执行边界

BFF 负责校验模板、slot、action_key、角色权限和目标技能挂载状态。技能只返回结构化调度决策，不直接执行未注册动作。
