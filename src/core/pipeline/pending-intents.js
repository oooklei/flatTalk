/** skill_key → 中文短标签（追问按钮文案） */
const SKILL_LABELS = {
  meal_plan: '膳食食谱',
  travel_route: '旅居线路',
  nearby_resource: '附近资源',
};

/**
 * Map pending_intents from TurnExtractor into followup button-shaped objects.
 * @param {Array<{ skill_key?: string, utterance?: string, text?: string }>} pendingIntents
 * @returns {Array<{ label: string, message: string, user_prompt: string, skill_key: string, source: string }>}
 */
export function buildPendingFollowups(pendingIntents = []) {
  if (!Array.isArray(pendingIntents) || !pendingIntents.length) return [];

  const seen = new Set();
  const out = [];
  for (const intent of pendingIntents) {
    const skillKey = String(intent?.skill_key || intent?.skillKey || '').trim();
    if (!skillKey || seen.has(skillKey)) continue;
    seen.add(skillKey);

    const name = SKILL_LABELS[skillKey] || skillKey;
    const message = String(intent?.utterance || intent?.text || name).trim() || name;
    out.push({
      label: `还要继续：${name}？`,
      message,
      user_prompt: message,
      skill_key: skillKey,
      source: 'pending_intent',
    });
  }
  return out;
}

/**
 * Append pending followups into existing arrays without breaking composeInteractions output.
 * Only mutates keys that are already arrays.
 */
export function mergePendingIntoInteractions(interactions = {}, pendingIntents = []) {
  const extras = buildPendingFollowups(pendingIntents);
  if (!extras.length || !interactions || typeof interactions !== 'object') {
    return interactions;
  }

  const next = { ...interactions };
  if (Array.isArray(next.followup_suggestions)) {
    const existingLabels = new Set(
      next.followup_suggestions.map((f) => String(f?.label || '').trim()).filter(Boolean),
    );
    next.followup_suggestions = [
      ...next.followup_suggestions,
      ...extras.filter((e) => !existingLabels.has(e.label)),
    ];
  }
  if (Array.isArray(next.compact_followups)) {
    const existingLabels = new Set(
      next.compact_followups.map((f) => String(f?.label || '').trim()).filter(Boolean),
    );
    next.compact_followups = [
      ...next.compact_followups,
      ...extras.filter((e) => !existingLabels.has(e.label)),
    ];
  }
  return next;
}
