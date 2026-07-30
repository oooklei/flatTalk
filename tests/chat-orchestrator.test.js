import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';

test('chat orchestrator runs the main meal plan chain with injected services', async () => {
  const calls = { data: 0, rag: 0, model: 0 };
  const orchestrator = createChatOrchestrator({
    dataService: {
      tableData: {
        getMealPlanTables: async ({ elder_id }) => {
          calls.data += 1;
          return { elder_id, items: ['oatmeal', 'egg'] };
        },
      },
      knowledgeData: {},
    },
    ragService: {
      retrieveKnowledge: async (request) => {
        calls.rag += 1;
        assert.equal(request.skill_key, 'meal_plan');
        return {
          source: 'test',
          status: 'hit',
          matches: [{ chunk_id: 'k1', text: 'diabetes breakfast should control sugar' }],
        };
      },
    },
    modelService: {
      fillTemplateSlots: async (input) => {
        calls.model += 1;
        assert.equal(input.skill_key, 'meal_plan');
        assert.equal(input.business_data.elder_id, 'elder_1');
        assert.equal(input.evidence[0].chunk_id, 'k1');
        return {
          template_id: 'diet_card',
          answer_text: 'Breakfast plan ready',
          data: {
            dateBadge: 'Today',
            suitable: 'Diabetes elder',
            totalCal: '300kcal',
            salt: 'low',
            meals: [{
              mealName: 'Breakfast',
              mealEmoji: 'B',
              mealTotal: '300kcal',
              foods: [{ foodName: 'oatmeal', foodIcon: 'O', cal: '180', calNote: 'kcal' }],
            }],
          },
          actions: [],
          followup_suggestions: [],
        };
      },
    },
  });

  const result = await orchestrator.run({
    request_id: 'req_orch_1',
    conversation_id: 'conv_orch_1',
    turn_id: 'turn_orch_1',
    skill_key: 'meal_plan',
    message: 'diabetes breakfast meal plan',
    role: 'elder_family',
    elder_id: 'elder_1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skill_key, 'meal_plan');
  assert.equal(result.template_id, 'diet_card');
  assert.equal(result.route.source, 'flatTalk.chat_orchestrator');
  assert.deepEqual(calls, { data: 1, rag: 1, model: 1 });
});
