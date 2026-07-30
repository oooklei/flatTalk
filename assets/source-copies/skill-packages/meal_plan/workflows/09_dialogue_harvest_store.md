# meal_plan / 09_dialogue_harvest_store

## Purpose

Store expression, slots, answer summary, action intent, and unresolved gaps into dialogue history and dialogue knowledge base.

## Business Context

- Package key: meal_plan
- Runtime policy: remote Nuwax resources are required for authoritative business execution.
- Dialogue storage is shared by BFF, remote skill execution, and business-system adapters.

## Inputs

- normalized request text
- role and terminal context
- remote table and knowledge base availability
- session_id for cross-skill conversation continuity
- user_id / elder_id / role from BFF identity context or skill context

## Outputs

- structured workflow state
- remote gap list when dependencies are unavailable
- template rendering envelope metadata
- persisted `gxy_dialogue_history` record
- Redis DB0 short-term context cache

## Storage Flow

```text
Dialogue message generated
  -> 1. INSERT gxy_dialogue_history
     (session_id, user_id, elder_id, role, skill_name, direction, message_text, message_metadata, action_key)
  -> 2. SET dialogue:{session_id}:{timestamp} {json} EX 86400
  -> 3. HSET dialogue:context:{session_id} skill_name meal_plan intent ? slots ?
  -> 4. Extract structured metadata for routing, template selection, and action auditing.
```

## message_metadata

```json
{
  "intent": "meal_recommend",
  "slots": {},
  "tags": ["dialogue_context", "template_rendering"],
  "action_key": "meal_plan.order_handoff",
  "entity_id": "E001",
  "entity_type": "ELDER"
}
```

## Cross-Skill Sharing

- Conversation history under the same session_id is retained when switching skills.
- BFF loads Redis DB0 context before remote dispatch and template orchestration.
- The active skill is read from `dialogue:context:{session_id}.skill_name`.

## Dependencies

- MySQL: `gxy_dialogue_history`
- Redis DB0: dialogue context cache
- BFF action registry: action_key validation and execution audit
