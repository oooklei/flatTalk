import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRegistry } from '../src/core/agents/agent-registry.js';
import { createBaseAgent } from '../src/core/agents/base-agent.js';

test('createAgentRegistry registers and retrieves agents', () => {
  const registry = createAgentRegistry();
  const mockAgent = { key: 'meal_plan', name: '膳食助手', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) };
  registry.register(mockAgent);
  assert.equal(registry.get('meal_plan'), mockAgent);
});

test('createAgentRegistry list returns all registered agents', () => {
  const registry = createAgentRegistry();
  registry.register({ key: 'meal_plan', name: 'A', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) });
  registry.register({ key: 'common', name: 'B', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) });
  const all = registry.list();
  assert.equal(all.length, 2);
});

test('createAgentRegistry returns undefined for unknown agent', () => {
  const registry = createAgentRegistry();
  assert.equal(registry.get('nonexistent'), undefined);
});

test('createAgentRegistry findByActionPrefix matches action_key prefixes', () => {
  const registry = createAgentRegistry();
  registry.register({ key: 'meal_plan', name: 'A', actionPrefix: 'meal_plan', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) });
  registry.register({ key: 'travel_route', name: 'B', actionPrefix: 'travel_route', matchScore: () => 0, canHandle: () => true, handle: async () => ({}) });
  assert.equal(registry.findByActionPrefix('meal_plan.adjust_for_condition')?.key, 'meal_plan');
  assert.equal(registry.findByActionPrefix('travel_route.check_weather_risk')?.key, 'travel_route');
  assert.equal(registry.findByActionPrefix('unknown.action'), undefined);
});

test('createBaseAgent matchScore returns 0 for empty keyword config', () => {
  const agent = createBaseAgent({ key: 'test', name: 'Test' });
  assert.equal(agent.matchScore('任意消息'), 0);
});

test('createBaseAgent matchScore returns positive score for keyword hit', () => {
  const agent = createBaseAgent({ key: 'test', name: 'Test', keywords: ['膳食', '饮食', '吃饭'] });
  assert.ok(agent.matchScore('今天膳食吃什么') > 0);
  assert.equal(agent.matchScore('今天天气不错'), 0);
});

test('createBaseAgent matchScore weights evidence groups correctly', () => {
  const agent = createBaseAgent({
    key: 'test', name: 'Test', threshold: 5,
    evidenceGroups: [
      { group: 'topic', weight: 3, terms: ['膳食', '饮食'] },
      { group: 'time', weight: 2, terms: ['早餐', '午餐'] },
    ],
  });
  const score1 = agent.matchScore('膳食安排');
  const score2 = agent.matchScore('早餐安排');
  assert.ok(score1 > score2, `topic score ${score1} should be > time score ${score2}`);
});

test('createBaseAgent canHandle returns true when keywords match', () => {
  const agent = createBaseAgent({ key: 'test', name: 'Test', keywords: ['膳食', '饮食'], boundaryTerms: ['旅居', '护工'] });
  assert.equal(agent.canHandle('今天膳食吃什么', {}), true);
});

test('createBaseAgent canHandle returns suggest when boundary term hit', () => {
  const agent = createBaseAgent({
    key: 'test', name: 'Test', keywords: ['膳食'],
    boundaryTerms: ['旅居', '护工'], boundaryMap: { '旅居': 'travel_route', '护工': 'find_service' },
  });
  const result = agent.canHandle('我想了解旅居', {});
  assert.deepEqual(result, { suggest: 'travel_route', reason: '旅居' });
});
