import test from 'node:test';
import assert from 'node:assert/strict';

import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';
import { createDataService } from '../src/services/data-service.js';
import {
  buildSigningText,
  compactJson,
  createJtdClient,
  hmacSha256Hex,
  sha256Hex,
} from '../src/services/travel/jtd-client.js';
import { createJtdTravelService, normalizeSearchRecords } from '../src/services/travel/jtd-service.js';

test('jtd client builds canonical HMAC signed request headers', () => {
  const client = createJtdClient({
    baseUrl: 'https://ljutest.jtdcn.cn',
    appId: 'ai_test_app',
    appSecret: 'test_secret',
  });
  const payload = { city: '北海', days: 3 };
  const bodyText = compactJson(payload);
  const bodySha256 = sha256Hex(bodyText);
  const signingText = buildSigningText({
    method: 'POST',
    pathWithQuery: '/jtd-applet/ai/sojourn/searchProducts',
    timestamp: '1784356789000',
    nonce: '550e8400-e29b-41d4-a716-446655440000',
    bodySha256,
  });
  const signed = client.buildSignedRequest('searchProducts', payload, {
    timestamp: '1784356789000',
    nonce: '550e8400-e29b-41d4-a716-446655440000',
  });

  assert.equal(signed.bodyText, bodyText);
  assert.equal(signed.bodySha256, bodySha256);
  assert.equal(signed.signingText, signingText);
  assert.equal(signed.headers['X-AI-App-Id'], 'ai_test_app');
  assert.equal(signed.headers['X-AI-Sign'], hmacSha256Hex('test_secret', signingText));
});

test('jtd client accepts legacy travel product env aliases from old config registry', () => {
  const client = createJtdClient({
    env: {
      TRAVEL_PRODUCT_API_BASE_URL: 'https://legacy.example.test',
      TRAVEL_PRODUCT_API_APP_ID: 'legacy_app',
      TRAVEL_PRODUCT_API_APP_SECRET: 'legacy_secret',
      JTD_PATH_PREFIX: '/legacy/sojourn',
    },
  });

  assert.equal(client.isConfigured(), true);
  assert.equal(client.config.baseUrl, 'https://legacy.example.test');
  assert.equal(client.config.appId, 'legacy_app');
  assert.equal(client.config.appSecret, 'legacy_secret');
  assert.equal(client.config.pathPrefix, '/legacy/sojourn');
});

test('jtd auto mode without credentials uses mock data without config_missing fallback', async () => {
  const service = createJtdTravelService({
    mode: 'auto',
    clientOptions: { env: {} },
  });
  const context = await service.buildRouteProductContext({
    message: '我想去百色巴马旅游，请帮规划路线',
  });

  assert.equal(service.mode, 'mock');
  assert.equal(context.configured_mode, 'auto');
  assert.equal(context.source_status, 'mock_vendor_data');
  assert.equal(context.calls[0].error, null);
});

test('jtd service normalizes searchProducts records and marks mock vendor data', async () => {
  const service = createJtdTravelService({ mode: 'mock' });
  const context = await service.buildRouteProductContext({
    message: '想去北海康养旅居4天，预算经济一点',
  });

  assert.equal(context.provider, 'jintiaodong');
  assert.equal(context.source_status, 'mock_vendor_data');
  assert.ok(context.products.length >= 1);
  assert.equal(context.selected_product.destination, '广西北海');
  assert.ok(context.selected_product.product_id);
  assert.equal(context.availability, null);
  assert.ok(context.warnings.includes('jtd_mock_vendor_data'));
});

test('jtd service runs availability only for availability or booking triggers', async () => {
  const service = createJtdTravelService({ mode: 'mock' });
  const context = await service.buildRouteProductContext({
    message: '检查这条北海旅居路线8月是否可订',
    context: { action_key: 'travel_route.check_availability' },
    params: { check_in: '2026-08-01', check_out: '2026-08-04' },
  });

  assert.equal(context.availability.endpoint, 'checkAvailability');
  assert.equal(context.availability.normalized.source_status, 'mock_vendor_data');
  assert.equal(typeof context.availability.normalized.available, 'boolean');
});

test('travel_route availability action renders dedicated availability card', async () => {
  const dataService = createDataService({
    travelData: { jtdOptions: { mode: 'mock' } },
  });
  const result = await runLocalSkill({
    conversation_id: 'conv_jtd_availability',
    turn_id: 'turn_jtd_availability',
    skill_key: 'travel_route',
    message: '检查这条北海旅居路线近期是否可预订',
    context: {
      action_key: 'travel_route.check_availability',
      action_params: {
        check_in: '2026-08-10',
        check_out: '2026-08-13',
        people_count: 2,
      },
    },
  }, { dataService });

  assert.equal(result.skill_key, 'travel_route');
  assert.equal(result.template_id, 'travel_availability_card');
  assert.equal(result.card.templateId, 'travel_availability_card');
  assert.equal(result.data.availabilitySourceStatus, 'mock_vendor_data');
  assert.equal(typeof result.data.availabilityAvailable, 'boolean');
  assert.match(result.answer_text, /可订|不可订|mock/);
});

test('travel_route orchestration injects JTD context before filling route card', async () => {
  const dataService = createDataService({
    travelData: { jtdOptions: { mode: 'mock' } },
  });
  const result = await runLocalSkill({
    conversation_id: 'conv_jtd_mock',
    turn_id: 'turn_jtd_mock',
    message: '帮老人规划广西北海康养旅居路线',
    role: 'elder_family',
  }, { dataService });

  assert.equal(result.skill_key, 'travel_route');
  assert.equal(result.template_id, 'route_card');
  assert.equal(result.data.jtdStatus, 'mock_vendor_data');
  assert.ok(result.data.productId);
  assert.ok(result.actions.some((action) => action.action_key === 'travel_route.check_availability'));
});

test('travel_route real mode without JTD credentials returns remote gap and disables availability action', async () => {
  const dataService = createDataService({
    travelData: {
      jtdOptions: {
        mode: 'real',
        appSecret: '',
        env: {},
      },
    },
  });
  const result = await runLocalSkill({
    conversation_id: 'conv_jtd_gap',
    turn_id: 'turn_jtd_gap',
    message: '帮老人规划广西巴马康养旅居路线',
    role: 'elder_family',
  }, { dataService });

  assert.equal(result.skill_key, 'travel_route');
  assert.equal(result.data.jtdStatus, 'unavailable');
  assert.equal(result.actions.some((action) => action.action_key === 'travel_route.check_availability'), false);
  assert.ok(result.actions.some((action) => action.action_key === 'travel_route.request_manual_review'));
  assert.match(result.answer_text, /金跳动旅居产品接口当前不可用/);
});

test('normalizeSearchRecords ignores unavailable JTD search result', () => {
  assert.deepEqual(normalizeSearchRecords({ ok: false, source_status: 'unavailable' }), []);
});
