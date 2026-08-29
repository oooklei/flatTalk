import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  tryLisGate,
  isLisGateEnabled,
  getLisBaseUrl,
  getLisSortRetries,
  LIS_GATE_ENABLED,
  LIS_BASE_URL,
  loadCatalogEntries,
} from '../src/core/lis/lis-gate-hook.js';

const CATALOG = [
  {
    intent_id: 'nearby_resource.food',
    enabled: true,
    entry: { skill_key: 'nearby_resource', template_id: 'nearby_food_card' },
  },
  {
    intent_id: 'travel_route_weather_risk',
    enabled: true,
    entry: { skill_key: 'travel_route', template_id: 'travel_weather_risk_card' },
  },
  {
    intent_id: 'travel_route_plan',
    enabled: true,
    entry: { skill_key: 'travel_route', template_id: 'route_svg' },
  },
  {
    intent_id: 'health_risk_warning.tongue',
    enabled: true,
    entry: { skill_key: 'health_risk_warning', template_id: 'tongue_diagnosis_card' },
  },
];

function sessionWithTurns(turnCount = 3) {
  const turns = [];
  for (let i = 1; i <= turnCount; i += 1) {
    turns.push({
      turn_id: `t${i}`,
      user_text: `user turn ${i}`,
      assistant_text: `assistant turn ${i}`,
      envelope: { skill_key: 'travel_route', intent: 'travel_route_plan' },
    });
  }
  return {
    conversation_id: 'conv_lis_gate',
    active_agent: 'travel_route',
    turns,
    global_context: {},
  };
}

describe('LIS gate env helpers', () => {
  it('exports LIS_GATE_ENABLED and LIS_BASE_URL keys', () => {
    assert.equal(LIS_GATE_ENABLED, 'LIS_GATE_ENABLED');
    assert.equal(LIS_BASE_URL, 'LIS_BASE_URL');
  });

  it('isLisGateEnabled is false unless exactly 1', () => {
    assert.equal(isLisGateEnabled({ LIS_GATE_ENABLED: '1' }), true);
    assert.equal(isLisGateEnabled({ LIS_GATE_ENABLED: '0' }), false);
    assert.equal(isLisGateEnabled({}), false);
  });

  it('getLisBaseUrl defaults to local LIS', () => {
    assert.equal(getLisBaseUrl({}), 'http://127.0.0.1:8100');
    assert.equal(getLisBaseUrl({ LIS_BASE_URL: 'http://lis:8100/' }), 'http://lis:8100');
  });

  it('getLisSortRetries defaults to 2', () => {
    assert.equal(getLisSortRetries({}), 2);
    assert.equal(getLisSortRetries({ LIS_SORT_RETRIES: '0' }), 0);
  });
});

