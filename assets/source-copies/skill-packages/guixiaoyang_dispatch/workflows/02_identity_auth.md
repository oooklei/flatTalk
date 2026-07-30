# guixiaoyang_dispatch / 02 身份权限

## 目标

确认用户身份、角色和终端能力是否满足当前咨询或 action_key 执行条件。

## 规则

- `elder` 可进行普通咨询、澄清、语音播报和膳食方案请求。
- `family` 可进行家属代办、服务协调、人工复核。
- `system_admin` 可处理调度管理、审计和异常复核。

## 输出

- `auth_passed`
- `role`
- `terminal`
- `blocked_reason`
- `required_context`
