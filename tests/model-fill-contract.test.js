import test from 'node:test';
import assert from 'node:assert/strict';

import { fillTemplateSlots } from '../src/core/model-service.js';

test('mock model fills diet_card fields without HTML', async () => {
  const result = await fillTemplateSlots({
    message: '糖尿病老人早餐怎么吃',
    template_id: 'diet_card',
  });

  assert.equal(result.template_id, 'diet_card');
  assert.ok(result.answer_text.includes('早餐'));
  assert.equal(typeof result.data.dateBadge, 'string');
  assert.ok(Array.isArray(result.data.meals));
  assert.equal(result.data.meals[0].mealName, '早餐');
  assert.ok(Array.isArray(result.data.meals[0].foods));
  assert.ok(Array.isArray(result.actions));
  assert.ok(Array.isArray(result.followup_suggestions));
  assert.equal(/<script|<html|javascript:/i.test(JSON.stringify(result)), false);
});

test('mock model fills diet_card data from business table items', async () => {
  const result = await fillTemplateSlots({
    message: '高血压老人晚餐推荐',
    template_id: 'diet_card',
    business_data: { items: ['清蒸鱼', '冬瓜汤', '杂粮饭'] },
  });

  assert.equal(result.data.suitable, '高血压或低盐需求老人');
  assert.equal(result.data.meals[0].mealName, '晚餐');
  assert.deepEqual(
    result.data.meals[0].foods.map((food) => food.foodName),
    ['清蒸鱼', '冬瓜汤', '杂粮饭'],
  );
  assert.ok(result.data.ratioText.includes('控制盐'));
});

test('fallback answer stays structured for unknown template', async () => {
  const result = await fillTemplateSlots({
    message: '社区活动几点开始',
    template_id: 'answer',
  });

  assert.equal(result.template_id, 'health_card');
  assert.equal(result.data.answer_text, result.answer_text);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.followup_suggestions, []);
  assert.deepEqual(result.template_fit_notes, ['fallback_common_answer']);
});

test('mock model strips unsafe text from message and business data', async () => {
  const result = await fillTemplateSlots({
    message: '糖尿病老人早餐<script>alert(1)</script><img src=x onerror=alert(1)>javascript:bad',
    template_id: 'diet_card',
    business_data: {
      items: [
        '燕麦粥<script>alert(1)</script>',
        '<a onclick=alert(1)>水煮蛋</a>',
        'javascript:黄瓜',
      ],
    },
  });
  const serialized = JSON.stringify(result);

  assert.equal(/<[^>]*>/i.test(serialized), false);
  assert.equal(/\bon[a-z]+\s*=/i.test(serialized), false);
  assert.equal(/javascript\s*:/i.test(serialized), false);
  assert.deepEqual(
    result.data.meals[0].foods.map((food) => food.foodName),
    ['燕麦粥alert(1)', '水煮蛋', '黄瓜'],
  );
});
