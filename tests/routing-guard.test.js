import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';

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
