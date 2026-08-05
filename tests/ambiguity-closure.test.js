import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';
import { resolveAmbiguity } from '../src/core/scene-router/ambiguity-resolver.js';
import {
  getRecentSceneDecisions,
  _resetDecisionLogForTests,
} from '../src/core/scene-router/decision-log.js';

function makeAmbiguousRule(scene_key, term) {
  return {
    scene_key,
    threshold: 5,
    evidence_groups: [{ group: 'main', weight: 5, terms: [term] }],
    infer_intent: () => `${scene_key}.test`,
    template_candidates: [],
    required_data: [],
    required_knowledge: [],
    actions_allowed: [],
  };
}

test('resolveAmbiguity options expose skill_key for client round-trip', () => {
  const r = resolveAmbiguity([
    { scene_key: 'travel_route', confidence: 0.7 },
    { scene_key: 'health_risk_warning', confidence: 0.68 },
  ], { message: '不太确定' });
  assert.equal(r.ambiguity_options[0].skill_key, 'travel_route');
  assert.equal(r.ambiguity_options[1].skill_key, 'health_risk_warning');
});

test('orchestrator returns ambiguity_options when scenes tie', async () => {
  const orchestrator = createChatOrchestrator({
    intentClassifier: {
      classifyIntent: async () => ({ intent: 'common.chat', confidence: 0.4, source: 'test' }),
    },
    dataService: {
      tableData: { getSkillConfigs: async () => ({}) },
      knowledgeData: {},
    },
    ragService: {
      retrieveKnowledge: async () => ({ source: 'test', status: 'empty', matches: [] }),
    },
    modelService: {
      fillTemplateSlots: async () => ({
        template_id: 'answer',
        answer_text: 'should-not-reach',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
    sceneOptions: {
      ruleSets: [
        makeAmbiguousRule('travel_route', '旅居线路'),
        makeAmbiguousRule('health_risk_warning', '健康风险'),
      ],
      thresholds: { accept: 0.85, review: 0.55, margin: 0.2 },
    },
  });

  const result = await orchestrator.run({
    message: '既要旅居线路又要健康风险',
    conversation_id: 'amb-show-1',
    turn_id: 'amb-show-1-t',
    context: {},
  });

  assert.ok(Array.isArray(result.ambiguity_options), 'should expose ambiguity_options');
  assert.ok(result.ambiguity_options.length >= 2);
  const keys = result.ambiguity_options.map((o) => o.skill_key || o.scene_key);
  assert.ok(keys.includes('travel_route'));
  assert.ok(keys.includes('health_risk_warning'));
  assert.equal(result.route?.decision, 'ambiguous');
  assert.notEqual(result.answer, 'should-not-reach');
});

test('ambiguity_pick hard-locks scene even if label is short', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'answer',
        answer_text: 'ok',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });
  const result = await orchestrator.run({
    message: '旅居规划',
    skill_key: 'travel_route',
    conversation_id: 'amb-1',
    turn_id: 'amb-1-t',
    context: { ambiguity_pick: true },
  });
  assert.equal(result.skill_key, 'travel_route');
});

test('ambiguity_pick hard-locks even when label conflicts with scene', async () => {
  // Adversarial: label suggests health, but pick locks travel_route.
  // Inject services to avoid JTD/network; hard-lock is decided in acceptScene.
  _resetDecisionLogForTests();
  const orchestrator = createChatOrchestrator({
    intentClassifier: {
      classifyIntent: async () => ({ intent: 'common.chat', confidence: 0.5, source: 'test' }),
    },
    dataService: {
      tableData: {
        getTravelRouteTables: async () => ({ routes: [], products: [] }),
        getSkillConfigs: async () => ({}),
      },
      knowledgeData: {},
    },
    ragService: {
      retrieveKnowledge: async () => ({ source: 'test', status: 'empty', matches: [] }),
    },
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'answer',
        answer_text: 'ok',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });
  const result = await orchestrator.run({
    message: '健康预警',
    skill_key: 'travel_route',
    conversation_id: 'amb-2',
    turn_id: 'amb-2-t',
    context: { ambiguity_pick: true, ambiguity_scene_key: 'travel_route' },
  });
  assert.equal(result.skill_key, 'travel_route');
  // Hard-lock sets acceptScene.intent; surfaced on envelope without API expansion
  assert.equal(result.intent, 'travel_route.ambiguity_pick');
  const logs = getRecentSceneDecisions(5);
  const pickLog = logs.find((r) => r.transition_type === 'ambiguity_pick');
  assert.ok(pickLog, 'decision log should record ambiguity_pick');
  assert.equal(pickLog.disambiguation_result, 'travel_route');
  assert.equal(pickLog.final_scene, 'travel_route');
});
