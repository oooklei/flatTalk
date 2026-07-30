# contraindication_check

## Purpose

AI膳食建议 的 `contraindication_check` 工作流节点，按 findService 串行节点模式编排。

## Inputs

- login_context: 来自 `auth/role-access.json` 的账号、角色、端侧。
- business_table: `gxy_meal_recommendation`。
- business_kb: `meal_plan_business_kb`。
- dialogue_kb: `meal_plan_dialogue_kb`。

## Steps

1. 校验登录用户端侧和角色权限，G端默认系统管理员。
2. 查询业务知识库并进行向量召回，命中时返回带来源的结构化结果。
3. 查询或写入业务数据表 `gxy_meal_recommendation`。
4. 将高质量问答和表达变体写入对话收割知识库。
5. 输出远端同步所需的表、知识库和脚本引用。

## Script References

- `scripts/backend/auth_api.js`
- `scripts/backend/database_api.js`
- `scripts/backend/knowledge_api.js`
- `scripts/backend/business_runtime.py render`
