# guixiaoyang_dispatch / 09 对话收割存储

## 目标

把高质量问答、路由决策、动作执行和异常兜底写入服务端审计与后续知识治理流程。

## 存储内容

- 用户输入摘要。
- 意图识别结果。
- 知识来源摘要。
- 模板与 action_key。
- 跨技能交接结果。
- 用户反馈和人工复核状态。

## 输出

- `store_status`
- `audit_event_id`
- `harvest_candidate`
