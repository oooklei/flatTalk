import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillTemplateSlots } from '../src/core/model-service.js';
import { findServiceRuleSet } from '../src/core/scene-router/rules/find-service.js';
import { nearbyResourceRuleSet } from '../src/core/scene-router/rules/nearby-resource.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('只看医疗 / medical action uses map_category wellness, not nearby_wellness stay mix', async () => {
  const facilities = [
    { name: '海岸假日民宿', category: '民宿', amap_type: '住宿服务', lng: 108.17, lat: 21.53, 距离_公里: 0.8 },
    { name: '港口区社区卫生服务中心', category: '医养', amap_type: '医疗保健服务;医院', lng: 108.16, lat: 21.52, 距离_公里: 1.1 },
    { name: '某某药店', category: '医养', amap_type: '医疗保健服务;药房', lng: 108.165, lat: 21.525, 距离_公里: 1.4 },
  ];
  const card = await fillTemplateSlots({
    message: '请展示嘉路康养中心周边15公里内的医疗资源',
    skill_key: 'nearby_resource',
    template_id: 'nearby_map_overview',
    intent_context: { intent: 'nearby_resource.medical', action_key: 'nearby_resource.medical' },
    business_data: {
      jialu_facilities: facilities,
      jialu_center: { lng: 108.166816, lat: 21.527905, name: '嘉路康养中心' },
    },
  });
  assert.equal(card.template_id, 'nearby_map_category');
  const markers = card.data?.markers || [];
  assert.ok(markers.length >= 1, 'should have medical markers');
  assert.ok(markers.every((m) => m.cat === 'wellness'), `expected only wellness, got ${markers.map((m) => m.cat).join(',')}`);
  assert.ok(!markers.some((m) => /民宿|宾馆|酒店/.test(m.name || '')), 'must not include hotels');
});

test('nearby force short-circuit excludes 助浴 home-care asks', () => {
  const src = fs.readFileSync(path.join(root, 'src/core/orchestrator/chat-orchestrator.js'), 'utf8');
  assert.match(src, /isHomeCareServiceAsk/);
  assert.match(src, /助浴\|助餐\|陪诊/);
  assert.match(src, /!isHomeCareServiceAsk/);
});

test('find_service still owns 助浴 intent terms', () => {
  assert.ok(findServiceRuleSet.evidence_groups.some((g) => (g.terms || []).includes('助浴')));
  assert.ok(
    nearbyResourceRuleSet.conflicts.some((c) => c.group === 'find_service' && (c.terms || []).includes('助浴')),
  );
});

test('nearby map overview must render via iframe (not inlined script-stripped)', async () => {
  const { renderTemplateCardResult } = await import('../src/core/render/template-card-renderer.js');
  const templateDir = path.join(root, 'src/skills/nearby_resource/templates/html');
  const result = renderTemplateCardResult({
    templateDir,
    modelResult: {
      template_id: 'nearby_map_overview',
      answer_text: '周边地图',
      data: {
        centerName: '嘉路康养中心',
        centerLat: 21.527905,
        centerLng: 108.166816,
        radiusKm: 15,
        map_key: 'TEST_KEY',
        center_json: JSON.stringify({ lat: 21.527905, lng: 108.166816, name: '嘉路康养中心' }),
        markers_json: '[]',
        markers: [],
        statsLabels: [],
        static_map_url: '',
        isDefaultLocation: false,
      },
    },
    actions: [],
    followupSuggestions: [],
    compactFollowups: [],
  });
  const html = String(result.rendered_html || result.html_fallback || '');
  assert.equal(result.card?.templateId, 'nearby_map_overview');
  assert.match(html, /iframe class="gxy-template-card-frame"/);
  assert.match(html, /srcdoc="/);
  // iframe 路径保留脚本；若走内联，mobile sanitizeHtmlCard 会剥掉全部 script → 地图空白、选点失效
  assert.match(html, /map\.qq\.com\/api\/gljs/);
});

test('nearby map overview pick works on live and static map', () => {
  const html = fs.readFileSync(
    path.join(root, 'src/skills/nearby_resource/templates/html/nearby_map_overview.html'),
    'utf8',
  );
  assert.match(html, /setPickBtnAvailable/);
  assert.match(html, /mapMode/);
  assert.match(html, /onStaticImgClick/);
  assert.match(html, /flattalk_pick_location/);
  assert.match(html, /静态地图可选点/);
  assert.doesNotMatch(html, /liveTilesOk/);
  assert.equal((html.match(/function init\(/g) || []).length, 1, 'should not duplicate init()');
});
