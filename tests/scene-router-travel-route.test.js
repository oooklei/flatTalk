import test from 'node:test';
import assert from 'node:assert/strict';

import { identifyScene } from '../src/core/scene-router/index.js';

test('travel route recommendation is accepted as travel_route', () => {
  const result = identifyScene({
    message: '帮爸妈规划广西巴马康养旅居路线，预算舒适一点',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'travel_route');
  assert.equal(result.intent, 'travel_route_budget');
  assert.equal(result.decision, 'accept');
});

test('baise bama route request is accepted as travel_route', () => {
  const result = identifyScene({
    message: '我想去百色巴马旅居，请帮规划路线',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'travel_route');
  assert.equal(result.intent, 'travel_route_plan');
  assert.equal(result.decision, 'accept');
  assert.equal(result.routed, true);
});

test('baise bama tourism route request is accepted as travel_route', () => {
  const result = identifyScene({
    message: '\u6211\u60f3\u53bb\u767e\u8272\u5df4\u9a6c\u65c5\u6e38\uff0c\u8bf7\u5e2e\u89c4\u5212\u8def\u7ebf',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'travel_route');
  assert.equal(result.intent, 'travel_route_plan');
  assert.equal(result.decision, 'accept');
  assert.equal(result.routed, true);
});

test('short baise travel route reference is accepted as travel_route', () => {
  const result = identifyScene({
    message: '\u767e\u8272\u65c5\u884c\u8def\u7ebf\u53c2\u8003',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'travel_route');
  assert.equal(result.intent, 'travel_route_plan');
  assert.equal(result.decision, 'accept');
  assert.equal(result.routed, true);
});

test('short generic travel planning request is accepted as travel_route', () => {
  const result = identifyScene({
    message: '\u5e2e\u6211\u89c4\u5212\u65c5\u5c45\u8def\u7ebf',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'travel_route');
  assert.equal(result.intent, 'travel_route_plan');
  assert.equal(result.decision, 'accept');
  assert.equal(result.routed, true);
});

test('plain baise tourist spot question stays below travel route accept threshold', () => {
  const result = identifyScene({
    message: '\u767e\u8272\u6709\u54ea\u4e9b\u65c5\u6e38\u666f\u70b9\uff1f',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'travel_route');
  assert.notEqual(result.decision, 'accept');
  assert.equal(result.routed, false);
});

test('travel route context continuation is accepted', () => {
  const result = identifyScene({
    message: '换成北海路线，再看下交通',
    role: 'elder_family',
    context: { previous_scene: 'travel_route' },
  });

  assert.equal(result.scene_key, 'travel_route');
  assert.equal(result.decision, 'accept');
  assert.ok(result.evidence.boosts.some((item) => item.group === 'context_continuation'));
});

test('meal request wins over travel route conflict', () => {
  const result = identifyScene({
    message: '给老人推荐今日低盐晚餐',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'meal_plan');
});
