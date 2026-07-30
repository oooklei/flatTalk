# guixiaoyang_dispatch / 07 结果组装

## 目标

组装符合 `guixiaoyang.render-document.v1` 的对话内渲染结果。

## 规则

- `template_id` 必须来自 `templates/registry.json`。
- `slot_sequence` 必须符合模板允许序列。
- 数据字段必须符合 `references/contracts/output.schema.json`。
- action_key 必须来自 `platform/action-map.json`。

## 输出

- `render_document`
- `actions`
- `handoff_context`
- `fallback_reason`
