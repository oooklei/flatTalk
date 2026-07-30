import test from 'node:test';
import assert from 'node:assert/strict';

import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';

test('runs health_risk_warning template-card flow from skill templates directory', async () => {
  const result = await runLocalSkill({
    conversation_id: 'conv_health_1',
    turn_id: 'turn_health_1',
    message: '老人最近血压偏高，帮我做健康风险预警',
    role: 'care_worker',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skill_key, 'health_risk_warning');
  assert.equal(result.template_id, 'health_warning_card');
  assert.equal(result.card.templateId, 'health_warning_card');
  assert.ok(result.card.pages[0].includes('<!doctype html>'));
  assert.ok(result.rendered_html.includes('health-warning-card'));
  assert.ok(result.actions.some((action) => action.action_key === 'health_risk_warning.refresh_signals'));
  assert.ok(result.actions.some((action) => action.action_key === 'health_risk_warning.request_manual_review'));
});

test('health risk warning signal card renders via template_id', async () => {
  const result = await runLocalSkill({
    conversation_id: 'conv_health_2',
    turn_id: 'turn_health_2',
    skill_key: 'health_risk_warning',
    template_id: 'health_risk_signal_card',
    message: '重新读取老人设备信号',
    role: 'care_worker',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skill_key, 'health_risk_warning');
  assert.equal(result.template_id, 'health_risk_signal_card');
  assert.ok(result.rendered_html.includes('health-risk-signal-card'));
});

test('fall detection routes to urgent health risk warning card', async () => {
  const result = await runLocalSkill({
    conversation_id: 'conv_health_3',
    turn_id: 'turn_health_3',
    message: '老人夜里多次离床，有跌倒风险，需要预警研判',
    role: 'village_doctor',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skill_key, 'health_risk_warning');
  assert.equal(result.template_id, 'health_warning_card');
  assert.ok(result.rendered_html.includes('紧急') || result.rendered_html.includes('关注'));
});
