import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLisBreaker } from '../src/core/lis/lis-breaker.js';
import { tryLisGate } from '../src/core/lis/lis-gate-hook.js';

/** 静默 logger，避免测试输出噪声 */
const quiet = { warn: () => {}, info: () => {} };

/** 可控时钟 */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('createLisBreaker', () => {
  it('starts closed', () => {
    const b = createLisBreaker({ logger: quiet });
    assert.equal(b.shouldSkip(), false);
    assert.equal(b.state().open, false);
  });

  it('stays closed below threshold', () => {
    const b = createLisBreaker({ threshold: 3, logger: quiet });
    b.recordFailure('sort', new Error('x'));
    b.recordFailure('sort', new Error('x'));
    assert.equal(b.shouldSkip(), false);
  });

  it('opens at threshold', () => {
    const b = createLisBreaker({ threshold: 3, logger: quiet });
    for (let i = 0; i < 3; i += 1) b.recordFailure('sort', new Error('x'));
    assert.equal(b.shouldSkip(), true);
    assert.equal(b.state().open, true);
  });

  it('success resets failure count', () => {
    const b = createLisBreaker({ threshold: 3, logger: quiet });
    b.recordFailure('sort', new Error('x'));
    b.recordFailure('sort', new Error('x'));
    b.recordSuccess();
    b.recordFailure('sort', new Error('x'));
    assert.equal(b.shouldSkip(), false);
  });

  it('allows a probe after cooldown', () => {
    const clock = fakeClock();
    const b = createLisBreaker({ threshold: 1, cooldownMs: 30_000, now: clock.now, logger: quiet });
    b.recordFailure('sort', new Error('x'));
    assert.equal(b.shouldSkip(), true);

    clock.advance(30_001);
    assert.equal(b.shouldSkip(), false, '冷却结束应放试探请求');
  });

  it('probe failure reopens the breaker', () => {
    const clock = fakeClock();
    const b = createLisBreaker({ threshold: 1, cooldownMs: 10_000, now: clock.now, logger: quiet });
    b.recordFailure('sort', new Error('x'));
    clock.advance(10_001);
    b.shouldSkip(); // 进入 half-open
    b.recordFailure('sort', new Error('still down'));
    assert.equal(b.shouldSkip(), true, '试探失败应重新熔断');
  });

  it('probe success closes the breaker', () => {
    const clock = fakeClock();
    const b = createLisBreaker({ threshold: 1, cooldownMs: 10_000, now: clock.now, logger: quiet });
    b.recordFailure('sort', new Error('x'));
    clock.advance(10_001);
    b.shouldSkip();
    b.recordSuccess();
    assert.equal(b.shouldSkip(), false);
    assert.equal(b.state().open, false);
  });

  it('counts suppressed calls', () => {
    const b = createLisBreaker({ threshold: 1, logger: quiet });
    b.recordFailure('sort', new Error('x'));
    b.shouldSkip();
    b.shouldSkip();
    assert.equal(b.state().suppressed_calls, 2);
  });

  it('logs on failure', () => {
    const logs = [];
    const b = createLisBreaker({
      threshold: 5,
      logger: { warn: (...a) => logs.push(a), info: () => {} },
    });
    b.recordFailure('sort', new Error('boom'));
    assert.equal(logs.length, 1);
    assert.match(logs[0][0], /LIS-GATE/);
    assert.equal(logs[0][1].op, 'sort');
    assert.match(logs[0][1].error, /boom/);
  });

  it('logs when opening', () => {
    const logs = [];
    const b = createLisBreaker({
      threshold: 1,
      logger: { warn: (...a) => logs.push(a[0]), info: () => {} },
    });
    b.recordFailure('sort', new Error('x'));
    assert.ok(logs.some((m) => /breaker opened/.test(m)));
  });

  it('logs on recovery', () => {
    const logs = [];
    const b = createLisBreaker({
      threshold: 1,
      logger: { warn: () => {}, info: (...a) => logs.push(a[0]) },
    });
    b.recordFailure('sort', new Error('x'));
    b.recordSuccess();
    assert.ok(logs.some((m) => /recovered/.test(m)));
  });

  it('reset clears state', () => {
    const b = createLisBreaker({ threshold: 1, logger: quiet });
    b.recordFailure('sort', new Error('x'));
    b.reset();
    assert.equal(b.shouldSkip(), false);
  });

  it('handles non-Error rejections', () => {
    const b = createLisBreaker({ threshold: 5, logger: quiet });
    b.recordFailure('sort', 'plain string');
    assert.equal(b.state().consecutive_failures, 1);
  });
});

