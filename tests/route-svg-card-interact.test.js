/**
 * SVG 走线卡：字号可读性 / 静态 SVG 不被 map-bridge 清空 / 景点元数据透传
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { injectBridge } from '../src/core/render/bridge-injector.js';
import { fillTemplateSlots } from '../src/core/model-service.js';
import { generateSvg } from '../src/admin/mapstudio.js';

test('injectBridge 不给 static_svg / data-static-svg 注入 map-kit-bridge', () => {
  const staticBody = '<html><body data-map-mode="static_svg"><div id="svgMapContainer"></div></body></html>';
  const staticAttr = '<html><body data-static-svg="1"><div id="svgMapContainer"></div></body></html>';
  assert.equal(injectBridge(staticBody).includes('map-kit-bridge'), false);
  assert.equal(injectBridge(staticAttr).includes('map-kit-bridge'), false);

  const live = '<html><body><div class="mk-map-wrap" data-map-mode="route" data-map-key="k"></div></body></html>';
  assert.equal(injectBridge(live).includes('map-kit-bridge'), true);
});

test('map-bridge 源码跳过 static_svg，避免 body.innerHTML 被清空', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/core/map/map-bridge.js'), 'utf8');
  assert.match(src, /static_svg/);
  assert.match(src, /:not\(\[data-map-mode="static_svg"\]\)/);
});

test('generateSvg 字号：默认嵌入后8，地图端点嵌入后≥10', () => {
  const svg = generateSvg(
    [
      { name: '起点站', lat: 21.53, lng: 108.17, type: 'arrival', day: 'D1', plan: '抵达', spot_desc: '基地' },
      { name: '金滩', lat: 21.51, lng: 108.12, type: 'spot', day: 'D1', plan: '滨海慢走', spot_images: ['https://example.com/a.jpg'], spot_desc: '沙滩' },
    ],
    'test_route',
    '测试线路',
    'standard'
  );
  assert.match(svg, /class="hit-area"/);
  assert.match(svg, /data-spot-img=/);
  assert.match(svg, /data-role="marker_name"/);
  const boost = 620 / 360;
  const minDefaultSrc = Math.ceil(8 * boost);
  const minMapSrc = Math.ceil(10 * boost);
  const fontSizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(fontSizes.length > 0);
  assert.ok(Math.min(...fontSizes) >= minDefaultSrc, `min font-size ${Math.min(...fontSizes)} < ${minDefaultSrc}`);
  assert.ok(Math.max(...fontSizes) <= 40, `max font-size ${Math.max(...fontSizes)} > 40`);
  const markerNames = [
    ...[...svg.matchAll(/data-role="marker_name"[^>]*font-size="(\d+)"/g)].map((m) => Number(m[1])),
    ...[...svg.matchAll(/font-size="(\d+)"[^>]*data-role="marker_name"/g)].map((m) => Number(m[1])),
  ];
  assert.ok(markerNames.length >= 1);
  assert.ok(markerNames.every((n) => n >= minMapSrc && n <= 28), `marker name fonts out of range: ${markerNames}`);
  const panelBodies = [
    ...[...svg.matchAll(/data-role="panel_body"[^>]*font-size="(\d+)"/g)].map((m) => Number(m[1])),
    ...[...svg.matchAll(/font-size="(\d+)"[^>]*data-role="panel_body"/g)].map((m) => Number(m[1])),
  ];
  if (panelBodies.length) {
    assert.ok(panelBodies.every((n) => n >= minDefaultSrc && n < minMapSrc + 2), `panel_body should be ~8 screen: ${panelBodies}`);
  }
});

test('dashboard 本地知识库覆盖 49 端点补图', async () => {
  const { getDashboardSpotKbStats, lookupDashboardSpotImages, enrichWaypointsFromDashboardKb } = await import('../src/skills/travel_route/dashboard-spot-kb.js');
  const stats = getDashboardSpotKbStats();
  assert.ok(stats.endpoint_count >= 49, `endpoint_count=${stats.endpoint_count}`);
  const baimo = lookupDashboardSpotImages('巴马百魔洞') || lookupDashboardSpotImages('百魔洞');
  assert.ok(baimo?.spot_images?.length, '百魔洞应有本地图');
  const enriched = enrichWaypointsFromDashboardKb([
    { name: '白浪滩', lat: 21.55, lng: 108.22, type: 'spot' },
    { name: '桂林象鼻山', lat: 25.27, lng: 110.29, type: 'spot' },
  ]);
  assert.ok(enriched.every((wp) => (wp.spot_images || []).length > 0));
});

test('route_svg 模板含点击交互与 waypoint 水合脚本', () => {
  const html = fs.readFileSync(
    path.join(process.cwd(), 'src/skills/travel_route/templates/html/route_svg.html'),
    'utf8'
  );
  assert.match(html, /data-static-svg="1"/);
  assert.doesNotMatch(html, /data-map-mode="static_svg"/);
  assert.match(html, /waypointSpotsData/);
  assert.match(html, /enhanceSvgForCard/);
  assert.match(html, /addEventListener\('click'/);
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.match(html, /\.route-marker, \.spot-item/);
});

test('巴马发布包 fill 透传 spot 图片元数据', async () => {
  const result = await fillTemplateSlots({
    skill_key: 'travel_route',
    template_id: 'route_svg',
    message: '巴马康养百魔洞',
    business_data: {
      route_id: 'bama_5d4n',
      publish_match: { route_id: 'bama_5d4n', destination: ['巴马'], title: '巴马5天4晚康养旅居' },
    },
  });
  assert.ok(result.data?.static_svg?.includes('<svg'));
  const meta = JSON.parse(result.data?.waypoint_spots_json || '[]');
  assert.ok(Array.isArray(meta) && meta.length > 0);
  const withImg = meta.find((w) => (w.spot_images || []).length > 0);
  assert.ok(withImg, '应透传含 spot_images 的 waypoints');
});
