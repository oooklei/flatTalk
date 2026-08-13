import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillHealthDrilldownCard } from '../src/core/model-runtime/extra-template-fills.js';
import { pickByLockedId } from '../src/core/conversation/entity-params.js';
import { selectProduct } from '../src/services/travel/jtd-service.js';
import { resolveWeatherCity } from '../src/core/orchestrator/chat-orchestrator.js';
import { composeInteractions } from '../src/core/interaction-composer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('main path fillTemplateSlots uses entityLock.fillMessage', () => {
  const src = fs.readFileSync(path.join(root, 'src/core/orchestrator/chat-orchestrator.js'), 'utf8');
  assert.match(src, /const fillMessage = entityLock\.fillMessage \|\| sceneInput\.text/);
  assert.match(src, /message: fillMessage/);
  assert.match(src, /applySmartFallback\(fModelResult, \{\s*message: fFillMessage/s);
});

test('health drilldowns use followups not actions and stamp elder', () => {
  const card = fillHealthDrilldownCard({
    selectedTemplateId: 'constitution_card',
    business_data: { elder_id: 'e77', elder_name: '周舟' },
  });
  assert.ok(card);
  assert.deepEqual(card.actions, []);
  assert.ok(card.followup_suggestions.length >= 2);
  assert.equal(card.data.elder_id, 'e77');
  for (const f of card.followup_suggestions) {
    assert.equal(f.params?.elder_id, 'e77');
    assert.equal(f.params?.elder_name, '周舟');
    assert.ok(f.user_prompt);
  }

  const composed = composeInteractions({
    sceneDecision: {
      decision: 'accept',
      scene_key: 'health_risk_warning',
      followup_policy: 'none',
      actions_allowed: [],
    },
    modelResult: card,
  });
  assert.equal(composed.actions.length, 0);
  assert.ok(composed.followup_suggestions.some((f) => f.action_key === 'health_risk_warning.view_advice'));
});

test('pickByLockedId does not fall to [0] when locked id misses', () => {
  const list = [{ dispatch_id: 'D1' }, { dispatch_id: 'D2' }];
  assert.equal(
    pickByLockedId(list, 'D_missing', ['dispatch_id'], { allowFallback: false }),
    null,
  );
  assert.equal(
    pickByLockedId(list, 'D2', ['dispatch_id'], { allowFallback: false }).dispatch_id,
    'D2',
  );
});

test('selectProduct never returns products[0] when destination lock misses', () => {
  const products = [
    { product_id: 'p_bama', destination: '巴马', product_name: '巴马康养' },
    { product_id: 'p_fcg', destination: '防城港', product_name: '防城港滨海' },
  ];
  assert.equal(
    selectProduct(products, '查看产品详情', {
      context: { action_params: { destination: '桂林阳朔' } },
    }),
    null,
  );
  assert.equal(
    selectProduct(products, '桂林阳朔旅居', {
      context: { action_params: { destination: '桂林' } },
    }),
    null,
  );
  // 无锁定信号也不静默首条巴马 mock
  assert.equal(selectProduct(products, '随便看看', {}), null);
  assert.equal(
    selectProduct(products, '详情', {
      context: { action_params: { product_id: 'missing' } },
    }),
    null,
  );
  assert.equal(
    selectProduct(products, '防城港旅居', {
      context: { action_params: { destination: '防城港' } },
    })?.product_id,
    'p_fcg',
  );
});

test('followup bypass and weather lock wiring present in orchestrator', () => {
  const src = fs.readFileSync(path.join(root, 'src/core/orchestrator/chat-orchestrator.js'), 'utf8');
  assert.match(src, /context_snapshot: buildSnapshot\(fEnvelope\)/);
  assert.match(src, /entityParams: entityParamsForScene/);
  assert.match(src, /\/\/ 天气也走实体锁/);
  assert.doesNotMatch(src, /const entityLock = \(!isWeatherAction && skillKey\)/);
});

test('dispatch lock also preserves elder_id', async () => {
  const { applyEntityContextLock } = await import('../src/core/conversation/context-snapshot.js');
  const locked = applyEntityContextLock(
    'dispatch_manage',
    {},
    {
      context: {
        previous_dispatch_id: 'D1001',
        previous_elder_id: 'elder_9',
        previous_elder_name: '李奶奶',
      },
    },
    '查看派单进度',
  );
  assert.equal(locked.businessData.dispatch_id, 'D1001');
  assert.equal(locked.businessData.elder_id, 'elder_9');
  assert.equal(locked.businessData.elder_name, '李奶奶');
});

test('find_service snapshot does not take services[0]', async () => {
  const { buildSnapshot } = await import('../src/core/conversation/context-snapshot.js');
  const snap = buildSnapshot({
    skill_key: 'find_service',
    template_id: 'service_catalog',
    data: {
      services: [{ id: 'svc_wrong' }, { id: 'svc_other' }],
      sceneTitle: '目录',
    },
  });
  assert.equal(snap.service_id || '', '');
});

test('inferRouteType does not default generic prompts to wellness/Bama', async () => {
  const { inferRouteType } = await import('../src/core/scene-router/rules/travel-route.js');
  assert.equal(inferRouteType('查看产品详情'), '');
  assert.equal(inferRouteType('请展示这条旅居产品的详细信息'), '');
  assert.equal(inferRouteType('巴马康养'), 'route_wellness');
  assert.equal(inferRouteType('北海银滩'), 'route_coastal');
});

test('resolveWeatherCity does not use products[0]/routes[0]', () => {
  assert.deepEqual(
    resolveWeatherCity(
      {},
      {
        jtd: { products: [{ destination: '巴马' }] },
        routes: [{ destination: '巴马' }],
      },
    ),
    [],
  );
  assert.deepEqual(
    resolveWeatherCity(
      { context: { previous_destination: '桂林' } },
      {},
    ),
    ['桂林'],
  );
  assert.deepEqual(
    resolveWeatherCity({}, { destination: '阳朔', jtd: { products: [{ destination: '巴马' }] } }),
    ['阳朔'],
  );
});
