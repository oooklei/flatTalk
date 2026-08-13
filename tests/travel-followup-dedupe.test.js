import test from 'node:test';
import assert from 'node:assert/strict';
import { composeInteractions } from '../src/core/interaction-composer.js';

function accept(scene_key, followup_policy = 'none') {
  return { decision: 'accept', scene_key, actions_allowed: [], followup_policy };
}

test('travel followups dedupe weather/budget/availability aliases to one each', () => {
  const out = composeInteractions({
    sceneDecision: accept('travel_route'),
    modelResult: {
      actions: [],
      followup_suggestions: [
        { label: '天气风险', user_prompt: '查天气', action_key: 'travel_route.check_weather_risk' },
        { label: '查询天气风险', user_prompt: '请查询天气风险' },
        { label: '查看天气风险', user_prompt: '请查看目的地天气风险' },
        { label: '测算预算', user_prompt: '测算预算', action_key: 'travel_route.calculate_budget' },
        { label: '测算旅居预算', user_prompt: '请测算旅居预算' },
        { label: '检查可订', user_prompt: '检查可订', action_key: 'travel_route.check_availability' },
        { label: '查可订状态', user_prompt: '查可订状态' },
        { label: '对比目的地', user_prompt: '对比目的地', action_key: 'travel_route.compare_destinations' },
      ],
      compact_followups: [],
    },
    staticFollowups: [],
  });

  assert.equal(out.actions.length, 0);
  const labels = out.followup_suggestions.map((f) => f.label);
  assert.equal(labels.filter((l) => /天气/.test(l)).length, 1, `weather dupes: ${labels.join(',')}`);
  assert.equal(labels.filter((l) => /预算/.test(l)).length, 1, `budget dupes: ${labels.join(',')}`);
  assert.equal(labels.filter((l) => /可订/.test(l)).length, 1, `availability dupes: ${labels.join(',')}`);
  assert.equal(labels.filter((l) => /对比/.test(l)).length, 1);
});

test('compact weather strips message followup weather by action_key', () => {
  const out = composeInteractions({
    sceneDecision: accept('travel_route'),
    modelResult: {
      actions: [],
      followup_suggestions: [
        { label: '天气风险', user_prompt: '查天气', action_key: 'travel_route.check_weather_risk' },
        { label: '测算预算', user_prompt: '测算预算', action_key: 'travel_route.calculate_budget' },
      ],
      compact_followups: [
        { label: '天气风险', action_key: 'travel_route.check_weather_risk', user_prompt: '查天气' },
      ],
    },
    staticFollowups: [],
  });

  assert.equal(out.compact_followups.length, 1);
  assert.ok(!out.followup_suggestions.some((f) => /天气/.test(f.label)));
  assert.ok(out.followup_suggestions.some((f) => /预算/.test(f.label)));
});

test('prefer followups: overlapping actions are stripped by action_key', () => {
  const out = composeInteractions({
    sceneDecision: accept('find_service'),
    modelResult: {
      actions: [
        { action_key: 'find_service.catalog', label: '全部服务', params: {} },
        { action_key: 'find_service.recommend', label: '智能推荐', params: {} },
        { action_key: 'find_service.list_workers', label: '找护理人员', params: {} },
      ],
      followup_suggestions: [
        { label: '全部服务', user_prompt: '查看全部养老服务目录', action_key: 'find_service.catalog' },
        { label: '智能推荐', user_prompt: '请智能推荐适合的养老服务', action_key: 'find_service.recommend' },
        { label: '找护工上门', user_prompt: '我想找护工上门护理', action_key: 'find_service.list_workers' },
      ],
      compact_followups: [],
    },
    staticFollowups: [],
  });

  assert.equal(out.actions.length, 0, `leftover actions: ${JSON.stringify(out.actions)}`);
  assert.equal(out.followup_suggestions.length, 3);
});

test('nearby default policy does not emit duplicate action bar', () => {
  const out = composeInteractions({
    sceneDecision: accept('nearby_resource', 'nearby_resource.default'),
    modelResult: {
      actions: [
        { action_key: 'nearby_resource.medical', label: '只看医疗' },
        { action_key: 'nearby_resource.food', label: '只看餐馆' },
      ],
      followup_suggestions: [
        { label: '只看医疗', user_prompt: '请展示医疗资源', action_key: 'nearby_resource.medical' },
      ],
      compact_followups: [],
    },
    staticFollowups: [],
  });

  assert.equal(out.actions.length, 0);
  const medical = out.followup_suggestions.filter((f) => f.action_key === 'nearby_resource.medical');
  assert.equal(medical.length, 1);
});

test('health aliases dedupe 调理方案 / 人工复核', () => {
  const out = composeInteractions({
    sceneDecision: accept('health_risk_warning'),
    modelResult: {
      actions: [],
      followup_suggestions: [
        { label: '查看调理方案', user_prompt: '查看个性化调理方案' },
        { label: '调理方案', user_prompt: '请给出调理方案' },
        { label: '转人工复核', user_prompt: '转人工复核' },
        { label: '请求人工复核', user_prompt: '请求人工复核' },
      ],
      compact_followups: [],
    },
    staticFollowups: [],
  });

  const labels = out.followup_suggestions.map((f) => f.label);
  assert.equal(labels.filter((l) => /调理方案/.test(l)).length, 1, labels.join(','));
  assert.equal(labels.filter((l) => /人工复核/.test(l)).length, 1, labels.join(','));
  assert.equal(out.actions.length, 0);
});

test('dispatch followups strip overlapping list/status actions', () => {
  const out = composeInteractions({
    sceneDecision: accept('dispatch_manage'),
    modelResult: {
      actions: [
        { action_key: 'dispatch_manage.list', label: '派单列表' },
        { action_key: 'dispatch_manage.status', label: '查看进度' },
      ],
      followup_suggestions: [
        { label: '返回列表', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
        { label: '查看进度', user_prompt: '帮我查看这条派单的进度', action_key: 'dispatch_manage.status' },
      ],
      compact_followups: [],
    },
    staticFollowups: [],
  });

  assert.equal(out.actions.length, 0);
  assert.equal(out.followup_suggestions.length, 2);
});
