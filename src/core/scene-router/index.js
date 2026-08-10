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
import { isJialuNearbyOnlyUtterance } from './place-brand-intent.js';

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

  // 举一反三：嘉路机构裸问 → 强制周边胜出（品牌 ≠ 旅居线路）
  const utterance = typeof input === 'string'
    ? input
    : [input?.text, input?.utterance, input?.message, input?.query].filter(Boolean).join(' ');
  if (isJialuNearbyOnlyUtterance(utterance)) {
    for (const c of candidates) {
      if (c.scene_key === 'nearby_resource') {
        c.score = Math.max(c.score || 0, 12);
        c.positive_score = Math.max(c.positive_score || 0, 12);
        c.confidence = 1;
        c.decision = 'accept';
        c.intent = c.intent || nearbyResourceRuleSet.default_intent;
      } else if (c.scene_key === 'travel_route') {
        c.score = Math.min(c.score || 0, 1);
        c.confidence = Math.min(c.confidence || 0, 0.3);
        c.decision = 'reject';
      }
    }
  }

  const sortedCandidates = candidates.sort((a, b) =>
    (b.confidence - a.confidence)
    || (b.score - a.score)
    || (b.positive_score - a.positive_score)
  );

  const top = sortedCandidates[0] ?? null;
  if (!top) return null;

  const second = sortedCandidates[1];
  const margin = second ? top.confidence - second.confidence : top.confidence;
  // 品牌周边硬优先时视为已 routed，避免 margin 不足触发消歧
  const forceRouted = isJialuNearbyOnlyUtterance(utterance) && top.scene_key === 'nearby_resource';

  return {
    ...top,
    candidates: sortedCandidates,
    margin: forceRouted ? Math.max(margin, globalThresholds.margin) : margin,
    routed: forceRouted || (top.decision === 'accept' && isAtLeastMargin(margin, globalThresholds.margin)),
  };
}

function isAtLeastMargin(actual, expected) {
  return actual + Number.EPSILON >= expected;
}
