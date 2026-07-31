import test from 'node:test';
import assert from 'node:assert/strict';

import { renderCompactFollowups, dedupeFollowups } from '../src/core/compact-followups/renderer.js';

test('renderCompactFollowups 渲染胶囊 HTML', () => {
  const html = renderCompactFollowups([
    { label: '查天气风险', action_key: 'travel_route.check_weather_risk', params: { city: '防城港' } },
    { label: '立即预定', action_key: 'travel_route.book', style: 'primary' },
  ]);
  assert.ok(html.includes('class="compact-followups"'));
  assert.ok(html.includes('查天气风险'));
  assert.ok(html.includes('立即预定'));
  assert.ok(html.includes('data-action-key="travel_route.check_weather_risk"'));
  assert.ok(html.includes('data-params='));
  assert.ok(html.includes('compact-chip--primary'));
});

test('renderCompactFollowups 空数组返回空字符串', () => {
  assert.equal(renderCompactFollowups([]), '');
  assert.equal(renderCompactFollowups(null), '');
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
