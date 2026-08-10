import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadActionResourceMap,
  getActionResource,
  SPECIAL_CASE_ACTION_KEYS,
} from '../src/core/actions/fallback-prompt-builder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mapPath = path.join(__dirname, '..', 'src', 'core', 'actions', 'action-resource-map.json');

test('action-resource-map loads built-in travel and meal actions', () => {
  const map = loadActionResourceMap();
  assert.ok(Array.isArray(map.actions) && map.actions.length > 0);
  const keys = map.actions.map((a) => a.action_key);
  assert.ok(keys.includes('travel_route.calculate_budget'));
  assert.ok(keys.includes('travel_route.check_availability'));
  assert.ok(keys.includes('travel_route.check_accessibility'));
  assert.ok(keys.includes('travel_route.check_policy_subsidy'));
  assert.ok(keys.includes('meal_plan.check_risk'));
});

test('action-resource-map actions include endpoint and param_sources', () => {
  const map = loadActionResourceMap();
  for (const action of map.actions) {
    assert.ok(action.endpoint, `${action.action_key} missing endpoint`);
    assert.ok(action.param_sources, `${action.action_key} missing param_sources`);
  }
});

test('action-resource-map can load a custom path', () => {
  const map = loadActionResourceMap(mapPath);
  assert.ok(map.actions.length > 0);
});

test('getActionResource returns exact action', () => {
  const map = loadActionResourceMap();
  const budget = getActionResource('travel_route.calculate_budget', map);
  assert.ok(budget);
  assert.equal(budget.target, 'bff');
  assert.equal(budget.next_template_id, 'route_card');
  assert.ok(budget.params_schema && budget.params_schema.destination);
  assert.ok(budget.param_sources && budget.param_sources.destination);

  const availability = getActionResource('travel_route.check_availability', map);
  assert.ok(availability);
  assert.equal(availability.target, 'jintiaodong');
  assert.equal(availability.next_template_id, 'travel_availability_card');
});

test('getActionResource returns null for unknown action with default map', () => {
  assert.equal(getActionResource('not_exist.action_key'), null);
  assert.ok(getActionResource('meal_plan.check_risk'));
});

test('SPECIAL_CASE_ACTION_KEYS bypass generic fallback for deterministic actions', () => {
  assert.deepEqual(SPECIAL_CASE_ACTION_KEYS, [
    'travel_route.check_weather_risk',
    'travel_route.check_availability',
  ]);
});
