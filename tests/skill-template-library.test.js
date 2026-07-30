import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { discoverTemplates, renderCard } from '../src/template-card/index.js';

const projectRoot = process.cwd();
const mealPlanHtmlDir = path.join(projectRoot, 'src', 'skills', 'meal_plan', 'templates', 'html');
const travelRouteHtmlDir = path.join(projectRoot, 'src', 'skills', 'travel_route', 'templates', 'html');

test('meal_plan skill template directory exposes simplified html manifest templates', () => {
  const templates = discoverTemplates(mealPlanHtmlDir);
  const dietCard = templates.find((template) => template.id === 'diet_card');

  assert.ok(templates.map((template) => template.id).includes('diet_card'));
  assert.ok(dietCard);
  assert.equal(dietCard.layout, 'vertical');
  assert.ok(dietCard.match.includes('膳食') || dietCard.match.includes('鑶抽'));
  assert.deepEqual(dietCard.required, ['dateBadge', 'meals']);
});

test('meal_plan renderCard uses model selected diet_card without template contracts', () => {
  const result = renderCard(mealPlanHtmlDir, {
    template_id: 'diet_card',
    data: {
      dateBadge: '今日推荐 - 早餐',
      suitable: '糖尿病老人',
      totalCal: '约 220kcal',
      salt: '清淡少盐',
      meals: [
        {
          mealName: '早餐',
          mealEmoji: '🌤️🥣',
          mealTotal: '约 220kcal',
          foods: [
            { foodIcon: '🥣', foodName: '燕麦粥', cal: '90kcal', calNote: '建议适量' },
          ],
        },
      ],
    },
  });

  assert.equal(result.templateId, 'diet_card');
  assert.equal(result.reason, 'model-id');
  assert.ok(result.pages[0].includes('今日推荐 - 早餐'));
  assert.ok(result.pages[0].includes('燕麦粥'));
});

test('travel_route skill template directory exposes route_card', () => {
  const templates = discoverTemplates(travelRouteHtmlDir);
  const routeCard = templates.find((template) => template.id === 'route_card');
  const ids = templates.map((template) => template.id);

  assert.ok(ids.includes('route_card'));
  assert.ok(ids.includes('travel_base_card'));
  assert.ok(ids.includes('travel_itinerary_card'));
  assert.ok(ids.includes('travel_transport_card'));
  assert.ok(routeCard);
  assert.equal(routeCard.layout, 'vertical');
  assert.ok(routeCard.required.includes('routeTitle'));
});

test('runtime templates do not require template-contract files', () => {
  const runtimeFiles = [
    path.join(projectRoot, 'src', 'runtime', 'local-skill-runtime.js'),
    path.join(projectRoot, 'src', 'core', 'render', 'template-card-renderer.js'),
  ];

  for (const file of runtimeFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('template-contracts'), false, file);
    assert.equal(content.includes('selectTemplateContract'), false, file);
  }
});
