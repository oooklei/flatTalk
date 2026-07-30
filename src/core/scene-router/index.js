import { DEFAULT_THRESHOLDS, scoreRuleSet } from './scoring-engine.js';
import { elderPolicyRuleSet } from './rules/elder-policy.js';
import { mealPlanRuleSet } from './rules/meal-plan.js';
import { travelRouteRuleSet } from './rules/travel-route.js';
import { healthRiskWarningRuleSet } from './rules/health-risk-warning.js';

export { DEFAULT_THRESHOLDS, scoreRuleSet } from './scoring-engine.js';
export { elderPolicyRuleSet } from './rules/elder-policy.js';
export { mealPlanRuleSet } from './rules/meal-plan.js';
export { travelRouteRuleSet } from './rules/travel-route.js';
export { healthRiskWarningRuleSet } from './rules/health-risk-warning.js';

export const RULE_SETS = [mealPlanRuleSet, travelRouteRuleSet, healthRiskWarningRuleSet, elderPolicyRuleSet];

export function identifyMealPlanScene(input, options = {}) {
  return scoreRuleSet(input, mealPlanRuleSet, options.thresholds);
}

export function executeHealthRiskWarningRuleSet(input, options = {}) {
  return scoreRuleSet(input, healthRiskWarningRuleSet, options.thresholds);
}

export function identifyScene(input, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const candidates = (options.ruleSets ?? RULE_SETS)
    .map((ruleSet) => scoreRuleSet(input, ruleSet, thresholds))
    .sort((a, b) => b.confidence - a.confidence);

  const top = candidates[0] ?? null;
  if (!top) return null;

  const second = candidates[1];
  const margin = second ? top.confidence - second.confidence : top.confidence;

  return {
    ...top,
    candidates,
    margin,
    routed: top.decision === 'accept' && isAtLeastMargin(margin, thresholds.margin),
  };
}

function isAtLeastMargin(actual, expected) {
  return actual + Number.EPSILON >= expected;
}
