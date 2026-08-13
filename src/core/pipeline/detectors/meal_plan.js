export async function detectMealPlan({ login, turn }) {
  const elderId = login?.elder_binding?.elder_id || '';
  if (!elderId) {
    return { ok: false, skipped: false, clarify: 'which_elder', resources: {}, skill_key: 'meal_plan' };
  }
  return {
    ok: true,
    resources: {
      elder_id: elderId,
      diet_tags: (login.tags || []).map((t) => t.tag_code || t).filter(Boolean),
    },
    skill_key: 'meal_plan',
  };
}
