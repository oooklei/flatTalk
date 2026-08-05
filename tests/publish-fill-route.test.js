/**
 * 第二刀 fill：published route_id 必须进入卡片，不能被默认巴马表盖住
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplateSlots } from '../src/core/model-service.js';

test('fillRouteCardLegacy prefers publish route_id over default bama table', async () => {
  const result = await fillTemplateSlots({
    skill_key: 'travel_route',
    template_id: 'route_coastal',
    message: '京族滨海文化线',
    business_data: {
      routes: [
        { destination: '广西巴马', budget_level: '舒适型', season: '全年可评估' },
        { destination: '广西北海', budget_level: '经济型', season: '夏季避暑' },
      ],
      route_id: 'fcg_route_001',
      route_title: '京族滨海文化线',
      publish_match: {
        route_id: 'fcg_route_001',
        product_type: 'coastal',
        destination: ['防城港', '东兴'],
        title: '京族滨海文化线',
      },
    },
  });

  assert.equal(result.template_id, 'route_coastal');
  assert.equal(result.data?.route_id, 'fcg_route_001');
  assert.match(String(result.data?.routeTitle || ''), /京族/);
  assert.match(String(result.data?.destination || ''), /防城港|东兴/);
  assert.doesNotMatch(String(result.answer_text || result.answer || ''), /巴马/);
  assert.ok((result.data?.static_svg || '').includes('<svg'));
});

test('fillRouteCardLegacy matches utterance to published package without route_id', async () => {
  const result = await fillTemplateSlots({
    skill_key: 'travel_route',
    template_id: 'route_culture',
    message: '银发爱情边境线',
    business_data: {
      routes: [{ destination: '广西巴马', budget_level: '舒适型' }],
    },
  });
  assert.equal(result.data?.route_id, 'fcg_route_002');
  assert.match(String(result.data?.routeTitle || ''), /银发爱情/);
  assert.doesNotMatch(String(result.answer_text || result.answer || ''), /巴马/);
});
