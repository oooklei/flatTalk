import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/core/conversation/session-store.js';

function makeMemoryStateStore() {
  const store = new Map();
  return {
    async getJson(key) { return store.get(key) || null; },
    async setJson(key, val, _opts) { store.set(key, val); return val; },
    async listJson(key) { return store.get(key) || []; },
    async pushJson(key, val) { const arr = store.get(key) || []; arr.push(val); store.set(key, arr); return arr; },
  };
}

test('SessionStore initializes with agents structure', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  const session = await ss.getOrCreate('conv-1');
  assert.ok(session.agents);
  assert.equal(typeof session.agents, 'object');
});

test('SessionStore appendTurn writes to correct agent bucket', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  await ss.appendTurn('conv-1', {
    turn_id: 't1', user_message: '今天吃什么',
    envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' },
  });
  const session = await ss.getOrCreate('conv-1');
  assert.ok(session.agents.meal_plan);
  assert.equal(session.agents.meal_plan.turns.length, 1);
  assert.equal(session.agents.meal_plan.last_template, 'diet_card');
});

test('SessionStore isolates turns between agents', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  await ss.appendTurn('conv-1', { turn_id: 't1', user_message: '膳食推荐', envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' } });
  await ss.appendTurn('conv-1', { turn_id: 't2', user_message: '旅居路线', envelope: { skill_key: 'travel_route', template_id: 'travel_itinerary_card', agent_key: 'travel_route' } });
  await ss.appendTurn('conv-1', { turn_id: 't3', user_message: '换成软烂版', envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' } });
  const session = await ss.getOrCreate('conv-1');
  assert.equal(session.agents.meal_plan.turns.length, 2);
  assert.equal(session.agents.travel_route.turns.length, 1);
  assert.equal(session.active_agent, 'meal_plan');
});

test('SessionStore getAgentContext returns agent state', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  await ss.appendTurn('conv-1', { turn_id: 't1', user_message: '膳食', envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' } });
  const ctx = await ss.getAgentContext('conv-1', 'meal_plan');
  assert.ok(ctx);
  assert.equal(ctx.turns.length, 1);
  assert.equal(ctx.last_template, 'diet_card');
  assert.equal(ctx.frozen, false);
});

test('SessionStore getPreviousTurn respects active_agent', async () => {
  const ss = new SessionStore({ stateStore: makeMemoryStateStore() });
  await ss.appendTurn('conv-1', { turn_id: 't1', user_message: '膳食', envelope: { skill_key: 'meal_plan', template_id: 'diet_card', agent_key: 'meal_plan' } });
  await ss.appendTurn('conv-1', { turn_id: 't2', user_message: '旅居', envelope: { skill_key: 'travel_route', template_id: 'travel_itinerary_card', agent_key: 'travel_route' } });
  const prev = await ss.getPreviousTurn('conv-1');
  assert.equal(prev.turn_id, 't2');
});
