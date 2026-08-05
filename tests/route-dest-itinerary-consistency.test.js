/**
 * 目的地与行程/亮点必须同城一致
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplateSlots } from '../src/core/model-service.js';
import { selectProductTemplate } from '../src/core/route-svg-generator.js';

test('北海话术不得套用巴马示例行程', async () => {
  const match = selectProductTemplate('北海旅居', '广西北海');
  assert.equal(match?.id, 'route_coastal');
  assert.equal(Object.keys(match?.sample || {}).length, 0, '异地 wellness 示例应被清空');

  const result = await fillTemplateSlots({
    skill_key: 'travel_route',
    template_id: 'route_coastal',
    message: '想去北海海边旅居',
    business_data: {
      routes: [{ destination: '广西北海', budget_level: '舒适型' }],
    },
  });

  assert.match(String(result.data?.destination || ''), /北海/);
  assert.doesNotMatch(String(result.data?.routeTitle || ''), /巴马/);
  assert.doesNotMatch(JSON.stringify(result.data?.highlights || []), /百魔洞|赐福湖|盘阳河/);
  assert.doesNotMatch(JSON.stringify(result.data?.itinerary || []), /巴马|百魔洞/);
  assert.match(JSON.stringify(result.data?.itinerary || []), /北海|银滩/);
});

test('巴马话术仍可用巴马示例', async () => {
  const result = await fillTemplateSlots({
    skill_key: 'travel_route',
    template_id: 'route_wellness',
    message: '巴马康养百魔洞',
    business_data: {
      route_id: 'bama_5d4n',
      publish_match: { route_id: 'bama_5d4n', destination: ['巴马'], title: '巴马5天4晚康养旅居' },
    },
  });
  assert.match(String(result.data?.destination || ''), /巴马/);
  assert.doesNotMatch(String(result.data?.destination || ''), /北海/);
});

test('防城港滨海三日游不得落到南宁长线目的地', async () => {
  const result = await fillTemplateSlots({
    skill_key: 'travel_route',
    template_id: 'route_svg',
    message: '防城港滨海三日游',
    business_data: { routes: [] },
  });
  assert.match(String(result.data?.destination || ''), /防城港/);
  assert.doesNotMatch(String(result.data?.destination || ''), /^南宁$/);
  assert.equal(result.data?.route_id, 'fcg_route_001');
  assert.doesNotMatch(String(result.data?.routeTitle || ''), /南宁-北海-钦州/);
});
