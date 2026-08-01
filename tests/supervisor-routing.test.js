import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupervisor } from '../src/core/agents/supervisor.js';

function makeSupervisor() { return createSupervisor(); }

test('supervisor routes by action_key prefix (deterministic)', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({ message: '', context: { action_key: 'meal_plan.adjust_for_condition' } });
  assert.equal(result.agentKey, 'meal_plan');
  assert.equal(result.switched, false);
});

test('supervisor routes travel_route action_key', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({ message: '', context: { action_key: 'travel_route.check_weather_risk' } });
  assert.equal(result.agentKey, 'travel_route');
});

test('supervisor routes nearby_resource action_key', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({ message: '', context: { action_key: 'nearby_resource.leisure' } });
  assert.equal(result.agentKey, 'nearby_resource');
});

test('supervisor stays in active_agent when canHandle returns true', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({ message: '换成软烂版', context: { active_agent: 'meal_plan', last_template: 'diet_card' } });
  assert.equal(result.agentKey, 'meal_plan');
  assert.equal(result.switched, false);
});

test('supervisor switches when active_agent canHandle returns suggest', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({ message: '我想了解旅居路线', context: { active_agent: 'meal_plan', last_template: 'diet_card' } });
  assert.equal(result.agentKey, 'travel_route');
  assert.equal(result.switched, true);
  assert.equal(result.from, 'meal_plan');
});

test('supervisor routes by keyword when no active_agent', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({ message: '今天膳食吃什么', context: {} });
  assert.equal(result.agentKey, 'meal_plan');
});

test('supervisor falls back to common for unknown', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({ message: '你好', context: {} });
  assert.equal(result.agentKey, 'common');
});

test('supervisor SOS bypass routes to health_risk', async () => {
  const supervisor = makeSupervisor();
  const result = await supervisor.route({ message: '老人胸痛昏迷了', context: {} });
  assert.equal(result.agentKey, 'health_risk_warning');
  assert.equal(result.emergency, true);
});
