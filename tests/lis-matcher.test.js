import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchSupplyToCatalog, resolveThreshold } from '../src/core/lis/matcher.js';
import { createLisClient } from '../src/core/lis/lis-client.js';

const CATALOG = [
  {
    intent_id: 'nearby_resource.food',
    enabled: true,
    entry: { skill_key: 'nearby_resource', template_id: 'nearby_food_card' },
  },
];

describe('resolveThreshold', () => {
  it('uses the threshold sent by LIS', () => {
    assert.equal(resolveThreshold({ threshold: 0.7 }), 0.7);
  });

  it('falls back to 0.5 when absent', () => {
    assert.equal(resolveThreshold({}), 0.5);
    assert.equal(resolveThreshold(), 0.5);
  });

  it('rejects invalid values', () => {
    for (const bad of [0, -1, 1.5, NaN, 'abc', null]) {
      assert.equal(resolveThreshold({ threshold: bad }), 0.5, `bad=${bad}`);
    }
  });

  it('accepts boundary value 1', () => {
    assert.equal(resolveThreshold({ threshold: 1 }), 1);
  });
});

describe('matchSupplyToCatalog threshold handling', () => {
  it('honours a raised threshold from LIS', () => {
    // LIS 提高阈值到 0.9 → 0.8 的候选不应再执行
    const hit = matchSupplyToCatalog(
      {
        intents: [{ intent_id: 'nearby_resource.food', confidence: 0.8 }],
        decision: { status: 'LLM_FALLBACK_HINT', max_confidence: 0.8, threshold: 0.9 },
      },
      CATALOG,
    );
    assert.equal(hit.ok, false, 'LIS 抬高阈值后 flatTalk 应跟随');
  });

  it('honours a lowered threshold from LIS', () => {
    const hit = matchSupplyToCatalog(
      {
        intents: [{ intent_id: 'nearby_resource.food', confidence: 0.35 }],
        decision: { status: 'NEED_CLARIFY', max_confidence: 0.35, threshold: 0.3 },
      },
      CATALOG,
    );
    assert.equal(hit.ok, true, 'LIS 降低阈值后 flatTalk 应跟随');
  });

  it('reports the effective threshold', () => {
    const hit = matchSupplyToCatalog(
      {
        intents: [{ intent_id: 'nearby_resource.food', confidence: 0.8 }],
        decision: { status: 'MATCH_OK', max_confidence: 0.8, threshold: 0.6 },
      },
      CATALOG,
    );
    assert.equal(hit.threshold, 0.6);
  });

  it('MATCH_OK still bypasses the threshold', () => {
    // 契约：LIS 说 MATCH_OK 就是可执行，不再用置信度二次否决
    const hit = matchSupplyToCatalog(
      {
        intents: [{ intent_id: 'nearby_resource.food', confidence: 0.2 }],
        decision: { status: 'MATCH_OK', max_confidence: 0.2, threshold: 0.9 },
      },
      CATALOG,
    );
    assert.equal(hit.ok, true);
  });

  it('defaults to 0.5 when LIS omits threshold (back-compat)', () => {
    const below = matchSupplyToCatalog(
      {
        intents: [{ intent_id: 'nearby_resource.food', confidence: 0.4 }],
        decision: { status: 'NEED_CLARIFY', max_confidence: 0.4 },
      },
      CATALOG,
    );
    const above = matchSupplyToCatalog(
      {
        intents: [{ intent_id: 'nearby_resource.food', confidence: 0.6 }],
        decision: { status: 'NEED_CLARIFY', max_confidence: 0.6 },
      },
      CATALOG,
    );
    assert.equal(below.ok, false);
    assert.equal(above.ok, true);
  });
});

describe('matchSupplyToCatalog', () => {
  it('intersects supply intents with enabled catalog', () => {
    const hit = matchSupplyToCatalog(
      {
        intents: [{ intent_id: 'nearby_resource.food', confidence: 0.8, role: 'primary' }],
        decision: { status: 'MATCH_OK', max_confidence: 0.8 },
      },
      [
        {
          intent_id: 'nearby_resource.food',
          enabled: true,
          entry: { skill_key: 'nearby_resource', template_id: 'nearby_food_card' },
        },
      ],
    );
    assert.equal(hit.ok, true);
    assert.equal(hit.entry.template_id, 'nearby_food_card');
  });

  it('returns ok false when catalog intent disabled', () => {
    const hit = matchSupplyToCatalog(
      {
        intents: [{ intent_id: 'nearby_resource.food', confidence: 0.9, role: 'primary' }],
        decision: { status: 'MATCH_OK', max_confidence: 0.9 },
      },
      [
        {
          intent_id: 'nearby_resource.food',
          enabled: false,
          entry: { skill_key: 'nearby_resource', template_id: 'nearby_food_card' },
        },
      ],
    );
    assert.equal(hit.ok, false);
    assert.equal(hit.entry, null);
    assert.equal(hit.intent, null);
  });

  it('picks highest confidence among intersecting intents', () => {
    const hit = matchSupplyToCatalog(
      {
        intents: [
          { intent_id: 'nearby_resource.all', confidence: 0.6, role: 'secondary' },
          { intent_id: 'nearby_resource.food', confidence: 0.85, role: 'primary' },
        ],
        decision: { status: 'NEED_CLARIFY', max_confidence: 0.85 },
      },
      [
        {
          intent_id: 'nearby_resource.all',
          enabled: true,
          entry: { skill_key: 'nearby_resource', template_id: 'nearby_map_overview' },
        },
        {
          intent_id: 'nearby_resource.food',
          enabled: true,
          entry: { skill_key: 'nearby_resource', template_id: 'nearby_food_card' },
        },
      ],
    );
    assert.equal(hit.ok, true);
    assert.equal(hit.intent.intent_id, 'nearby_resource.food');
    assert.equal(hit.entry.template_id, 'nearby_food_card');
  });
});

