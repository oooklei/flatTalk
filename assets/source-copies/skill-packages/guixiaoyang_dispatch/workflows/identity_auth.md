# 身份与权限校验

## 目标

在执行技能路由和 action_key 前确认用户身份、角色和终端权限。

## 输入

- `login_context`：来自 BFF 登录态。
- `role_access`：`auth/role-access.json`。
- `action_map`：`platform/action-map.json`。

## 步骤

1. 校验登录态是否存在。
2. 解析用户角色：`elder`、`family`、`system_admin`。
3. 对待执行 action_key 检查角色权限。
4. 对缺少权限或缺少上下文的动作，返回澄清或人工复核。

## 输出

- `auth_passed`
- `role`
- `blocked_reason`
- `required_context`
