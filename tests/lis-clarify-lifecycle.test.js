import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createLisBreaker } from '../src/core/lis/lis-breaker.js';
import { tryLisGate } from '../src/core/lis/lis-gate-hook.js';

const quiet = { warn: () => {}, info: () => {} };

const CATALOG = [
  {
    intent_id: 'nearby_resource.food',
    domain: 'nearby_resource',
    entry: { kind: 'template', skill_key: 'nearby_resource', template_id: 'nearby_food_card' },
    enabled: true,
  },
  {
    intent_id: 'travel_route_plan',
    domain: 'travel_route',
    entry: { kind: 'template', skill_key: 'travel_route', template_id: 'route_svg' },
    enabled: true,
  },
];

function session(globalContext = {}) {
  return { conversation_id: 'c1', global_context: { ...globalContext }, turns: [] };
}

function clarifySupply(options = [{ intent_id: 'nearby_resource.food', label: '美食' }]) {
  return {
    decision: { status: 'NEED_CLARIFY', max_confidence: 0.3, threshold: 0.5 },
    intents: [],
    clarify: { question: '您想办哪件事？', options },
  };
}

beforeEach(() => {
  process.env.LIS_GATE_ENABLED = '1';
});

// ── 缺陷1：熔断跳过时必须清 pending_clarify_supply ──────────

describe('breaker + pending clarify interaction', () => {
  it('clears pending_clarify_supply when the breaker skips the call', async () => {
    // 回归防护：不清的话会话被永久钉在澄清态，恢复后用户的新话题
    // 会被当成"上一轮澄清的答复"发去 resolve。
    const breaker = createLisBreaker({ threshold: 1, logger: quiet });
    breaker.recordFailure('clarify', new Error('down'));

    const sess = session({ pending_clarify_supply: clarifySupply() });
    let clarifyCalled = false;

    await tryLisGate({
      request: { message: '完全无关的新话题', conversation_id: 'c1' },
      session: sess,
      catalogEntries: CATALOG,
      lisClient: {
        sort: async () => ({}),
        boundary: async () => ({}),
        clarify: async () => {
          clarifyCalled = true;
          return {};
        },
      },
      breaker,
    });

    assert.equal(clarifyCalled, false, '熔断中不应调用 clarify');
    assert.equal(sess.global_context.pending_clarify_supply, null, '必须清掉 pending');
  });

  it('clears pending_clarify_supply when clarify call throws', async () => {
    const breaker = createLisBreaker({ threshold: 5, logger: quiet });
    const sess = session({ pending_clarify_supply: clarifySupply() });

    await tryLisGate({
      request: { message: 'hi', conversation_id: 'c1' },
      session: sess,
      catalogEntries: CATALOG,
      lisClient: {
        sort: async () => ({}),
        boundary: async () => ({}),
        clarify: async () => { throw new Error('boom'); },
      },
      breaker,
    });

    assert.equal(sess.global_context.pending_clarify_supply, null);
  });

  it('does not leave stale pending after clarify resolves to LLM_FALLBACK_HINT', async () => {
    const breaker = createLisBreaker({ threshold: 5, logger: quiet });
    const sess = session({ pending_clarify_supply: clarifySupply() });

    const res = await tryLisGate({
      request: { message: '随便说点什么', conversation_id: 'c1' },
      session: sess,
      catalogEntries: CATALOG,
      lisClient: {
        sort: async () => ({}),
        boundary: async () => ({}),
        clarify: async () => ({
          decision: { status: 'LLM_FALLBACK_HINT', max_confidence: 0.1, threshold: 0.5 },
          intents: [],
        }),
      },
      breaker,
    });

    assert.equal(res.handled, false);
    assert.equal(sess.global_context.pending_clarify_supply, null);
  });
});

// ── 缺陷2 消费侧：空选项的澄清是死胡同 ─────────────────────

