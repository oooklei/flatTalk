# 输入接收

## 目标

接收用户自然语言输入，标准化为调度技能可处理的结构化请求。

## 输入

- `message_text`：用户原始文本。
- `session_id`：会话 ID。
- `user_context`：用户角色、终端、老人档案摘要。
- `mounted_skills`：当前智能体已挂载技能清单。

## 步骤

1. 清洗空白、重复标点和明显噪声。
2. 生成输入摘要，保留用户原意。
3. 附加 BFF 注入的模板注册表、action_key 清单和已挂载技能清单。
4. 输出给身份校验、上下文收集和意图识别流程。

## 脚本引用

- `scripts/backend/auth_api.js`
- `scripts/backend/database_api.js`
- `scripts/backend/knowledge_api.js`
- `scripts/backend/business_runtime.py`
