import test from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplateSlots } from '../src/core/model-service.js';
import { selectProductTemplate } from '../src/core/route-svg-generator.js';
import {
  buildSnapshot,
  injectSnapshot,
  applyTravelRouteContextLock,
} from '../src/core/conversation/context-snapshot.js';

test('buildSnapshot persists travel route_id and destination', () => {
  const snap = buildSnapshot({
    skill_key: 'travel_route',
    intent: 'travel_route.detail',
    template_id: 'route_ecology',
    turn_id: 't1',
    data: {
      destination: '桂林',
      routeTitle: '桂林-阳朔-贺州山水瑶泉康养旅居线',
      route_id: 'gx_excel_08',
      productId: 'p_guilin',
      publish_match: { route_id: 'gx_excel_08', destination: ['桂林'], title: '桂林阳朔线' },
    },
  });
  assert.equal(snap.destination, '桂林');
  assert.equal(snap.route_id, 'gx_excel_08');
  assert.equal(snap.product_id, 'p_guilin');
  const ctx = injectSnapshot({}, snap);
  assert.equal(ctx.previous_destination, '桂林');
  assert.equal(ctx.previous_route_id, 'gx_excel_08');
});

test('applyTravelRouteContextLock enriches generic product-detail prompt with destination', () => {
  const locked = applyTravelRouteContextLock(
    {},
    {
      context: {
        previous_destination: '桂林',
        previous_route_id: 'gx_excel_08',
        previous_route_title: '桂林-阳朔-贺州山水瑶泉康养旅居线',
        action_params: {},
      },
    },
    '请展示这条旅居产品的详细信息',
  );
  assert.equal(locked.locked, true);
  assert.equal(locked.businessData.destination, '桂林');
  assert.equal(locked.businessData.route_id, 'gx_excel_08');
  assert.match(locked.fillMessage, /桂林/);
  assert.doesNotMatch(locked.fillMessage, /巴马/);
});

test('applyTravelRouteContextLock clears old route when user switches destination to Beihai', () => {
  const locked = applyTravelRouteContextLock(
    {},
    {
      context: {
        previous_destination: '广西七洞乡',
        previous_route_id: 'jtd_2070305000000000271',
        previous_route_title: '0730测试旅居路线5天4日游',
        action_params: {},
      },
    },
    '请把这条旅居路线调整为广西北海方向',
  );
  assert.equal(locked.dest_switched, true);
  assert.match(String(locked.businessData.destination || ''), /北海/);
  assert.equal(locked.businessData.route_id || '', '');
  assert.doesNotMatch(locked.fillMessage, /七洞/);
  assert.match(locked.fillMessage, /北海/);
});

test('view_product_detail prompt includes destination from params', async () => {
  // actionKeyToPrompt is not exported — validate via dispatcher module behavior using fill path params
  const { dispatchAction } = await import('../src/core/actions/action-dispatcher.js');
  let captured = null;
  await dispatchAction(
    {
      action_key: 'travel_route.view_product_detail',
      skill_key: 'travel_route',
      params: { destination: '桂林', route_id: 'gx_excel_08', route_title: '桂林阳朔线' },
    },
    {
      runSkill: async (req) => {
        captured = req;
        return { answer_text: 'ok', data: {} };
      },
    },
  );
  assert.ok(captured);
  assert.match(String(captured.message || ''), /桂林/);
  assert.doesNotMatch(String(captured.message || ''), /巴马/);
  assert.equal(captured.context.action_params.destination, '桂林');
  assert.equal(captured.context.action_params.route_id, 'gx_excel_08');
});

test('selectProductTemplate does not default generic 旅居详情 to Bama wellness sample', () => {
  const hit = selectProductTemplate('请展示这条旅居产品的详细信息', '广西旅居');
  assert.equal(hit, null);
});

test('fillRouteCardLegacy keeps Guilin when business_data locks destination', async () => {
  const result = await fillTemplateSlots({
    message: '请展示这条旅居产品的详细信息 桂林',
    template_id: 'route_svg',
    business_data: {
      destination: '桂林',
      primary_city: '桂林',
      route_id: 'gx_excel_08',
      route_title: '桂林-阳朔-贺州山水瑶泉康养旅居线',
      publish_match: {
        route_id: 'gx_excel_08',
        destination: ['桂林'],
        title: '桂林-阳朔-贺州山水瑶泉康养旅居线',
      },
    },
  });
  assert.ok(result?.data);
  assert.match(String(result.data.destination || ''), /桂林/);
  assert.doesNotMatch(String(result.data.routeTitle || ''), /巴马/);
  assert.doesNotMatch(JSON.stringify(result.data.itinerary || []), /百魔洞|赐福湖|长寿村/);
  const detailFollowup = (result.followup_suggestions || []).find((f) => f.action_key === 'travel_route.view_product_detail');
  assert.ok(detailFollowup);
  assert.equal(detailFollowup.params?.destination, result.data.destination || '桂林');
  assert.ok(detailFollowup.params?.route_id);
});