describe('tryLisGate with breaker', () => {
  beforeEach(() => {
    process.env.LIS_GATE_ENABLED = '1';
  });

  // 目录结构须与 catalog.sample.json 一致：skill_key/template_id 嵌在 entry 里
  const catalog = [
    {
      intent_id: 'nearby_resource.food',
      domain: 'nearby_resource',
      entry: {
        kind: 'template',
        skill_key: 'nearby_resource',
        template_id: 'nearby_food_card',
      },
      enabled: true,
    },
  ];

  function session() {
    return { conversation_id: 'c1', global_context: {}, turns: [] };
  }

  it('stops calling LIS once the breaker opens', async () => {
    let calls = 0;
    const client = {
      sort: async () => {
        calls += 1;
        throw new Error('ECONNREFUSED');
      },
      boundary: async () => ({}),
    };
    const breaker = createLisBreaker({ threshold: 2, logger: quiet });

    // 前两次会真正调用并失败，之后熔断
    for (let i = 0; i < 5; i += 1) {
      await tryLisGate({
        request: { message: '附近有什么好吃的', conversation_id: 'c1' },
        session: session(),
        catalogEntries: catalog,
        lisClient: client,
        breaker,
      });
    }

    assert.equal(calls, 2, '熔断后不应再调用 LIS');
  });

  it('returns lis_unavailable reason when breaker is open', async () => {
    const breaker = createLisBreaker({ threshold: 1, logger: quiet });
    breaker.recordFailure('sort', new Error('down'));

    const res = await tryLisGate({
      request: { message: '附近有什么好吃的', conversation_id: 'c1' },
      session: session(),
      catalogEntries: catalog,
      lisClient: { sort: async () => ({}), boundary: async () => ({}) },
      breaker,
    });

    assert.equal(res.handled, false);
    assert.equal(res.reason, 'lis_unavailable');
  });

  it('degrades gracefully (never throws) when LIS is down', async () => {
    const breaker = createLisBreaker({ threshold: 10, logger: quiet });
    const res = await tryLisGate({
      request: { message: '附近有什么好吃的', conversation_id: 'c1' },
      session: session(),
      catalogEntries: catalog,
      lisClient: {
        sort: async () => { throw new Error('timeout'); },
      },
      breaker,
    });
    assert.equal(res.handled, false);
    assert.equal(res.mode, 'SORT');
    assert.equal(res.reason, 'lis_unreachable');
  });

  it('recovers and serves traffic after LIS comes back', async () => {
    const clock = fakeClock();
    const breaker = createLisBreaker({
      threshold: 1, cooldownMs: 5_000, now: clock.now, logger: quiet,
    });
    let healthy = false;
    const client = {
      sort: async () => {
        if (!healthy) throw new Error('down');
        return {
          decision: { status: 'MATCH_OK', max_confidence: 0.9 },
          intents: [{ intent_id: 'nearby_resource.food', confidence: 0.9, role: 'primary' }],
          routing_ticket: { domain: 'nearby_resource', issued_at: new Date().toISOString(), ttl_seconds: 600 },
        };
      },
      boundary: async () => ({}),
    };

    const args = () => ({
      request: { message: '附近有什么好吃的', conversation_id: 'c1' },
      session: session(),
      catalogEntries: catalog,
      lisClient: client,
      breaker,
    });

    await tryLisGate(args());              // 失败 → 熔断
    assert.equal(breaker.state().open, true);

    healthy = true;
    clock.advance(5_001);                  // 冷却结束
    const res = await tryLisGate(args());  // 试探成功
    assert.equal(res.handled, true);
    assert.equal(res.skill_key, 'nearby_resource');
    assert.equal(breaker.state().open, false);
  });
});
