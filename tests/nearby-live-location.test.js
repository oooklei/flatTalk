import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillTemplateSlots } from '../src/core/model-service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('orchestrator uses live GPS for nearby when far from Jialu (not only map center)', () => {
  const src = fs.readFileSync(path.join(root, 'src/core/orchestrator/chat-orchestrator.js'), 'utf8');
  assert.match(src, /distToJialuKm > 40/);
  assert.match(src, /tencent_map_gps/);
  assert.match(src, /searchPoisAroundCenter/);
  assert.match(src, /inferNearbySearchCategory/);
  assert.match(src, /eldercare/);
  // 异地无结果不得回落嘉路静态点
  assert.match(src, /tencent_map_gps_empty/);
});

test('fillNearby recalculates distance from live center (not stale 距离_公里)', async () => {
  // 中心：南宁 GPS；POI：防城港附近（嘉路静态距离字段故意写成 1.2，若误用会进 15km）
  const card = await fillTemplateSlots({
    message: '附近有养老机构吗',
    skill_key: 'nearby_resource',
    template_id: 'nearby_map_overview',
    intent_context: { intent: 'nearby_resource.all' },
    business_data: {
      jialu_center: { lat: 22.75439, lng: 108.3782, name: '您的位置' },
      _is_default_location: false,
      _data_source: 'tencent_map_gps',
      jialu_facilities: [
        {
          name: '防城港假点',
          category: '医养',
          amap_type: '医疗保健服务;医院',
          lng: 108.166816,
          lat: 21.527905,
          距离_公里: 1.2,
        },
        {
          name: '南宁附近养老院',
          category: '医养',
          amap_type: '养老院',
          lng: 108.38,
          lat: 22.76,
          距离_公里: 99,
          distance: 99,
        },
      ],
    },
  });
  const markers = card.data?.markers || [];
  assert.ok(markers.some((m) => m.name === '南宁附近养老院'), 'near GPS POI should remain');
  assert.ok(!markers.some((m) => m.name === '防城港假点'), 'far Jialu POI must be filtered by recomputed distance');
  const near = markers.find((m) => m.name === '南宁附近养老院');
  assert.ok(near.distance < 5, `expected recomputed near distance, got ${near.distance}`);
});

test('附近有养老机构 uses map_category not wellness list', async () => {
  const card = await fillTemplateSlots({
    message: '附近有养老机构吗',
    skill_key: 'nearby_resource',
    template_id: 'nearby_map_overview',
    intent_context: { intent: 'nearby_resource.all' },
    business_data: {
      jialu_center: { lat: 22.75, lng: 108.37, name: '您的位置' },
      _is_default_location: false,
      jialu_facilities: [
        { name: '南宁养老院', category: '医养', amap_type: '养老院', lng: 108.38, lat: 22.76, 距离_公里: 1.1 },
      ],
    },
  });
  assert.equal(card.template_id, 'nearby_map_category');
  assert.equal(card.data?.category, 'wellness');
});

test('nearby overview uses live TMap then static tile degrade (not travel SVG)', () => {
  const html = fs.readFileSync(
    path.join(root, 'src/skills/nearby_resource/templates/html/nearby_map_overview.html'),
    'utf8',
  );
  assert.match(html, /map\.qq\.com\/api\/gljs\?v=1\.exp&key=/);
  assert.doesNotMatch(html, /libraries=visualization/);
  assert.match(html, /STATIC_MAP_URL/);
  assert.match(html, /showStaticMap/);
  assert.match(html, /降级静态瓦片|实时 SDK 超时/);
  assert.doesNotMatch(html, /liveTilesOk/);
  // 不得在 init 里先画旅居式方位 SVG
  assert.doesNotMatch(html, /function renderSVG\s*\(/);
  assert.match(html, /__MAP_KEY__/);
});
