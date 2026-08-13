import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnapshot,
  injectSnapshot,
  applyEntityContextLock,
  applyTravelRouteContextLock,
  SCENE_ENTITY_KEYS,
} from '../src/core/conversation/context-snapshot.js';

test('SCENE_ENTITY_KEYS covers core business scenes', () => {
  for (const scene of [
    'travel_route',
    'health_risk_warning',
    'find_service',
    'dispatch_manage',
    'nearby_resource',
    'meal_plan',
    'service_quality_eval',
  ]) {
    assert.ok(Array.isArray(SCENE_ENTITY_KEYS[scene]) && SCENE_ENTITY_KEYS[scene].length > 0, scene);
  }
});

test('health snapshot + lock preserves elder across generic followup prompt', () => {
  const snap = buildSnapshot({
    skill_key: 'health_risk_warning',
    template_id: 'health_warning_card',
    data: { elder_id: 'elder_001', elder_name: '周舟', elderName: '周舟' },
  });
  assert.equal(snap.entity_type, 'elder');
  assert.equal(snap.elder_id, 'elder_001');
  assert.equal(snap.elder_name, '周舟');

  const ctx = injectSnapshot({}, snap);
  const locked = applyEntityContextLock(
    'health_risk_warning',
    {},
    { context: ctx, params: {} },
    '请重新读取设备健康信号',
  );
  assert.equal(locked.locked, true);
  assert.equal(locked.businessData.elder_id, 'elder_001');
  assert.equal(locked.businessData.elder_name, '周舟');
  assert.match(locked.fillMessage, /周舟/);
});

test('dispatch snapshot + lock preserves dispatch_id', () => {
  const snap = buildSnapshot({
    skill_key: 'dispatch_manage',
    template_id: 'dispatch_detail',
    data: { dispatchId: 'D1001', orderId: 'O2002', workerName: '韦芳' },
  });
  assert.equal(snap.dispatch_id, 'D1001');
  assert.equal(snap.order_id, 'O2002');

  const locked = applyEntityContextLock(
    'dispatch_manage',
    {},
    { context: injectSnapshot({}, snap) },
    '帮我查看这条派单的进度',
  );
  assert.equal(locked.businessData.dispatch_id, 'D1001');
  assert.equal(locked.businessData.order_id, 'O2002');
  assert.match(locked.fillMessage, /D1001/);
});

test('find_service lock prefers button params over previous', () => {
  const locked = applyEntityContextLock(
    'find_service',
    { service_id: 'old_svc' },
    {
      context: {
        previous_service_id: 'prev_svc',
        action_params: { service_id: 'svc_new', elder_name: '李奶奶' },
      },
    },
    '查看推荐服务的详情',
  );
  assert.equal(locked.businessData.service_id, 'svc_new');
  assert.equal(locked.businessData.elder_name, '李奶奶');
});

test('nearby lock keeps center anchor', () => {
  const locked = applyEntityContextLock(
    'nearby_resource',
    {},
    { context: { previous_center: '嘉路康养中心', previous_category: 'medical' } },
    '只看医疗',
  );
  assert.equal(locked.businessData.center, '嘉路康养中心');
  assert.equal(locked.businessData.category, 'medical');
});

test('quality lock keeps org', () => {
  const locked = applyEntityContextLock(
    'service_quality_eval',
    {},
    { context: { previous_org_id: 'org_9', previous_org_name: '青秀区颐养中心' } },
    '查看机构报告',
  );
  assert.equal(locked.businessData.org_id, 'org_9');
  assert.match(locked.fillMessage, /青秀区颐养中心/);
});

test('travel lock still works via applyEntityContextLock alias', () => {
  const a = applyEntityContextLock(
    'travel_route',
    {},
    { context: { previous_destination: '桂林', previous_route_id: 'gx_excel_08' } },
    '查看产品详情',
  );
  const b = applyTravelRouteContextLock(
    {},
    { context: { previous_destination: '桂林', previous_route_id: 'gx_excel_08' } },
    '查看产品详情',
  );
  assert.equal(a.businessData.destination, '桂林');
  assert.equal(a.businessData.route_id, b.businessData.route_id);
  assert.match(a.fillMessage, /桂林/);
});
