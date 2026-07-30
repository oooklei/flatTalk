import test from 'node:test';
import assert from 'node:assert/strict';

import { identifyScene } from '../src/core/scene-router/index.js';

test('health risk warning by blood pressure alert is accepted as health_risk_warning', () => {
  const result = identifyScene({
    message: '老人最近血压偏高，帮我做健康风险预警',
    role: 'care_worker',
  });

  assert.equal(result.scene_key, 'health_risk_warning');
  assert.equal(result.intent, 'health_risk_warning.assess');
  assert.equal(result.decision, 'accept');
  assert.ok(result.required_knowledge.includes('health_risk_warning'));
});

test('health risk warning by remote metric gap is accepted as health_risk_warning', () => {
  const result = identifyScene({
    message: '老人血糖波动大，想看看风险等级和命中的规则',
    role: 'village_doctor',
  });

  assert.equal(result.scene_key, 'health_risk_warning');
  assert.equal(result.decision, 'accept');
  // 含“规则/命中”时意图推断为 rule_detail（符合 infer_intent 设计）
  assert.equal(result.intent, 'health_risk_warning.rule_detail');
  assert.ok(result.required_knowledge.includes('health_risk_warning'));
});

test('fall detection risk is accepted as health_risk_warning', () => {
  const result = identifyScene({
    message: '老人夜里多次离床，有跌倒风险，需要预警研判',
    role: 'care_worker',
  });

  assert.equal(result.scene_key, 'health_risk_warning');
  assert.equal(result.decision, 'accept');
});

test('health risk context continuation is accepted', () => {
  const result = identifyScene({
    message: '再看看设备信号明细和规则命中',
    role: 'care_worker',
    context: { previous_scene: 'health_risk_warning' },
  });

  assert.equal(result.scene_key, 'health_risk_warning');
  assert.equal(result.decision, 'accept');
  assert.ok(result.evidence.boosts.some((item) => item.group === 'context_continuation'));
});

test('health risk warning wins over meal_plan conflict when alert terms present', () => {
  const result = identifyScene({
    message: '老人有糖尿病又血压偏高，需要健康风险预警',
    role: 'care_worker',
  });

  assert.equal(result.scene_key, 'health_risk_warning');
});

test('pure meal request is still routed to meal_plan', () => {
  const result = identifyScene({
    message: '给老人推荐今日控糖低盐晚餐',
    role: 'care_worker',
  });

  assert.equal(result.scene_key, 'meal_plan');
});
