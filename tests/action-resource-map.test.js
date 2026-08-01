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

test('action-resource-map: 默认加载内置清单，含 travel_route/meal_plan 样板', () => {
  const map = loadActionResourceMap();
  assert.ok(Array.isArray(map.actions) && map.actions.length > 0, 'actions 应为非空数组');
  const keys = map.actions.map((a) => a.action_key);
  assert.ok(keys.includes('travel_route.calculate_budget'), '应含 travel_route.calculate_budget');
  assert.ok(keys.includes('travel_route.check_accessibility'), '应含 travel_route.check_accessibility');
  assert.ok(keys.includes('travel_route.check_policy_subsidy'), '应含 travel_route.check_policy_subsidy');
  assert.ok(keys.includes('meal_plan.check_risk'), '应含 meal_plan.check_risk');
});

test('action-resource-map: 每条必含 endpoint / param_sources', () => {
  const map = loadActionResourceMap();
  for (const a of map.actions) {
    assert.ok(a.endpoint, `${a.action_key} 缺 endpoint`);
    assert.ok(a.param_sources, `${a.action_key} 缺 param_sources`);
  }
});

test('action-resource-map: 可通过自定义路径加载', () => {
  const map = loadActionResourceMap(mapPath);
  assert.ok(map.actions.length > 0);
});

test('getActionResource: 精确命中', () => {
  const map = loadActionResourceMap();
  const r = getActionResource('travel_route.calculate_budget', map);
  assert.ok(r);
  assert.equal(r.label, '测算旅居预算');
  assert.equal(r.target, 'bff');
  assert.equal(r.next_template_id, 'route_card');
  assert.ok(r.params_schema && r.params_schema.destination);
  assert.ok(r.param_sources && r.param_sources.destination);
});

test('getActionResource: 缺省用内置 map，找不到返回 null', () => {
  assert.equal(getActionResource('not_exist.action_key'), null);
  assert.ok(getActionResource('meal_plan.check_risk'), '内置 map 应命中 meal_plan.check_risk');
});

test('SPECIAL_CASE_ACTION_KEYS: 初始仅 check_weather_risk', () => {
  assert.deepEqual(SPECIAL_CASE_ACTION_KEYS, ['travel_route.check_weather_risk']);
});
