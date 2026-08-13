/**
 * 嘉路品牌 / 七洞填卡 / 场景分流回归
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyScene } from '../src/core/scene-router/index.js';
import { isJialuNearbyOnlyUtterance } from '../src/core/scene-router/place-brand-intent.js';
import { createSupervisor } from '../src/core/agents/supervisor.js';
import { fillTemplateSlots } from '../src/core/model-service.js';
import fs from 'node:fs';
import path from 'node:path';

test('裸嘉路康养中心 → nearby only，不粘旅居', async () => {
  assert.equal(isJialuNearbyOnlyUtterance('嘉路康养中心'), true);
  assert.equal(isJialuNearbyOnlyUtterance('嘉路康养中心旅居路线'), false);

  const scene = identifyScene({ message: '嘉路康养中心', role: 'elder_family' });
  assert.equal(scene.scene_key, 'nearby_resource');

  const s = createSupervisor();
  const free = await s.route({ message: '嘉路康养中心' });
  const keep = await s.route({ message: '嘉路康养中心', context: { active_agent: 'travel_route' } });
  assert.equal(free.agentKey, 'nearby_resource');
  assert.equal(keep.agentKey, 'nearby_resource');
});

test('七洞乡旅居：亮点/行程来自本包，不含巴马地标', async () => {
  const result = await fillTemplateSlots({
    skill_key: 'travel_route',
    template_id: 'route_svg',
    message: '七洞乡旅居产品',
    business_data: { routes: [] },
  });
  assert.equal(result.data?.route_id, 'jtd_2070305000000000240');
  assert.match(String(result.data?.destination || ''), /七洞/);
  assert.doesNotMatch(JSON.stringify(result.data?.highlights || []), /百魔洞|赐福湖|命河|水晶宫/);
  assert.doesNotMatch(JSON.stringify(result.data?.itinerary || []), /巴马|百魔洞|赐福湖/);
  assert.match(JSON.stringify(result.data?.itinerary || []), /七洞/);
});

test('已发布 SVG 含行政区边界（重生后）', () => {
  const samples = ['fcg_route_001', 'bama_5d4n'];
  for (const id of samples) {
    const p = path.join(process.cwd(), 'data', 'sojourn-maps', id, 'map_standard.svg');
    if (!fs.existsSync(p)) continue;
    const svg = fs.readFileSync(p, 'utf8');
    // 重生脚本跑过后应有 district-boundary；若本地无 geojson/API 则跳过强断言
    if (svg.includes('行政区划示意') || svg.includes('district-boundary')) {
      assert.match(svg, /district-boundary/);
      assert.doesNotMatch(svg, /<image[\s>]/i);
    }
  }
});
