import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identifyMealPlanScene,
  identifyScene,
  scoreRuleSet,
} from '../src/core/scene-router/index.js';

test('high confidence diabetes breakfast is accepted', () => {
  const result = identifyMealPlanScene({
    text: '请给糖尿病老人推荐明天早餐，低糖一点，适合老年人吃的营养餐',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'meal_plan');
  assert.equal(result.intent, 'meal_plan_breakfast_advice');
  assert.equal(result.decision, 'accept');
  assert.ok(result.confidence >= 0.85);
  assert.ok(result.template_candidates.includes('diet_card'));
});

test('context continuation is accepted', () => {
  const result = identifyMealPlanScene({
    text: '这份换成低糖版，明天继续推荐',
    previous_scene: 'meal_plan',
  });

  assert.equal(result.decision, 'accept');
  assert.equal(result.scene_key, 'meal_plan');
  assert.ok(result.evidence.boosts.some((item) => item.group === 'context_continuation'));
});

test('dispatch request is rejected with dispatch conflict', () => {
  const result = identifyMealPlanScene('帮我催一下派单工单处理进度');

  assert.equal(result.decision, 'reject');
  assert.ok(result.evidence.conflicts.some((item) => item.group === 'dispatch_manage'));
});

test('identifyScene returns meal_plan for hypertension dinner recommendation', () => {
  const result = identifyScene('高血压老人晚餐推荐');

  assert.equal(result.scene_key, 'meal_plan');
  assert.equal(result.intent, 'meal_plan_dinner_advice');
  assert.equal(result.decision, 'accept');
  assert.ok(result.candidates.some((candidate) => candidate.scene_key === 'meal_plan'));
  assert.ok(result.margin > 0);
});

test('empty input rejects', () => {
  const result = identifyMealPlanScene('');

  assert.equal(result.decision, 'reject');
  assert.equal(result.confidence, 0);
  assert.equal(result.positive_score, 0);
});

test('low unrelated input rejects', () => {
  const result = identifyMealPlanScene('今天社区活动几点开始');

  assert.equal(result.decision, 'reject');
  assert.equal(result.scene_key, 'meal_plan');
  assert.ok(result.confidence < 0.55);
});

test('exact accept threshold is accepted', () => {
  const result = scoreRuleSet('alpha', {
    scene_key: 'boundary_accept',
    default_intent: 'boundary_accept',
    threshold: 20,
    evidence_groups: [{ group: 'only', weight: 17, terms: ['alpha'] }],
  });

  assert.equal(result.confidence, 0.85);
  assert.equal(result.decision, 'accept');
});

test('exact review threshold is reviewed', () => {
  const result = scoreRuleSet('alpha', {
    scene_key: 'boundary_review',
    default_intent: 'boundary_review',
    threshold: 20,
    evidence_groups: [{ group: 'only', weight: 11, terms: ['alpha'] }],
  });

  assert.equal(result.confidence, 0.55);
  assert.equal(result.decision, 'review');
});

test('exact margin routes with two rule sets', () => {
  const firstRuleSet = {
    scene_key: 'first',
    default_intent: 'first',
    threshold: 10,
    evidence_groups: [{ group: 'first_match', weight: 10, terms: ['route'] }],
  };
  const secondRuleSet = {
    scene_key: 'second',
    default_intent: 'second',
    threshold: 10,
    evidence_groups: [{ group: 'second_match', weight: 8, terms: ['route'] }],
  };

  const result = identifyScene('route', {
    ruleSets: [firstRuleSet, secondRuleSet],
    thresholds: { margin: 0.2 },
  });

  assert.equal(result.scene_key, 'first');
  assert.equal(result.candidates[0].confidence, 1);
  assert.equal(result.candidates[1].confidence, 0.8);
  assert.ok(result.margin < 0.2);
  assert.equal(result.routed, true);
});

test('role boost does not stack across role fields', () => {
  const result = identifyMealPlanScene({
    text: '老人早餐推荐',
    role: 'elder',
    user_role: 'family',
    context: { role: 'care_doctor' },
  });

  const roleBoosts = result.evidence.boosts.filter((item) => item.group === 'role_boost');
  assert.equal(roleBoosts.length, 1);
  assert.equal(result.positive_score, 8);
  assert.equal(result.decision, 'review');
});

test('threshold overrides change decision boundaries', () => {
  const input = '老人早餐营养餐推荐';

  assert.equal(identifyMealPlanScene(input).decision, 'accept');
  assert.equal(identifyMealPlanScene(input, { thresholds: { accept: 1.01 } }).decision, 'review');
});

test('acute health conflict is applied to otherwise high-positive meal request', () => {
  const text = '糖尿病高血压老人明天早餐晚餐一周营养餐推荐';
  const baseline = identifyMealPlanScene({
    text,
    role: 'elder_family',
  });
  const result = identifyMealPlanScene({
    text: `${text}，但现在胸痛呼吸困难`,
    role: 'elder_family',
  });

  assert.equal(result.conflict_penalty, 3.5);
  assert.ok(result.evidence.conflicts.some((item) => item.group === 'acute_health_risk'));
  assert.ok(result.confidence < baseline.confidence);
  assert.equal(result.decision, 'accept');
});

test('today meal shortcut is accepted as meal_plan', () => {
  const result = identifyScene({
    text: '推荐今日膳食',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'meal_plan');
  assert.equal(result.decision, 'accept');
  assert.ok(result.confidence >= 0.85);
});
