import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchSupplyToCatalog } from '../src/core/lis/matcher.js';
import { createLisClient } from '../src/core/lis/lis-client.js';

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
});