describe('createLisClient', () => {
  it('POSTs JSON to /v1/sort and /v1/boundary', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ ok: true, path: url }),
      };
    };
    const client = createLisClient({
      baseUrl: 'http://lis.test:8100/',
      fetchImpl,
    });

    await client.sort({ utterance: 'hi' });
    await client.boundary({ utterance: 'bye' });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'http://lis.test:8100/v1/sort');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['content-type'], 'application/json');
    assert.equal(calls[0].init.body, JSON.stringify({ utterance: 'hi' }));
    assert.equal(calls[1].url, 'http://lis.test:8100/v1/boundary');
    assert.equal(calls[1].init.method, 'POST');
    assert.equal(calls[1].init.body, JSON.stringify({ utterance: 'bye' }));
  });

  it('throws when response is not ok', async () => {
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    await assert.rejects(() => client.sort({}), /LIS sort 503/);
  });

  it('includes response body in error for troubleshooting', async () => {
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        text: async () => '{"detail":"bad field"}',
        json: async () => ({}),
      }),
    });
    await assert.rejects(() => client.sort({}), /LIS sort 422 .*bad field/);
  });

  it('times out instead of hanging forever', async () => {
    // 遵守 signal 的 fetch —— 真实 fetch 行为
    const signalAware = (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: signalAware,
      timeoutMs: 50,
    });
    // 没有超时的话这里会永久挂起，测试直接超时失败
    await assert.rejects(() => client.sort({}), /LIS sort timeout after 50ms/);
  });

  it('passes an abort signal to fetch', async () => {
    let sawSignal = false;
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async (_url, init) => {
        sawSignal = Boolean(init.signal);
        return { ok: true, json: async () => ({}) };
      },
    });
    await client.boundary({});
    assert.equal(sawSignal, true);
  });
});

describe('createLisClient.probe', () => {
  it('reports reachable with LIS config on success', async () => {
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ ok: true, version: '1.0.0', scorer: 'simcse', encoder: 'onnx' }),
      }),
    });
    const r = await client.probe();
    assert.equal(r.reachable, true);
    assert.equal(r.scorer, 'simcse');
    assert.equal(r.encoder, 'onnx');
    assert.equal(r.lis_version, '1.0.0');
    assert.equal(typeof r.latency_ms, 'number');
  });

  it('uses GET, not POST', async () => {
    let method = null;
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async (_url, init) => {
        method = init.method;
        return { ok: true, json: async () => ({}) };
      },
    });
    await client.probe();
    assert.equal(method, 'GET');
  });

  it('hits /health', async () => {
    let url = null;
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async (u) => {
        url = u;
        return { ok: true, json: async () => ({}) };
      },
    });
    await client.probe();
    assert.equal(url, 'http://lis.test/health');
  });

  it('reports unreachable on connection failure', async () => {
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const r = await client.probe();
    assert.equal(r.reachable, false);
    assert.match(r.error, /ECONNREFUSED/);
  });

  it('reports unreachable on non-2xx', async () => {
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async () => ({ ok: false, status: 503 }),
    });
    const r = await client.probe();
    assert.equal(r.reachable, false);
    assert.match(r.error, /503/);
  });

  it('reports timeout rather than hanging', async () => {
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      timeoutMs: 40,
      fetchImpl: (_u, o) =>
        new Promise((_r, rej) => {
          o.signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            rej(e);
          });
        }),
    });
    const r = await client.probe();
    assert.equal(r.reachable, false);
    assert.match(r.error, /timeout after 40ms/);
  });

  it('never throws (callers rely on this for health endpoints)', async () => {
    const client = createLisClient({
      baseUrl: 'http://lis.test',
      fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }),
    });
    const r = await client.probe();
    assert.equal(r.reachable, false);
  });
});
