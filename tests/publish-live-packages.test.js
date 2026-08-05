/**
 * 工坊实包发布验收：published 命中 + draft 排除 + map-kit SVG
 * Run: node --test tests/publish-live-packages.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  listPublishedPackages,
  matchPublishedPackages,
  PRODUCT_TYPE_TO_ROUTE_TEMPLATE,
} from '../src/core/scene-router/publish-index.js';
import { buildRouteMapData, findPrebuiltPackage } from '../src/core/map/map-kit.js';

const BASE = path.join(process.cwd(), 'data', 'sojourn-maps');

test('live packages: two published + one draft on disk', () => {
  for (const id of ['fcg_route_001', 'bama_5d4n', 'jtd_mock_bama_001']) {
    assert.ok(fs.existsSync(path.join(BASE, id, 'route_data.json')), `${id} route_data`);
    assert.ok(fs.existsSync(path.join(BASE, id, 'publish.json')), `${id} publish.json`);
  }
  const published = listPublishedPackages(BASE);
  const ids = published.map((p) => p.route_id).sort();
  assert.deepEqual(ids, ['bama_5d4n', 'fcg_route_001']);
  assert.ok(!ids.includes('jtd_mock_bama_001'), 'draft must not be listed');
});

test('live match: 防城港滨海 → fcg_route_001 coastal', () => {
  const hits = matchPublishedPackages('想去防城港滨海京族三日游旅居', { baseDir: BASE });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].route_id, 'fcg_route_001');
  assert.equal(hits[0].product_template_id, PRODUCT_TYPE_TO_ROUTE_TEMPLATE.coastal);
});

test('live match: 巴马康养 → bama_5d4n not draft mock', () => {
  const hits = matchPublishedPackages('巴马5天4晚康养百魔洞旅居线路', { baseDir: BASE });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].route_id, 'bama_5d4n');
  assert.ok(hits.every((h) => h.route_id !== 'jtd_mock_bama_001'));
  assert.equal(hits[0].product_template_id, 'route_wellness');
});

test('live map-kit: published packages resolve static_svg', () => {
  const fcg = findPrebuiltPackage('fcg_route_001', 'standard');
  assert.ok(fcg?.svg && fcg.svg.includes('<svg'), 'fcg svg');
  const bama = findPrebuiltPackage('bama_5d4n', 'standard');
  assert.ok(bama?.svg && bama.svg.includes('<svg'), 'bama svg');

  const byUtterance = buildRouteMapData({
    destination: '防城港',
    utterance: '防城港滨海京族三日游',
    waypoints: [],
  });
  assert.equal(byUtterance.map_mode, 'static_svg');
  assert.ok(byUtterance.static_svg?.includes('<svg'));

  const bamaMap = buildRouteMapData({
    destination: '巴马',
    utterance: '巴马5天4晚康养百魔洞',
    waypoints: [],
  });
  assert.equal(bamaMap.map_mode, 'static_svg');
  assert.ok(bamaMap.static_svg?.includes('<svg'));
});