describe('NEED_CLARIFY with no options', () => {
  it('does not enter clarify mode when options are empty', async () => {
    // LIS 的兜底选项与白名单求交后可能为空；
    // 只有问句没有按钮 → 用户无法推进，应直接降级。
    const sess = session();
    const res = await tryLisGate({
      request: { message: '阿斯达乱码', conversation_id: 'c1' },
      session: sess,
      catalogEntries: CATALOG,
      lisClient: {
        sort: async () => ({
          decision: { status: 'NEED_CLARIFY', max_confidence: 0.2, threshold: 0.5 },
          intents: [],
          clarify: { question: '您想办哪件事？', options: [] },
        }),
        boundary: async () => ({}),
      },
      breaker: createLisBreaker({ logger: quiet }),
    });

    assert.equal(res.need_clarify, undefined, '空选项不应进入澄清态');
    assert.equal(res.handled, false, '应降级给 scene-router');
    assert.equal(sess.global_context.pending_clarify_supply, null);
  });

  it('still enters clarify mode when options exist', async () => {
    const sess = session();
    const res = await tryLisGate({
      request: { message: '帮我看看那个事', conversation_id: 'c1' },
      session: sess,
      catalogEntries: CATALOG,
      lisClient: {
        sort: async () => clarifySupply([
          { intent_id: 'nearby_resource.food', label: '美食' },
          { intent_id: 'travel_route_plan', label: '线路' },
        ]),
        boundary: async () => ({}),
      },
      breaker: createLisBreaker({ logger: quiet }),
    });

    assert.equal(res.need_clarify, true);
    assert.equal(res.ambiguity_options.length, 2);
    assert.ok(sess.global_context.pending_clarify_supply);
  });

  it('does not enter clarify mode when clarify payload is missing', async () => {
    const sess = session();
    const res = await tryLisGate({
      request: { message: 'x', conversation_id: 'c1' },
      session: sess,
      catalogEntries: CATALOG,
      lisClient: {
        sort: async () => ({
          decision: { status: 'NEED_CLARIFY', max_confidence: 0.2, threshold: 0.5 },
          intents: [],
        }),
        boundary: async () => ({}),
      },
      breaker: createLisBreaker({ logger: quiet }),
    });
    assert.equal(res.handled, false);
    assert.equal(sess.global_context.pending_clarify_supply, null);
  });
});

// ── SORT MATCH_OK 必须真正比较 threshold ──────────────

describe('SORT MATCH_OK respects threshold', () => {
  function sortClient(intents, threshold) {
    const max = Math.max(0, ...intents.map((i) => Number(i.confidence) || 0));
    return {
      sort: async () => ({
        decision: { status: 'MATCH_OK', max_confidence: max, threshold },
        intents,
      }),
    };
  }

  const dialogueRequest = {
    message: '那天气怎么样',
    conversation_id: 'c1',
  };

  function sessionWithTurns() {
    return {
      conversation_id: 'c1',
      global_context: {},
      turns: [
        { user_text: '防城港三日游', assistant_text: '已规划路线' },
        { user_text: '有什么好玩的', assistant_text: '推荐景点' },
      ],
    };
  }

  it('executes when confidence meets the sort threshold', async () => {
    const res = await tryLisGate({
      request: dialogueRequest,
      session: sessionWithTurns(),
      catalogEntries: CATALOG,
      lisClient: sortClient([{ intent_id: 'travel_route_plan', confidence: 0.8, role: 'primary' }], 0.5),
      breaker: createLisBreaker({ logger: quiet }),
    });
    assert.equal(res.mode, 'SORT');
    assert.equal(res.handled, true);
  });

  it('does NOT execute when confidence is below a raised threshold', async () => {
    const res = await tryLisGate({
      request: dialogueRequest,
      session: sessionWithTurns(),
      catalogEntries: CATALOG,
      lisClient: sortClient([{ intent_id: 'travel_route_plan', confidence: 0.6, role: 'primary' }], 0.9),
      breaker: createLisBreaker({ logger: quiet }),
    });
    assert.equal(res.handled, false, 'LIS 抬高 sort 门槛后应跟随');
  });

  it('falls back to matcher default when sort omits threshold', async () => {
    const res = await tryLisGate({
      request: dialogueRequest,
      session: sessionWithTurns(),
      catalogEntries: CATALOG,
      lisClient: sortClient([{ intent_id: 'travel_route_plan', confidence: 0.7, role: 'primary' }], undefined),
      breaker: createLisBreaker({ logger: quiet }),
    });
    assert.equal(res.handled, true);
  });
});
