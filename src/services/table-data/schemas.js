export const TABLE_SCHEMAS = Object.freeze({
  elder_profile: {
    primary_key: 'elder_id',
    fields: ['elder_id', 'age', 'conditions', 'preferences'],
  },
  meal_rules: {
    primary_key: 'key',
    fields: ['key', 'text'],
  },
  diet_contraindications: {
    primary_key: 'key',
    fields: ['key', 'text'],
  },
  gxy_travel_route_plan: {
    primary_key: 'uid',
    fields: ['uid', 'route_id', 'destination', 'season', 'budget_level', 'health_tags', 'booking_status'],
  },
  health_risk_warning_business: {
    primary_key: 'id',
    fields: ['id', 'package_key', 'business_scene', 'terminal', 'role', 'status', 'sample_payload'],
  },
  model_configs: {
    primary_key: 'config_id',
    fields: ['config_id', 'provider', 'model_id', 'is_active', 'is_default'],
  },
  skill_configs: {
    primary_key: 'skill_key',
    fields: ['skill_key', 'enabled', 'default_template', 'scene_thresholds'],
  },
  interface_configs: {
    primary_key: 'interface_key',
    fields: ['interface_key', 'type', 'base_url', 'enabled'],
  },
  conversation_turns: {
    primary_key: 'turn_id',
    fields: ['turn_id', 'conversation_id', 'skill_key', 'template_id', 'created_at'],
  },
});
