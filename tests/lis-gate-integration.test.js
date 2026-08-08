import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  tryLisGate,
  isLisGateEnabled,
  getLisBaseUrl,
  LIS_GATE_ENABLED,
  LIS_BASE_URL,
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
];

function freshTicket(overrides = {}) {
  return {
    ticket_id: 'tkt_test_travel',
    lis_version: '1.0',
    domain: 'travel_route',
    primary_intent_id: 'travel_route_plan',
    issued_at: new Date().toISOString(),
    ttl_seconds: 1800,
    clarify_round: 0,
    signature: '',
    ...overrides,
  };
}

function sessionWithTurns(turnCount = 3, ticket = null) {
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
    global_context: { routing_ticket: ticket },
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
});

describe('tryLisGate (mock lisClient)', () => {
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

  it('a) action_key + valid ticket → SKILL_LOCK; sort/boundary NEVER called', async () => {
    const calls = { sort: 0, boundary: 0 };
    const lisClient = {
      async sort() {
        calls.sort += 1;
        return {};
      },
      async boundary() {
        calls.boundary += 1;
        return {};
      },
    };
    const ticket = freshTicket();
    const session = sessionWithTurns(2, ticket);
    const result = await tryLisGate({
      request: {
        message: '查看天气',
        skill_key: 'travel_route',
        template_id: 'travel_weather_risk_card',
        conversation_id: 'conv_lis_gate',
        context: { action_key: 'travel_route.check_weather_risk' },
      },
      session,
      catalogEntries: CATALOG,
      lisClient,
      snapshot: { scene: 'travel_route' },
    });

    assert.equal(result.handled, true);
    assert.equal(result.mode, 'SKILL_LOCK');
    assert.equal(result.skill_key, 'travel_route');
    assert.equal(calls.sort, 0);
    assert.equal(calls.boundary, 0);
    assert.ok(session.global_context.routing_ticket);
  });

  it('b) valid ticket + free text + dialogue turns>=3 → boundary called once', async () => {
    const calls = { sort: 0, boundary: 0 };
    const lisClient = {
      async sort() {
        calls.sort += 1;
        return {};
      },
      async boundary(body) {
        calls.boundary += 1;
        assert.ok(body.routing_ticket);
        assert.ok(Array.isArray(body.dialogue?.turns));
        assert.ok(body.dialogue.turns.length >= 3);
        return {
          status: 'STAY',
          routing_ticket: body.routing_ticket,
          intents: [
            { intent_id: 'travel_route_weather_risk', confidence: 0.9, role: 'primary' },
          ],
        };
      },
    };
    // 2 session turns → 4 dialogue turns (>=3)
    const ticket = freshTicket();
    const session = sessionWithTurns(2, ticket);
    const result = await tryLisGate({
      request: {
        message: '那天气怎么样',
        skill_key: '',
        conversation_id: 'conv_lis_gate',
        context: {},
      },
      session,
      catalogEntries: CATALOG,
      lisClient,
      snapshot: { scene: 'travel_route' },
    });

    assert.equal(calls.boundary, 1);
    assert.equal(calls.sort, 0);
    assert.equal(result.handled, true);
    assert.equal(result.mode, 'BOUNDARY');
    assert.equal(result.skill_key, 'travel_route');
    assert.equal(result.template_id, 'travel_weather_risk_card');
    assert.ok(session.global_context.routing_ticket);
  });

  it('c) no ticket → sort called', async () => {
    const calls = { sort: 0, boundary: 0 };
    const lisClient = {
      async sort(body) {
        calls.sort += 1;
        assert.equal(body.utterance, '附近有什么好吃的');
        return {
          decision: { status: 'MATCH_OK', max_confidence: 0.88 },
          intents: [
            { intent_id: 'nearby_resource.food', confidence: 0.88, role: 'primary' },
          ],
          routing_ticket: {
            ticket_id: 'tkt_food',
            lis_version: '1.0',
            domain: 'nearby_resource',
            primary_intent_id: 'nearby_resource.food',
            issued_at: new Date().toISOString(),
            ttl_seconds: 1800,
          },
        };
      },
      async boundary() {
        calls.boundary += 1;
        return {};
      },
    };
    const session = sessionWithTurns(0, null);
    const result = await tryLisGate({
      request: {
        message: '附近有什么好吃的',
        conversation_id: 'conv_lis_gate',
        context: {},
      },
      session,
      catalogEntries: CATALOG,
      lisClient,
    });

    assert.equal(calls.sort, 1);
    assert.equal(calls.boundary, 0);
    assert.equal(result.handled, true);
    assert.equal(result.mode, 'SORT');
    assert.equal(result.skill_key, 'nearby_resource');
    assert.equal(result.template_id, 'nearby_food_card');
    assert.equal(session.global_context.routing_ticket?.domain, 'nearby_resource');
  });

  it('flag off → handled false and no LIS calls', async () => {
    process.env.LIS_GATE_ENABLED = '0';
    const calls = { sort: 0, boundary: 0 };
    const lisClient = {
      async sort() { calls.sort += 1; return {}; },
      async boundary() { calls.boundary += 1; return {}; },
    };
    const result = await tryLisGate({
      request: { message: '你好', context: {} },
      session: sessionWithTurns(0, null),
      catalogEntries: CATALOG,
      lisClient,
    });
    assert.equal(result.handled, false);
    assert.equal(calls.sort, 0);
    assert.equal(calls.boundary, 0);
  });

  it('ESCAPE clears ticket then calls sort', async () => {
    const calls = { sort: 0, boundary: 0 };
    const lisClient = {
      async boundary() {
        calls.boundary += 1;
        return { status: 'ESCAPE', routing_ticket: null, intents: [] };
      },
      async sort() {
        calls.sort += 1;
        return {
          decision: { status: 'MATCH_OK', max_confidence: 0.9 },
          intents: [
            { intent_id: 'nearby_resource.food', confidence: 0.9, role: 'primary' },
          ],
          routing_ticket: {
            ticket_id: 'tkt_after_escape',
            lis_version: '1.0',
            domain: 'nearby_resource',
            primary_intent_id: 'nearby_resource.food',
            issued_at: new Date().toISOString(),
            ttl_seconds: 1800,
          },
        };
      },
    };
    const session = sessionWithTurns(2, freshTicket());
    const result = await tryLisGate({
      request: { message: '附近有什么好吃的餐厅', context: {} },
      session,
      catalogEntries: CATALOG,
      lisClient,
    });
    assert.equal(calls.boundary, 1);
    assert.equal(calls.sort, 1);
    assert.equal(result.handled, true);
    assert.equal(result.skill_key, 'nearby_resource');
    assert.equal(session.global_context.routing_ticket?.domain, 'nearby_resource');
  });

  it('reenter clears ticket and falls through to sort', async () => {
    const calls = { sort: 0, boundary: 0 };
    const lisClient = {
      async sort() {
        calls.sort += 1;
        return { decision: { status: 'NEED_CLARIFY', max_confidence: 0.2 }, intents: [] };
      },
      async boundary() {
        calls.boundary += 1;
        return {};
      },
    };
    const session = sessionWithTurns(2, freshTicket());
    const result = await tryLisGate({
      request: {
        message: '重新开始',
        skill_key: 'travel_route',
        context: { reenter_chat: true, action_key: 'x' },
      },
      session,
      catalogEntries: CATALOG,
      lisClient,
    });
    assert.equal(session.global_context.routing_ticket, null);
    assert.equal(calls.sort, 1);
    assert.equal(calls.boundary, 0);
    assert.equal(result.handled, false);
    assert.equal(result.mode, 'SORT');
  });
});
