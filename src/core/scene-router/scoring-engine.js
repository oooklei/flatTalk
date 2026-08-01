export const DEFAULT_THRESHOLDS = Object.freeze({
  accept: 0.85,
  review: 0.55,
  margin: 0.2,
});

export function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

export function includesTerm(text, term) {
  const source = normalizeText(text);
  if (!source) return false;
  if (term instanceof RegExp) {
    const flags = term.flags.includes('g') ? term.flags.replace('g', '') : term.flags;
    return new RegExp(term.source, flags).test(source);
  }
  return source.includes(normalizeText(term));
}

export function collectTermEvidence(input, groups = []) {
  const text = extractText(input);
  const evidence = [];
  let score = 0;

  for (const group of groups) {
    const matches = [];
    for (const term of group.terms ?? []) {
      if (includesTerm(text, term)) {
        matches.push(formatTerm(term));
      }
    }

    if (matches.length > 0) {
      const weight = Number(group.weight ?? 0);
      score += weight;
      evidence.push({
        group: group.group ?? group.key ?? group.name,
        weight,
        matches,
      });
    }
  }

  return { score, evidence };
}

export function scoreRuleSet(input, ruleSet, thresholds = DEFAULT_THRESHOLDS) {
  const mergedThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const positiveEvidence = collectTermEvidence(input, ruleSet.evidence_groups);
  const roleBoost = collectRoleBoost(input, ruleSet.role_boost);
  const contextBoost = collectContextBoost(input, ruleSet.context_boost);
  const conflicts = collectConflicts(input, ruleSet.conflicts);

  const positive = positiveEvidence.score + roleBoost.score + contextBoost.score;
  const conflict = conflicts.score;
  const threshold = Number(ruleSet.threshold ?? 1) || 1;
  const confidence = clamp((positive - conflict) / threshold);
  const decision = decide(confidence, mergedThresholds);

  // 优先使用请求中携带的 intent（如 followup 按钮），否则调用 infer_intent
  const requestIntent = input?.intent || input?.intent_context?.intent;
  const intent = requestIntent
    ? requestIntent
    : (typeof ruleSet.infer_intent === 'function' ? ruleSet.infer_intent(input) : ruleSet.default_intent);

  return {
    scene_key: ruleSet.scene_key,
    scene: ruleSet.scene_key,
    intent: intent ?? ruleSet.default_intent,
    decision,
    confidence,
    score: positive - conflict,
    positive_score: positive,
    conflict_penalty: conflict,
    threshold,
    evidence: {
      positive: positiveEvidence.evidence,
      boosts: [...roleBoost.evidence, ...contextBoost.evidence],
      conflicts: conflicts.evidence,
    },
    template_candidates: [...(ruleSet.template_candidates ?? [])],
    required_data: [...(ruleSet.required_data ?? [])],
    required_knowledge: [...(ruleSet.required_knowledge ?? [])],
    actions_allowed: [...(ruleSet.actions_allowed ?? [])],
    followup_policy: ruleSet.followup_policy,
    rule_set: ruleSet.scene_key,
  };
}

function extractText(input) {
  if (typeof input === 'string') return input;
  return [
    input?.text,
    input?.utterance,
    input?.message,
    input?.query,
  ].filter(Boolean).join(' ');
}

function collectRoleBoost(input, roleBoost = {}) {
  const roles = [input?.role, input?.user_role, input?.context?.role].filter(Boolean);
  const allowed = new Set(roleBoost.roles ?? []);
  const weight = Number(roleBoost.weight ?? 0);

  for (const role of roles) {
    if (allowed.has(role)) {
      return {
        score: weight,
        evidence: [{ group: 'role_boost', weight, matches: [role] }],
      };
    }
  }

  return { score: 0, evidence: [] };
}

function collectContextBoost(input, contextBoost = {}) {
  const previousScene = input?.previous_scene ?? input?.context?.previous_scene;
  if (!previousScene || previousScene !== contextBoost.previous_scene) {
    return { score: 0, evidence: [] };
  }

  const termEvidence = collectTermEvidence(input, [{
    group: 'context_continuation',
    weight: contextBoost.weight,
    terms: contextBoost.terms,
  }]);

  return {
    score: termEvidence.score,
    evidence: termEvidence.evidence,
  };
}

function collectConflicts(input, conflicts = []) {
  const text = extractText(input);
  const evidence = [];
  let score = 0;

  for (const conflict of conflicts) {
    const matches = [];
    for (const term of conflict.terms ?? []) {
      if (includesTerm(text, term)) {
        matches.push(formatTerm(term));
      }
    }

    if (matches.length > 0) {
      const penalty = Number(conflict.penalty ?? 0);
      score += penalty;
      evidence.push({
        group: conflict.group ?? conflict.scene_key,
        penalty,
        matches,
      });
    }
  }

  return { score, evidence };
}

function decide(confidence, thresholds) {
  if (confidence >= thresholds.accept) return 'accept';
  if (confidence >= thresholds.review) return 'review';
  return 'reject';
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function formatTerm(term) {
  return term instanceof RegExp ? term.toString() : String(term);
}
