import test from 'node:test';
import assert from 'node:assert/strict';

import { validateEnvelope } from '../src/contracts/envelope.js';
import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';

test('runs meal_plan template-card flow from skill templates directory', async () => {
  const result = await runLocalSkill({
    request_id: 'req_1',
    conversation_id: 'conv_1',
    turn_id: 'turn_1',
    message: '糖尿病老人早餐怎么吃',
    role: 'elder_family',
    context: {},
  });

  assert.equal(result.schema, 'gxy.envelope.v1');
  assert.equal(result.skill_key, 'meal_plan');
  assert.equal(result.template_id, 'diet_card');
  assert.equal(result.llm.template_id, 'diet_card');
  assert.equal(result.card.templateId, 'diet_card');
  assert.ok(result.answer_text.includes('早餐'));
  assert.ok(Array.isArray(result.data.meals));
  assert.equal(result.data.meals[0].mealName, '早餐');
  assert.ok(result.card.pages[0].includes('<!doctype html>'));
  assert.ok(result.rendered_html.includes('gxy-html-fallback'));
  assert.ok(result.followup_suggestions.length > 0);
  assert.deepEqual(validateEnvelope(result), { ok: true, errors: [] });
});

test('runtime falls back to common skill answer template for unrelated scene', async () => {
  const result = await runLocalSkill({
    request_id: 'req_2',
    conversation_id: 'conv_1',
    turn_id: 'turn_2',
    message: '社区活动几点开始',
  });

  assert.equal(result.skill_key, 'common');
  assert.equal(result.template_id, 'answer');
  assert.equal(result.route.decision, 'reject');
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(validateEnvelope(result), { ok: true, errors: [] });
});

test('runtime supports injected data and rag services', async () => {
  const modelCalls = [];
  const result = await runLocalSkill({
    request_id: 'req_3',
    conversation_id: 'conv_2',
    turn_id: 'turn_1',
    message: '高血压老人晚餐推荐',
    role: 'elder_family',
  }, {
    dataService: {
      tableData: {
        getMealPlanTables: async () => ({ items: ['清蒸鱼', '冬瓜汤', '杂粮饭'] }),
      },
      knowledgeData: {},
    },
    ragService: {
      retrieveMealPlanKnowledge: async () => ({
        matches: [{ chunk_id: 'mock#1', text: '低盐饮食' }],
      }),
    },
    modelService: {
      fillTemplateSlots: async (input) => {
        modelCalls.push(input);
        return {
          template_id: 'diet_card',
          answer_text: '低盐晚餐建议',
          data: {
            dateBadge: '今日推荐 - 晚餐',
            suitable: '高血压老人',
            totalCal: '约 260kcal',
            salt: '每日不超过 5g',
            meals: [
              {
                mealName: '晚餐',
                mealEmoji: '🌙🍲',
                mealTotal: '约 260kcal',
                foods: input.business_data.items.map((item) => ({
                  foodName: item,
                  foodIcon: '🍽️',
                  cal: '',
                  calNote: '',
                })),
              },
            ],
          },
          actions: [],
          followup_suggestions: [],
          template_fit_notes: [],
        };
      },
    },
  });

  assert.equal(result.data.meals[0].mealName, '晚餐');
  assert.deepEqual(
    result.data.meals[0].foods.map((food) => food.foodName),
    ['清蒸鱼', '冬瓜汤', '杂粮饭'],
  );
  assert.equal(result.evidence[0].chunk_id, 'mock#1');
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].skill_key, 'meal_plan');
  assert.equal(modelCalls[0].intent_context.intent_type, 'HEALTH');
});

test('runtime does not call meal_plan rag for rejected fallback', async () => {
  let ragCalls = 0;
  const result = await runLocalSkill({
    request_id: 'req_4',
    conversation_id: 'conv_3',
    turn_id: 'turn_1',
    message: '社区活动几点开始',
  }, {
    ragService: {
      retrieveMealPlanKnowledge: async () => {
        ragCalls += 1;
        return { matches: [{ chunk_id: 'should_not_attach' }] };
      },
    },
  });

  assert.equal(ragCalls, 0);
  assert.equal(result.skill_key, 'common');
  assert.deepEqual(result.evidence, []);
});

test('today meal shortcut returns meal_plan diet card', async () => {
  const result = await runLocalSkill({
    request_id: 'req_today_meal_1',
    conversation_id: 'conv_today_meal_1',
    turn_id: 'turn_today_meal_1',
    message: '推荐今日膳食',
    role: 'elder_family',
  });

  assert.equal(result.skill_key, 'meal_plan');
  assert.equal(result.template_id, 'diet_card');
  assert.equal(result.route.decision, 'accept');
  assert.deepEqual(validateEnvelope(result), { ok: true, errors: [] });
});
