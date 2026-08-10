import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';
import { identifyScene } from '../src/core/scene-router/index.js';
import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';

test('forced skill_key=common does not block meal_plan routing', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'answer',
        answer_text: '回答',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });

  const result = await orchestrator.run({
    message: '帮我推荐老人一周食谱',
    skill_key: 'common',
    conversation_id: 'test-guard-1',
    turn_id: 'turn-guard-1',
    context: {},
  });

  assert.notEqual(result.skill_key, 'common', 'should not force to common when input clearly matches meal_plan');
});

test('forced skill_key=meal_plan stays meal_plan for meal query', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'diet_card',
        answer_text: '食谱推荐',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });

  const result = await orchestrator.run({
    message: '老人吃什么比较好',
    skill_key: 'meal_plan',
    conversation_id: 'test-guard-2',
    turn_id: 'turn-guard-2',
    context: {},
  });

  assert.equal(result.skill_key, 'meal_plan', 'should keep meal_plan for meal query');
});

test('service quality report intent can leave travel route context', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'institution_quality_report',
        answer_text: '服务质量评估报告',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });

  const result = await orchestrator.run({
    message: '查看桂林夕阳红养老服务中心本月的服务质量评估报告',
    conversation_id: 'test-guard-3',
    turn_id: 'turn-guard-3',
    context: {
      active_agent: 'travel_route',
      previous_scene: 'travel_route',
      previous_template: 'route_card',
    },
  });

  assert.equal(result.skill_key, 'service_quality_eval');
  assert.equal(result.agent_key, 'service_quality_eval');
  assert.equal(result.template_id, 'institution_quality_report');
  assert.notEqual(result.skill_key, 'travel_route');
  assert.notEqual(result.skill_key, 'health_risk_warning');
});

test('service quality report beats generic health report wording', () => {
  const result = identifyScene({
    text: '查看桂林夕阳红养老服务中心本月的服务质量评估报告',
    role: 'elder_family',
  });

  assert.equal(result.scene_key, 'service_quality_eval');
  assert.equal(result.intent, 'service_quality_eval.report');
  assert.equal(result.decision, 'accept');
});

test('final agent key follows accepted scene, not stale supervisor guess', async () => {
  const result = await runLocalSkill({
    message: '查看桂林夕阳红养老服务中心本月的服务质量评估报告',
    role: 'elder_family',
  });

  assert.equal(result.skill_key, 'service_quality_eval');
  assert.equal(result.agent_key, 'service_quality_eval');
});
