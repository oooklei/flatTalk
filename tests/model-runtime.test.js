import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTemplateCardModelService } from '../src/core/model-runtime/template-card-llm-service.js';
import { renderCard } from '../src/template-card/index.js';

test('admin model runtime calls OpenAI-compatible model and returns card json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flattalk-model-reg-'));
  const registryPath = path.join(dir, 'model-registry.json');
  fs.writeFileSync(registryPath, JSON.stringify({
    models: [{
      id: 1,
      name: 'fake-model',
      display_name: 'Fake Model',
      provider: 'fake',
      api_base: 'http://fake.local/v1',
      api_key: 'fake-key',
      model_id: 'fake-chat',
      is_active: true,
      is_default: true,
      model_type: 'llm_text',
    }],
  }));

  const calls = [];
  const modelService = createTemplateCardModelService({
    modelMode: 'admin',
    registryPath,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              template_id: 'diet_card',
              answer_text: '控糖早餐建议',
              data: { dateBadge: '今日推荐 - 早餐', meals: [] },
              actions: [],
              followup_suggestions: [],
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await modelService.fillTemplateSlots({
    message: '糖尿病老人早餐怎么吃',
    skill_key: 'meal_plan',
    intent_context: { intent_type: 'HEALTH' },
    template_library: [{ id: 'diet_card', match: '膳食推荐' }],
  });

  assert.equal(result.template_id, 'diet_card');
  assert.equal(result.model_status, 'ok');
  assert.equal(result.model_used, 'Fake Model');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.ok(calls[0].body.messages[1].content.includes('template_library'));
});

test('admin model runtime falls back to mock on empty model reply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flattalk-model-reg-'));
  const registryPath = path.join(dir, 'model-registry.json');
  fs.writeFileSync(registryPath, JSON.stringify({
    models: [{
      id: 1,
      name: 'empty-model',
      provider: 'fake',
      api_base: 'http://fake.local/v1',
      api_key: 'fake-key',
      model_id: 'fake-chat',
      is_active: true,
      is_default: true,
      model_type: 'llm_text',
    }],
  }));

  const modelService = createTemplateCardModelService({
    modelMode: 'admin',
    registryPath,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }),
  });

  const result = await modelService.fillTemplateSlots({
    message: '糖尿病老人早餐怎么吃',
    template_library: [{ id: 'diet_card', match: '膳食推荐' }],
  });

  assert.equal(result.template_id, 'diet_card');
  assert.equal(result.model_status, 'fallback_mock');
  assert.equal(result.model_error_status, 'empty_reply');
});

test('admin model runtime normalizes weekly plan object arrays for rendering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flattalk-weekly-model-'));
  const registryPath = path.join(dir, 'model-registry.json');
  fs.writeFileSync(registryPath, JSON.stringify({
    models: [{
      id: 1,
      name: 'weekly-model',
      provider: 'fake',
      api_base: 'http://fake.local/v1',
      api_key: 'fake-key',
      model_id: 'fake-chat',
      is_active: true,
      is_default: true,
      model_type: 'llm_text',
    }],
  }));

  const modelService = createTemplateCardModelService({
    modelMode: 'admin',
    registryPath,
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            template_id: 'weekly_plan',
            answer_text: 'ok',
            data: {
              weekly_plan: {
                badge: '一周计划',
                title: '七天计划',
                summary: '控糖清淡',
                items: [{
                  dayName: '周一',
                  meals: [{
                    mealName: '早餐',
                    foods: [{ foodName: '小米粥' }, { foodName: '鸡蛋' }],
                    mealCal: '约300kcal',
                  }],
                }],
              },
            },
          }),
        },
      }],
    }), { status: 200 }),
  });

  const result = await modelService.fillTemplateSlots({
    message: '生成一周计划',
    template_id: 'weekly_plan',
    template_library: [{ id: 'weekly_plan', match: '一周膳食计划' }],
  });
  const card = renderCard(path.join(process.cwd(), 'src', 'skills', 'meal_plan', 'templates', 'html'), {
    template_id: result.template_id,
    data: result.data,
  });

  assert.equal(result.template_id, 'weekly_plan');
  assert.equal(card.templateId, 'weekly_plan');
  assert.equal(card.pages[0].includes('[object Object]'), false);
  assert.ok(card.pages[0].includes('小米粥'));
});

test('admin model runtime pads weekly plan to seven days', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flattalk-weekly-pad-'));
  const registryPath = path.join(dir, 'model-registry.json');
  fs.writeFileSync(registryPath, JSON.stringify({
    models: [{
      id: 1,
      name: 'weekly-short-model',
      provider: 'fake',
      api_base: 'http://fake.local/v1',
      api_key: 'fake-key',
      model_id: 'fake-chat',
      is_active: true,
      is_default: true,
      model_type: 'llm_text',
    }],
  }));

  const modelService = createTemplateCardModelService({
    modelMode: 'admin',
    registryPath,
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            template_id: 'weekly_plan',
            answer_text: 'ok',
            data: {
              weekly_plan: {
                title: '三天也要补成七天',
                items: [
                  { dayName: '周一', meals: [{ mealName: '早餐', foods: '小米粥', mealCal: '约300kcal' }] },
                  { dayName: '周二', meals: [{ mealName: '早餐', foods: '燕麦粥', mealCal: '约300kcal' }] },
                  { dayName: '周三', meals: [{ mealName: '早餐', foods: '蒸蛋', mealCal: '约300kcal' }] },
                ],
              },
            },
          }),
        },
      }],
    }), { status: 200 }),
  });

  const result = await modelService.fillTemplateSlots({
    message: '生成一周计划',
    template_id: 'weekly_plan',
    template_library: [{ id: 'weekly_plan', match: '一周膳食计划' }],
  });
  const card = renderCard(path.join(process.cwd(), 'src', 'skills', 'meal_plan', 'templates', 'html'), {
    template_id: result.template_id,
    data: result.data,
  });

  assert.equal(result.data.weekly_plan.items.length, 7);
  assert.equal(result.data.weekly_plan.items[6].dayName, '周日');
  assert.ok(card.pages[0].includes('周日'));
});
