import { DEFAULT_THRESHOLDS, scoreRuleSet } from './scoring-engine.js';
import { elderPolicyRuleSet } from './rules/elder-policy.js';
import { mealPlanRuleSet } from './rules/meal-plan.js';
import { travelRouteRuleSet } from './rules/travel-route.js';
import { healthRiskWarningRuleSet } from './rules/health-risk-warning.js';
import { findServiceRuleSet, identifyFindServiceScene } from './rules/find-service.js';
import { dispatchManageRuleSet, identifyDispatchManageScene } from './rules/dispatch-manage.js';
import { serviceQualityEvalRuleSet } from './rules/service-quality-eval.js';
import { nearbyResourceRuleSet } from './rules/nearby-resource.js';
import { stableSortCandidates } from './scene-transition-manager.js';

export { DEFAULT_THRESHOLDS, scoreRuleSet } from './scoring-engine.js';
export { elderPolicyRuleSet } from './rules/elder-policy.js';
export { mealPlanRuleSet } from './rules/meal-plan.js';
export { travelRouteRuleSet } from './rules/travel-route.js';
export { healthRiskWarningRuleSet } from './rules/health-risk-warning.js';
export { findServiceRuleSet, identifyFindServiceScene } from './rules/find-service.js';
export { dispatchManageRuleSet, identifyDispatchManageScene } from './rules/dispatch-manage.js';
export { serviceQualityEvalRuleSet } from './rules/service-quality-eval.js';
export { nearbyResourceRuleSet } from './rules/nearby-resource.js';

export const RULE_SETS = [
  mealPlanRuleSet,
  travelRouteRuleSet,
  healthRiskWarningRuleSet,
  elderPolicyRuleSet,
  findServiceRuleSet,
  dispatchManageRuleSet,
  serviceQualityEvalRuleSet,
  nearbyResourceRuleSet,
];

export function identifyMealPlanScene(input, options = {}) {
  return scoreRuleSet(input, mealPlanRuleSet, options.thresholds);
}

export function executeHealthRiskWarningRuleSet(input, options = {}) {
  return scoreRuleSet(input, healthRiskWarningRuleSet, options.thresholds);
}

export function identifyServiceQualityEvalScene(input, options = {}) {
  return scoreRuleSet(input, serviceQualityEvalRuleSet, options.thresholds);
}

export function identifyScene(input, options = {}) {
  const globalThresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const perScene = options.thresholdsByScene ?? {};
  const candidates = (options.ruleSets ?? RULE_SETS)
    .map((ruleSet) => scoreRuleSet(input, ruleSet, { ...globalThresholds, ...(perScene[ruleSet.scene_key] ?? {}) }));

  const sortedCandidates = candidates.sort((a, b) =>
    (b.confidence - a.confidence)
    || (b.score - a.score)
    || (b.positive_score - a.positive_score)
  );

  const top = sortedCandidates[0] ?? null;
  if (!top) return null;

  const second = sortedCandidates[1];
  const margin = second ? top.confidence - second.confidence : top.confidence;

  return {
    ...top,
    candidates: sortedCandidates,
    margin,
    routed: top.decision === 'accept' && isAtLeastMargin(margin, globalThresholds.margin),
  };
}

function isAtLeastMargin(actual, expected) {
  return actual + Number.EPSILON >= expected;
}
