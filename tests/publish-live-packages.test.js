/**
 * 工坊实包发布验收（含 Dashboard/JTD 预制）
 * Run: node --test tests/publish-live-packages.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  listPublishedPackages,
  matchPublishedPackages,
} from '../src/core/scene-router/publish-index.js';
import { buildRouteMapData, findPrebuiltPackage } from '../src/core/map/map-kit.js';

const BASE = path.join(process.cwd(), 'data', 'sojourn-maps');

test('live packages: published inventory covers FCG + excel + jtd', () => {
  const published = listPublishedPackages(BASE);
  const ids = new Set(published.map((p) => p.route_id));
  for (const id of [
    'fcg_route_001', 'fcg_route_002', 'fcg_route_003', 'fcg_route_004', 'fcg_route_005',
    'bama_5d4n',
    'gx_excel_01', 'gx_excel_05', 'gx_excel_10',
    'jtd_2070305000000000271', 'jtd_2070305000000000240', 'jtd_2070305000000000266',
  ]) {
    assert.ok(ids.has(id), `missing published ${id}`);
    assert.ok(fs.existsSync(path.join(BASE, id, 'map_standard.svg')), `${id} svg`);
  }
  assert.ok(!ids.has('jtd_mock_bama_001'), 'draft mock must stay unpublished');
  assert.ok(published.length >= 15, `expected >=15 published, got ${published.length}`);
});

test('live match: 防城港滨海京族 → fcg_route_001', () => {
  const hits = matchPublishedPackages('京族滨海文化线', { baseDir: BASE });
  assert.equal(hits[0]?.route_id, 'fcg_route_001');
});

test('live match: 银发爱情边境 → fcg_route_002', () => {
  const hits = matchPublishedPackages('银发爱情边境线', { baseDir: BASE });
  assert.equal(hits[0]?.route_id, 'fcg_route_002');
});

test('live match: 桂林永福阳朔恭城 → gx_excel_01', () => {
  const hits = matchPublishedPackages('桂林市区 → 永福县 → 阳朔县 → 恭城瑶族自治县 → 荔浦市', { baseDir: BASE });
  assert.equal(hits[0]?.route_id, 'gx_excel_01');
});

test('live match: 南宁北海钦州防城港滨海 → gx_excel_05', () => {
  const hits = matchPublishedPackages('南宁-北海-钦州-防城港滨海养老旅居线', { baseDir: BASE });
  assert.equal(hits[0]?.route_id, 'gx_excel_05');
});

test('live match: 巴马康养 → bama_5d4n（合并 excel7/jtd0724，不命中 draft）', () => {
  const hits = matchPublishedPackages('巴马5天4晚康养百魔洞旅居线路', { baseDir: BASE });
  assert.equal(hits[0]?.route_id, 'bama_5d4n');
  assert.ok(hits.every((h) => h.route_id !== 'jtd_mock_bama_001'));
});

test('live match: 七洞乡产品 → jtd 七洞包', () => {
  const hits = matchPublishedPackages('七洞乡线路产品旅居', { baseDir: BASE });
  assert.ok(hits[0]?.route_id === 'jtd_2070305000000000240' || hits[0]?.route_id === 'jtd_2070305000000000271');
});

test('live map-kit: sample packages resolve static_svg', () => {
  for (const id of ['fcg_route_003', 'gx_excel_08', 'jtd_2070305000000000240']) {
    const pkg = findPrebuiltPackage(id, 'standard');
    assert.ok(pkg?.svg?.includes('<svg'), id);
  }
  const map = buildRouteMapData({
    destination: '贺州',
    utterance: '贺州昭平钟山富川七日康养旅居',
    waypoints: [],
  });
  assert.equal(map.map_mode, 'static_svg');
});
