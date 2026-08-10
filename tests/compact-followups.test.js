import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderCompactFollowups, dedupeFollowups, normalizeCompactFollowups } from '../src/core/compact-followups/renderer.js';
import { renderTemplateCardResult } from '../src/core/render/template-card-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAVEL_TEMPLATE_DIR = path.join(__dirname, '..', 'src', 'skills', 'travel_route', 'templates', 'html');

test('renderCompactFollowups 渲染胶囊 HTML', () => {
  const html = renderCompactFollowups([
    { label: '查天气风险', action_key: 'travel_route.check_weather_risk', params: { city: '防城港' } },
    { label: '立即预定', action_key: 'travel_route.book', style: 'primary' },
  ]);
  assert.ok(html.includes('class="compact-followups"'));
  assert.ok(html.includes('查看天气风险'));
  assert.ok(html.includes('立即预定'));
  assert.ok(html.includes('data-action-key="travel_route.check_weather_risk"'));
  assert.ok(html.includes('data-params='));
  assert.ok(html.includes('compact-chip--primary'));
});

test('renderCompactFollowups 空数组返回空字符串', () => {
  assert.equal(renderCompactFollowups([]), '');
  assert.equal(renderCompactFollowups(null), '');
});

test('renderCompactFollowups 为只有 action_key 的条目补中文标签', () => {
  const html = renderCompactFollowups([
    { label: '', action_key: 'travel_route.check_weather_risk' },
    { label: '   ', action_key: 'travel_route.check_policy_subsidy' },
    { label: '<br>', action_key: 'travel_route.check_transport' },
    { label: '&nbsp;', action_key: 'travel_route.check_medical' },
    { label: '缺少动作' },
    { label: '检查天气风险', action_key: 'travel_route.check_weather_risk' },
  ]);

  assert.ok(html.includes('查看天气风险'));
  assert.ok(html.includes('查询政策补贴'));
  assert.equal(html.includes('travel_route.check_weather_risk</button>'), false);
  assert.equal(html.includes('travel_route.check_transport</button>'), false);
  assert.equal(html.includes('travel_route.check_medical</button>'), false);
  assert.equal((html.match(/class="compact-chip/g) || []).length, 5);
  assert.equal(html.includes('缺少动作'), false);
});

test('normalizeCompactFollowups 无有效条目时返回空数组', () => {
  assert.deepEqual(normalizeCompactFollowups([
    null,
    { label: '', action_key: 'a' },
    { label: '&nbsp;', action_key: 'b' },
    { label: '有标题但无动作' },
  ]), []);
});

test('renderCompactFollowups 带 input 定义渲染 data-input', () => {
  const html = renderCompactFollowups([
    {
      label: '查其他城市',
      action_key: 'travel_route.check_weather_risk',
      input: { type: 'text', placeholder: '输入城市', param_key: 'city' },
    },
  ]);
  assert.ok(html.includes('compact-chip--input'));
  assert.ok(html.includes('data-input='));
  assert.ok(html.includes('"type":"text"'));
});

test('template renderer injects only valid compact followup buttons', () => {
  const result = renderTemplateCardResult({
    templateDir: TRAVEL_TEMPLATE_DIR,
    modelResult: {
      template_id: 'route_card',
      answer_text: '旅居路线',
      data: {
        routeTitle: '防城港康养路线',
        destination: '防城港',
        summary: '已为您推荐路线。',
      },
    },
    compactFollowups: [
      { label: '', action_key: 'travel_route.check_transport' },
      { label: '&nbsp;', action_key: 'travel_route.check_medical' },
      { label: '<br>', action_key: 'travel_route.check_weather_risk' },
      { label: '检查天气风险', action_key: 'travel_route.check_weather_risk' },
    ],
  });

  const compactChips = result.rendered_html.match(/class=&quot;compact-chip/g) || [];
  assert.equal(result.render_status, 'ok');
  assert.equal(compactChips.length, 4);
  assert.ok(result.rendered_html.includes('查看天气风险'));
  assert.equal(result.rendered_html.includes('travel_route.check_weather_risk&lt;/button&gt;'), false);
});

test('dedupeFollowups 按 action_key 去重', () => {
  const compact = [{ label: '查天气', action_key: 'travel_route.check_weather_risk' }];
  const message = [
    { label: '查天气风险', action_key: 'travel_route.check_weather_risk' },
    { label: '其他建议', action_key: 'travel_route.replan' },
  ];
  const result = dedupeFollowups(compact, message);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, '其他建议');
});

test('dedupeFollowups 按 label 语义相近去重', () => {
  const compact = [{ label: '立即预定', action_key: 'travel_route.book' }];
  const message = [
    { label: '预定旅居', action_key: 'travel_route.book_now' },
    { label: '查看路线', action_key: 'travel_route.view' },
  ];
  const result = dedupeFollowups(compact, message);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, '查看路线');
});

test('dedupeFollowups 互逆动作去重', () => {
  const compact = [{ label: '收藏', action_key: 'nearby_resource.favorite' }];
  const message = [
    { label: '取消收藏', action_key: 'nearby_resource.unfavorite' },
    { label: '导航', action_key: 'nearby_resource.navigate' },
  ];
  const result = dedupeFollowups(compact, message);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, '导航');
});

test('dedupeFollowups compact 为空时原样返回 message', () => {
  const result = dedupeFollowups([], [{ label: 'A', action_key: 'a' }]);
  assert.equal(result.length, 1);
});

test('normalizeCompactFollowups does not expose raw action keys', () => {
  const result = normalizeCompactFollowups([
    {
      label: 'meal_plan.adjust_for_condition',
      user_prompt: 'meal_plan.adjust_for_condition',
      action_key: 'meal_plan.adjust_for_condition',
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].label, '按健康状况调整');
  assert.equal(result[0].user_prompt, '按健康状况调整');
  assert.equal(result[0].action_key, 'meal_plan.adjust_for_condition');
});
