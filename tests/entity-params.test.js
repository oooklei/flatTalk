import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickByLockedId,
  withEntityParams,
  elderEntityParams,
  findServiceEntityParams,
  dispatchEntityParams,
  nearbyEntityParams,
  qualityEntityParams,
  entityParamsForScene,
} from '../src/core/conversation/entity-params.js';
import { composeInteractions } from '../src/core/interaction-composer.js';

test('pickByLockedId prefers locked id over list[0]', () => {
  const list = [
    { service_id: 'svc_a', name: 'A' },
    { service_id: 'svc_b', name: 'B' },
  ];
  const hit = pickByLockedId(list, 'svc_b', ['service_id', 'id']);
  assert.equal(hit.name, 'B');
});

test('pickByLockedId falls back to first when unlocked', () => {
  const list = [{ dispatch_id: 'D1' }, { dispatch_id: 'D2' }];
  assert.equal(pickByLockedId(list, '', ['dispatch_id']).dispatch_id, 'D1');
  assert.equal(pickByLockedId(list, 'missing', ['dispatch_id'], { allowFallback: false }), null);
});

test('withEntityParams stamps and does not overwrite existing item params', () => {
  const stamped = withEntityParams(
    [
      { label: '详情', action_key: 'find_service.detail', params: { service_id: 'keep_me' } },
      { label: '下单', action_key: 'find_service.order' },
    ],
    { service_id: 'from_lock', elder_name: '李奶奶' },
  );
  assert.equal(stamped[0].params.service_id, 'keep_me');
  assert.equal(stamped[0].params.elder_name, '李奶奶');
  assert.equal(stamped[1].params.service_id, 'from_lock');
});

test('entityParamsForScene routes by scene', () => {
  assert.equal(entityParamsForScene('meal_plan', { elder_id: 'e1' }).elder_id, 'e1');
  assert.equal(entityParamsForScene('dispatch_manage', { dispatchId: 'D9' }).dispatch_id, 'D9');
  assert.equal(entityParamsForScene('nearby_resource', { center: '阳朔' }).center, '阳朔');
  assert.equal(entityParamsForScene('service_quality_eval', { orgId: 'o1', orgName: '颐养' }).org_id, 'o1');
  assert.equal(findServiceEntityParams({ service_id: 's1' }, { elder_name: '王大爷' }).elder_name, '王大爷');
  assert.equal(dispatchEntityParams({}, { order_id: 'O1' }).order_id, 'O1');
  assert.equal(qualityEntityParams({}, { org_name: '青秀' }).org_name, '青秀');
  assert.equal(nearbyEntityParams({}, {}).center, '嘉路康养中心');
  assert.equal(elderEntityParams({ elderName: '周舟' }, {}).elder_name, '周舟');
});

test('composeInteractions stamps locked entity onto default meal followups', () => {
  const composed = composeInteractions({
    sceneDecision: {
      decision: 'accept',
      scene_key: 'meal_plan',
      followup_policy: 'meal_plan.default',
      actions_allowed: [],
    },
    modelResult: {
      data: { elder_id: 'elder_88', elder_name: '张爷爷' },
      followup_suggestions: [],
      actions: [],
    },
  });
  assert.ok(composed.followup_suggestions.length > 0);
  for (const item of composed.followup_suggestions) {
    assert.equal(item.params?.elder_id, 'elder_88');
    assert.equal(item.params?.elder_name, '张爷爷');
  }
});

test('composeInteractions stamps travel destination onto followups from data', () => {
  const composed = composeInteractions({
    sceneDecision: {
      decision: 'accept',
      scene_key: 'travel_route',
      followup_policy: 'travel_route.default',
      actions_allowed: [],
    },
    modelResult: {
      data: {
        destination: '桂林阳朔',
        route_id: 'gx_excel_08',
        routeTitle: '桂林阳朔三日游',
      },
      followup_suggestions: [
        { label: '查看产品详情', user_prompt: '查看产品详情', action_key: 'travel_route.view_product' },
      ],
      actions: [],
    },
  });
  const detail = composed.followup_suggestions.find((f) => f.action_key === 'travel_route.view_product');
  assert.ok(detail);
  assert.equal(detail.params.destination, '桂林阳朔');
  assert.equal(detail.params.route_id, 'gx_excel_08');
});
