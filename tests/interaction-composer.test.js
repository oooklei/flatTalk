import test from 'node:test';
import assert from 'node:assert/strict';

import { composeInteractions } from '../src/core/interaction-composer.js';

test('composeInteractions filters invalid compact followups before rendering', () => {
  const result = composeInteractions({
    sceneDecision: {
      scene_key: 'travel_route',
      decision: 'accept',
      actions_allowed: ['travel_route.*'],
      followup_policy: 'none',
    },
    modelResult: {
      actions: [
        { action_key: 'travel_route.check_weather_risk', label: '查天气风险' },
        { action_key: 'travel_route.calculate_budget', label: '测算预算' },
      ],
      compact_followups: [
        { label: '', action_key: 'travel_route.check_weather_risk' },
        { label: '&nbsp;', action_key: 'travel_route.check_policy_subsidy' },
        { label: '缺少动作' },
        { label: '查天气风险', action_key: 'travel_route.check_weather_risk' },
      ],
      followup_suggestions: [],
    },
  });

  assert.deepEqual(result.compact_followups.map((item) => item.label), ['查看天气风险', '查询政策补贴', '查看天气风险']);
  assert.equal(result.compact_followups.some((item) => item.label === item.action_key), false);
  assert.equal(result.actions.some((item) => item.action_key === 'travel_route.check_weather_risk'), false);
  assert.equal(result.actions.some((item) => item.action_key === 'travel_route.calculate_budget'), true);
});

test('composeInteractions localizes raw action keys in actions and followups', () => {
  const result = composeInteractions({
    sceneDecision: {
      scene_key: 'meal_plan',
      decision: 'accept',
      actions_allowed: ['meal_plan.*'],
      followup_policy: 'none',
    },
    modelResult: {
      actions: [
        { action_key: 'meal_plan.daily_diet', label: 'meal_plan.daily_diet' },
      ],
      followup_suggestions: [
        {
          label: 'meal_plan.adjust_for_condition',
          user_prompt: 'meal_plan.adjust_for_condition',
          action_key: 'meal_plan.adjust_for_condition',
        },
      ],
    },
  });

  assert.equal(result.actions[0].label, '今日三餐');
  assert.equal(result.actions[0].user_prompt, '今日三餐');
  assert.equal(result.followup_suggestions.some((item) => item.label === 'meal_plan.adjust_for_condition'), false);
  assert.ok(result.followup_suggestions.some((item) => item.action_key === 'meal_plan.adjust_for_condition' && item.label !== item.action_key));
});
