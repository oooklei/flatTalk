# guixiaoyang_dispatch 平台接口参考

## Runtime

```bash
python scripts/backend/business_runtime.py audit
python scripts/backend/business_runtime.py render
python scripts/backend/business_runtime.py speech
```

## BFF 输入

```json
{
  "message": "我爸糖尿病，晚饭怎么安排？",
  "intent_key": "meal_plan_request",
  "template_id": "guixiaoyang_dispatch.router.v1",
  "action_key": "guixiaoyang_dispatch.route_meal_plan"
}
```

## BFF 输出

```json
{
  "schema": "guixiaoyang.render-document.v1",
  "skill_key": "guixiaoyang_dispatch",
  "template_id": "guixiaoyang_dispatch.router.v1",
  "actions": [
    {
      "action_key": "guixiaoyang_dispatch.route_meal_plan",
      "label": "继续处理"
    }
  ]
}
```

## 校验要求

- `template_id` 必须存在于 `templates/registry.json`。
- `action_key` 必须存在于 `platform/action-map.json`。
- 跨技能目标必须已挂载到当前智能体。
- 高风险动作必须写入审计并支持人工复核。
