/**
 * Per-skill scene-router thresholds (static).
 * Replaces former table-data skill_configs demo rows.
 */
export const DEFAULT_THRESHOLDS_BY_SCENE = Object.freeze({
  meal_plan: { accept: 0.62, review: 0.45 },
  travel_route: { accept: 0.62, review: 0.45 },
  health_risk_warning: { accept: 0.62, review: 0.45 },
  find_service: { accept: 0.6, review: 0.42 },
  dispatch_manage: { accept: 0.6, review: 0.42 },
  nearby_resource: { accept: 0.6, review: 0.42 },
  elder_policy: { accept: 0.6, review: 0.42 },
  service_quality_eval: { accept: 0.6, review: 0.42 },
});
