import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { renderTemplateCardResult } from '../src/core/render/template-card-renderer.js';

const TEMPLATE_DIR = './src/skills/nearby_resource/templates/html';

test('nearby map templates render syntactically valid inline scripts', () => {
  for (const templateId of ['nearby_map_overview', 'nearby_map_category', 'nearby_map_route', 'nearby_radar']) {
    const result = renderTemplateCardResult({
      templateDir: TEMPLATE_DIR,
      modelResult: {
        template_id: templateId,
        answer_text: '嘉路周边资源',
        data: buildNearbyMapData(),
      },
    });
    const html = result.card.pages[0] || '';
    const scripts = extractExecutableScripts(html);

    assert.ok(scripts.length > 0, `${templateId} should include executable script`);
    for (const [index, script] of scripts.entries()) {
      assert.doesNotThrow(
        () => new vm.Script(script, { filename: `${templateId}.${index + 1}.js` }),
        `${templateId} script ${index + 1} should compile`,
      );
    }
  }
});

test('nearby map templates prefer live TMap then static tile (no travel SVG preload)', () => {
  for (const templateId of ['nearby_map_overview', 'nearby_map_category', 'nearby_map_route', 'nearby_radar']) {
    const result = renderTemplateCardResult({
      templateDir: TEMPLATE_DIR,
      modelResult: {
        template_id: templateId,
        answer_text: '嘉路周边资源',
        data: { ...buildNearbyMapData(), map_key: 'test-js-key' },
      },
    });
    const script = extractExecutableScripts(result.card.pages[0] || '').join('\n');

    assert.doesNotMatch(script, /function renderSVG\s*\(/, `${templateId} must not preload travel SVG`);
    assert.match(script, /map\.qq\.com\/api\/gljs/, `${templateId} should load live GLJS`);
    assert.match(script, /function showStaticMap\s*\(/, `${templateId} should have static tile degrade`);
    assert.match(script, /function buildMap\s*\(/, `${templateId} should build live TMap`);
    assert.doesNotMatch(script, /liveTilesOk/, `${templateId} must not false-hide live map by canvas size`);
  }
});

test('nearby map templates keep static map URL usable inside JavaScript', () => {
  for (const templateId of ['nearby_map_overview', 'nearby_map_category', 'nearby_map_route', 'nearby_radar']) {
    const result = renderTemplateCardResult({
      templateDir: TEMPLATE_DIR,
      modelResult: {
        template_id: templateId,
        answer_text: '嘉路周边资源',
        data: {
          ...buildNearbyMapData(),
          static_map_url: 'https://apis.map.qq.com/ws/staticmap/v2?center=21.527905%2C108.166816&maptype=roadmap&markers=color%3Ablue%7Csize%3Amid%7C21.531%2C108.172&key=test',
        },
      },
    });
    const script = extractExecutableScripts(result.card.pages[0] || '').join('\n');

    assert.ok(script.includes('&maptype=roadmap&markers='), `${templateId} should preserve URL query separators`);
    assert.equal(script.includes('&amp;maptype='), false, `${templateId} should not HTML-escape URL separators in JS`);
  }
});

test('nearby map templates pass Tencent GL overlay styles as style instances', () => {
  for (const templateId of ['nearby_map_overview', 'nearby_map_category', 'nearby_map_route', 'nearby_radar']) {
    const result = renderTemplateCardResult({
      templateDir: TEMPLATE_DIR,
      modelResult: {
        template_id: templateId,
        answer_text: '嘉路周边资源',
        data: { ...buildNearbyMapData(), map_key: 'test-js-key' },
      },
    });
    const script = extractExecutableScripts(result.card.pages[0] || '').join('\n');

    assert.equal(/MultiPolygon\(\{[\s\S]*?styles:\s*\{\s*strokeColor:/.test(script), false, `${templateId} should not pass raw polygon style fields`);
    assert.equal(/MultiPolyline\(\{[\s\S]*?styles:\s*\{\s*color:/.test(script), false, `${templateId} should not pass raw polyline style fields`);
    if (script.includes('MultiPolygon')) assert.ok(script.includes('new TMap.PolygonStyle'), `${templateId} should use PolygonStyle`);
    if (script.includes('MultiPolyline')) assert.ok(script.includes('new TMap.PolylineStyle'), `${templateId} should use PolylineStyle`);
    if (script.includes('MultiPolygon') || script.includes('MultiPolyline')) assert.ok(script.includes('styleId:'), `${templateId} should bind geometries to styleId`);
  }
});

test('nearby overview map constrains mobile header and card width', () => {
  const result = renderTemplateCardResult({
    templateDir: TEMPLATE_DIR,
    modelResult: {
      template_id: 'nearby_map_overview',
      answer_text: '嘉路周边资源',
      data: buildNearbyMapData(),
    },
  });
  const html = result.card.pages[0] || '';

  assert.match(html, /html,\s*body\s*\{[^}]*overflow-x:\s*hidden/i);
  assert.match(html, /\.nb-card\s*\{[^}]*width:\s*100%/i);
  assert.match(html, /\.nb-head\s*\{[^}]*flex-wrap:\s*wrap/i);
  assert.match(html, /#pickModeBtn\s*\{[^}]*margin-left:\s*0\s*!important/i);
});

function buildNearbyMapData() {
  const center = { name: '嘉路康养中心', lat: 21.527905, lng: 108.166816 };
  const markers = [
    {
      name: '测试医疗点',
      address: '测试地址',
      lat: 21.53,
      lng: 108.17,
      distance: 1,
      cat: 'wellness',
      color: '#2BAE8E',
      emoji: '📍',
      tags_text: '医疗',
    },
  ];
  return {
    centerName: center.name,
    radiusKm: 15,
    category: 'wellness',
    categoryLabel: '医疗康养',
    map_key: '',
    total: markers.length,
    walkCount: markers.length,
    markers,
    routeStops: markers,
    walkItems: markers,
    markers_json: JSON.stringify(markers),
    routeStops_json: JSON.stringify(markers),
    walkItems_json: JSON.stringify(markers),
    center_json: JSON.stringify(center),
  };
}

function extractExecutableScripts(html) {
  return [...String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/type=["']application\/json["']/i.test(match[1] || ''))
    .map((match) => match[2])
    .filter((script) => script.trim());
}
