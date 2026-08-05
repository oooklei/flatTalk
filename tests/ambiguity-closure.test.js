import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';
import { resolveAmbiguity } from '../src/core/scene-router/ambiguity-resolver.js';

test('resolveAmbiguity options expose skill_key for client round-trip', () => {
  const r = resolveAmbiguity([
    { scene_key: 'travel_route', confidence: 0.7 },
    { scene_key: 'health_risk_warning', confidence: 0.68 },
  ], { message: '不太确定' });
  assert.equal(r.ambiguity_options[0].skill_key, 'travel_route');
  assert.equal(r.ambiguity_options[1].skill_key, 'health_risk_warning');
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
});