describe('tryLisGate pure SORT (mock lisClient)', () => {
  let prevFlag;

  before(() => {
    prevFlag = process.env.LIS_GATE_ENABLED;
    process.env.LIS_GATE_ENABLED = '1';
  });

  after(() => {
    if (prevFlag === undefined) delete process.env.LIS_GATE_ENABLED;
    else process.env.LIS_GATE_ENABLED = prevFlag;
  });

  beforeEach(() => {
    process.env.LIS_GATE_ENABLED = '1';
  });

  it('action_key still calls sort (no Skill Lock defer)', async () => {
    let sorted = false;
    const lisClient = {
      async sort() {
        sorted = true;
        return {
          decision: { status: 'MATCH_OK', max_confidence: 0.9, threshold: 0.5 },
          intents: [{ intent_id: 'health_risk_warning.tongue', role: 'primary', confidence: 0.9 }],
        };
      },
      async boundary() { throw new Error('boundary must not be called'); },
    };
    const r = await tryLisGate({
      request: {
        message: '查看舌诊详情',
        context: { action_key: 'health_risk_warning.view_tongue' },
      },
      session: { conversation_id: 'c', turns: [], global_context: {} },
      catalogEntries: CATALOG,
      lisClient,
    });
    assert.equal(sorted, true);
    assert.equal(r.mode, 'SORT');
    assert.notEqual(r.reason, 'defer_action_key');
    assert.equal(r.handled, true);
    assert.equal(r.template_id, 'tongue_diagnosis_card');
  });

  it('free text with history still sorts (no boundary)', async () => {
    const calls = { sort: 0, boundary: 0 };
    const lisClient = {
      async sort() {
        calls.sort += 1;
        return {
          decision: { status: 'MATCH_OK', max_confidence: 0.9 },
          intents: [
            { intent_id: 'travel_route_weather_risk', confidence: 0.9, role: 'primary' },
          ],
        };
      },
      async boundary() {
        calls.boundary += 1;
        return {};
      },
    };
    const session = sessionWithTurns(2);
    session.global_context.routing_ticket = {
      ticket_id: 'stale',
      domain: 'travel_route',
      issued_at: new Date().toISOString(),
      ttl_seconds: 1800,
    };
    const result = await tryLisGate({
      request: { message: '那天气怎么样', conversation_id: 'conv_lis_gate', context: {} },
      session,
      catalogEntries: CATALOG,
      lisClient,
    });
    assert.equal(calls.boundary, 0);
    assert.equal(calls.sort, 1);
    assert.equal(result.handled, true);
    assert.equal(result.mode, 'SORT');
    assert.equal(result.skill_key, 'travel_route');
    assert.equal(session.global_context.routing_ticket, null);
  });

  it('MATCH_OK does not persist routing_ticket', async () => {
    const lisClient = {
      async sort() {
        return {
          decision: { status: 'MATCH_OK', max_confidence: 0.88 },
          intents: [
            { intent_id: 'nearby_resource.food', confidence: 0.88, role: 'primary' },
          ],
          routing_ticket: {
            ticket_id: 'tkt_food',
            domain: 'nearby_resource',
            issued_at: new Date().toISOString(),
            ttl_seconds: 1800,
          },
        };
      },
    };
    const session = sessionWithTurns(0);
    const result = await tryLisGate({
      request: { message: '附近有什么好吃的', conversation_id: 'conv_lis_gate', context: {} },
      session,
      catalogEntries: CATALOG,
      lisClient,
    });
    assert.equal(result.handled, true);
    assert.equal(result.mode, 'SORT');
    assert.equal(result.skill_key, 'nearby_resource');
    assert.equal(session.global_context.routing_ticket, null);
    assert.equal(session.global_context.lis_locked_scene, 'nearby_resource');
  });

  it('flag off → handled false and no LIS calls', async () => {
    process.env.LIS_GATE_ENABLED = '0';
    const calls = { sort: 0 };
    const result = await tryLisGate({
      request: { message: '你好', context: {} },
      session: sessionWithTurns(0),
      catalogEntries: CATALOG,
      lisClient: { async sort() { calls.sort += 1; return {}; } },
    });
    assert.equal(result.handled, false);
    assert.equal(calls.sort, 0);
  });

  it('reenter clears pending and sorts', async () => {
    const calls = { sort: 0 };
    const session = sessionWithTurns(2);
    session.global_context.routing_ticket = { ticket_id: 'x' };
    const result = await tryLisGate({
      request: {
        message: '重新开始',
        context: { reenter_chat: true, action_key: 'x' },
      },
      session,
      catalogEntries: CATALOG,
      lisClient: {
        async sort() {
          calls.sort += 1;
          return { decision: { status: 'NEED_CLARIFY', max_confidence: 0.2 }, intents: [] };
        },
      },
    });
    assert.equal(session.global_context.routing_ticket, null);
    assert.equal(calls.sort, 1);
    assert.equal(result.handled, false);
    assert.equal(result.mode, 'SORT');
  });

  it('NEED_CLARIFY stores pending supply and returns ambiguity options', async () => {
    const lisClient = {
      async sort() {
        return {
          decision: { status: 'NEED_CLARIFY', max_confidence: 0.2 },
          intents: [],
          clarify: {
            question: '您更想办理哪一件事？',
            options: [
              { label: '旅居线路', intent_id: 'travel_route_plan', confidence: 0.4 },
              { label: '周边餐饮', intent_id: 'nearby_resource.food', confidence: 0.3 },
            ],
          },
          trace_id: 'lis_clarify_1',
        };
      },
      async clarify() { throw new Error('should not clarify yet'); },
    };
    const session = { conversation_id: 'c_clarify', turns: [], global_context: {} };
    const result = await tryLisGate({
      request: { message: '今天心情不错随便聊聊', conversation_id: 'c_clarify', context: {} },
      session,
      catalogEntries: CATALOG,
      lisClient,
    });
    assert.equal(result.need_clarify, true);
    assert.equal(result.mode, 'CLARIFY');
    assert.ok(session.global_context.pending_clarify_supply);
    assert.equal(result.ambiguity_options.length, 2);
  });

  it('pending clarify + selected_intent_id → clarify resolve → MATCH_OK', async () => {
    const calls = { clarify: 0 };
    const pending = {
      decision: { status: 'NEED_CLARIFY', max_confidence: 0.2, clarify_round: 0 },
      intents: [],
      clarify: { question: '?', options: [{ intent_id: 'travel_route_plan', label: '旅居' }] },
      utterance: '随便聊聊',
      trace_id: 'lis_prev',
      slots: {},
    };
    const lisClient = {
      async sort() { throw new Error('sort should not run'); },
      async clarify(body) {
        calls.clarify += 1;
        assert.equal(body.mode, 'resolve');
        assert.equal(body.selected_intent_id, 'travel_route_plan');
        return {
          decision: { status: 'MATCH_OK', max_confidence: 0.9 },
          intents: [{ intent_id: 'travel_route_plan', confidence: 0.9, role: 'primary' }],
        };
      },
    };
    const session = {
      conversation_id: 'c_clarify2',
      turns: [],
      global_context: { pending_clarify_supply: pending },
    };
    const result = await tryLisGate({
      request: {
        message: '旅居线路',
        conversation_id: 'c_clarify2',
        context: { lis_clarify_intent_id: 'travel_route_plan' },
      },
      session,
      catalogEntries: CATALOG,
      lisClient,
    });
    assert.equal(calls.clarify, 1);
    assert.equal(result.handled, true);
    assert.equal(result.skill_key, 'travel_route');
    assert.equal(session.global_context.pending_clarify_supply, null);
    assert.equal(session.global_context.routing_ticket, null);
  });

  it('sort retries then returns lis_unreachable', async () => {
    process.env.LIS_SORT_RETRIES = '2';
    let n = 0;
    const result = await tryLisGate({
      request: { message: '舌诊详情', conversation_id: 'c_down', context: {} },
      session: { conversation_id: 'c_down', turns: [], global_context: {} },
      catalogEntries: CATALOG,
      lisClient: {
        async sort() {
          n += 1;
          throw new Error('ECONNREFUSED');
        },
      },
      breaker: {
        shouldSkip: () => false,
        recordSuccess() {},
        recordFailure() {},
      },
    });
    assert.equal(n, 3);
    assert.equal(result.handled, false);
    assert.equal(result.reason, 'lis_unreachable');
    delete process.env.LIS_SORT_RETRIES;
  });
});

describe('loadCatalogEntries smoke', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(loadCatalogEntries()));
  });
});
