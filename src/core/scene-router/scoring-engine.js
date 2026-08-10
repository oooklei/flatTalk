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
  let confidence = clamp((positive - conflict) / threshold);
  if (confidence >= 1 && conflicts.evidence.some((item) => item.group === 'acute_health_risk')) {
    confidence = 0.99;
  }
  const decision = decide(confidence, mergedThresholds);

  // 意图来源优先级：
  //   1. 请求携带（followup 按钮 / LIS 门控回填）—— 正常路径
  //   2. ruleSet.infer_intent —— **仅降级路径**（LIS 熔断/不可达/LLM_FALLBACK）
  //   3. 场景默认意图
  //
  // 意图识别的权威源已统一为 LIS：它做扁平全局向量+规则比较，
  // 而 scene-router 的 infer_intent 是「先选技能、再在技能内选意图」的两级
  // 关键词匹配，各技能词表互不比较，跨技能关键词冲突会被长期隐藏
  // （实测 '工单详情' 同时登记在 service_quality_eval.complaint 与
  // dispatch_detail 名下，仅靠文件求值顺序才没出错）。
  //
  // 但不能直接删掉 infer_intent：LIS 熔断或不可达时 identifyScene 仍会被调用，
  // 实测有 78 个意图只能由它产出，全删会让这些请求统一退化成场景默认意图
  // （如所有派单细分问法都渲染成 dispatch_list）。因此保留为降级兜底。
  //
  // 本函数保留的**技能级执行契约**（actions_allowed / required_data /
  // required_knowledge / followup_policy）与意图识别无关，始终由规则集提供。
  const requestIntent = input?.intent || input?.intent_context?.intent;
  let intent = requestIntent;
  if (!intent && typeof ruleSet.infer_intent === 'function') {
    intent = ruleSet.infer_intent(input);
  }
  intent = intent || ruleSet.default_intent;

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
