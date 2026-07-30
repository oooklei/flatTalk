import test from 'node:test';
import assert from 'node:assert/strict';

import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';

test('runs travel_route template-card flow from skill templates directory', async () => {
  const result = await runLocalSkill({
    conversation_id: 'conv_travel_1',
    turn_id: 'turn_travel_1',
    message: '帮老人规划广西巴马康养旅居路线',
    role: 'elder_family',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skill_key, 'travel_route');
  assert.equal(result.template_id, 'route_card');
  assert.equal(result.card.templateId, 'route_card');
  assert.ok(result.card.pages[0].includes('<!doctype html>'));
  assert.ok(result.rendered_html.includes('gxy-html-fallback'));
  assert.ok(result.actions.some((action) => action.action_key === 'travel_route.check_availability'));
});

test('travel route action re-enters server skill path', async () => {
  const result = await runLocalSkill({
    conversation_id: 'conv_travel_2',
    turn_id: 'turn_travel_2',
    skill_key: 'travel_route',
    message: '对比广西巴马和北海老人旅居路线',
    role: 'elder_family',
    context: { action_key: 'travel_route.compare_destinations' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skill_key, 'travel_route');
  assert.equal(result.template_id, 'route_card');
});
