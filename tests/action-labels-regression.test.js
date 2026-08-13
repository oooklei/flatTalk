import test from 'node:test';
import assert from 'node:assert/strict';

import { labelForActionKey, normalizeActionDisplayItem } from '../src/core/actions/action-labels.js';
import { renderCompactFollowups, normalizeCompactFollowups } from '../src/core/compact-followups/renderer.js';
import { composeInteractions } from '../src/core/interaction-composer.js';

const ADJUST_KEY = 'meal_plan.adjust_for_condition';
const ADJUST_LABEL = '\u6309\u5065\u5eb7\u72b6\u51b5\u8c03\u6574';

test('action labels never expose meal plan action_key as visible text', () => {
  assert.equal(labelForActionKey(ADJUST_KEY, ADJUST_KEY), ADJUST_LABEL);

  const item = normalizeActionDisplayItem({
    action_key: ADJUST_KEY,
    label: ADJUST_KEY,
    user_prompt: ADJUST_KEY,
  });

  assert.equal(item.label, ADJUST_LABEL);
  assert.equal(item.user_prompt, ADJUST_LABEL);
});

test('compact followups render Chinese labels when model only returns action_key', () => {
  const normalized = normalizeCompactFollowups([{ action_key: ADJUST_KEY, label: ADJUST_KEY }]);
  assert.equal(normalized[0].label, ADJUST_LABEL);
  assert.equal(normalized[0].user_prompt, ADJUST_LABEL);

  const html = renderCompactFollowups([{ action_key: ADJUST_KEY, label: ADJUST_KEY }]);
  assert.ok(html.includes(ADJUST_LABEL));
  assert.equal(html.includes(`>${ADJUST_KEY}<`), false);
});

test('composeInteractions normalizes actions and followups before returning', () => {
  const result = composeInteractions({
    sceneDecision: {
      scene_key: 'meal_plan',
      decision: 'accept',
      actions_allowed: ['meal_plan.*'],
    },
    modelResult: {
      actions: [{ action_key: ADJUST_KEY, label: ADJUST_KEY }],
      followup_suggestions: [{ action_key: ADJUST_KEY, label: ADJUST_KEY, user_prompt: ADJUST_KEY }],
      compact_followups: [{ action_key: 'meal_plan.daily_diet', label: 'meal_plan.daily_diet' }],
    },
  });

  const visibleTexts = [
    ...result.actions.map((item) => item.label),
    ...result.followup_suggestions.map((item) => item.label),
    ...result.followup_suggestions.map((item) => item.user_prompt),
    ...result.compact_followups.map((item) => item.label),
  ];

  assert.equal(visibleTexts.includes(ADJUST_KEY), false);
  assert.ok(visibleTexts.includes(ADJUST_LABEL));
});
