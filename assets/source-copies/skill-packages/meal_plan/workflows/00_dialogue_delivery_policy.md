# Dialogue Template Delivery Policy

Default delivery is an M2 in-chat structured template card. BFF validates the template registry and action registry before rendering and action execution.

## M2 Default Output

- `speech`: one concise voice-broadcast summary.
- `summary`: readable summary inside the chat bubble.
- `cards`: structured template data mapped to registered HTML and slots.
- `actions`: registered `action_key` only, with controlled params.

## Complex Interaction Upgrade

When the result needs order handoff, delivery details, or service scheduling, return a BFF or business-system action event instead of a raw URL.

```json
{
  "action_key": "meal_plan.order_handoff",
  "params": {
    "skill_key": "meal_plan",
    "intent": "weekly_plan",
    "source": "chat_template_action"
  }
}
```

## M1 Fallback

When business resources, APIs, or workbench capabilities are unavailable, return plain text explaining what can still be completed. Do not output internal frontend routes or local file paths.
