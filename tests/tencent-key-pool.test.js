import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listWsKeyPairs,
  getOrderedWsKeyPairs,
  getActiveWsPair,
  markWsKeyExhausted,
  isWsQuotaStatus,
  withWsKeyFailover,
  _resetWsKeyPoolForTests,
} from '../src/services/map/tencent-key-pool.js';

test('listWsKeyPairs reads primary and secondary', () => {
  _resetWsKeyPoolForTests();
  const prev = {
    k1: process.env.TENCENT_MAP_KEY,
    s1: process.env.TENCENT_MAP_SK,
    k2: process.env.TENCENT_MAP_KEY_2,
    s2: process.env.TENCENT_MAP_SK_2,
  };
  process.env.TENCENT_MAP_KEY = 'KEY-PRIMARY';
  process.env.TENCENT_MAP_SK = 'SK1';
  process.env.TENCENT_MAP_KEY_2 = 'KEY-SECONDARY';
  process.env.TENCENT_MAP_SK_2 = 'SK2';
  try {
    const pairs = listWsKeyPairs();
    assert.equal(pairs.length, 2);
    assert.equal(pairs[0].id, 'primary');
    assert.equal(pairs[1].id, 'secondary');
    assert.equal(getActiveWsPair()?.id, 'primary');
  } finally {
    restore(prev);
    _resetWsKeyPoolForTests();
  }
});

test('quota exhaustion rotates to secondary', async () => {
  _resetWsKeyPoolForTests();
  const prev = {
    k1: process.env.TENCENT_MAP_KEY,
    s1: process.env.TENCENT_MAP_SK,
    k2: process.env.TENCENT_MAP_KEY_2,
    s2: process.env.TENCENT_MAP_SK_2,
  };
  process.env.TENCENT_MAP_KEY = 'KEY-PRIMARY';
  process.env.TENCENT_MAP_SK = 'SK1';
  process.env.TENCENT_MAP_KEY_2 = 'KEY-SECONDARY';
  process.env.TENCENT_MAP_SK_2 = 'SK2';
  try {
    assert.equal(isWsQuotaStatus(121), true);
    const seen = [];
    const result = await withWsKeyFailover(async (pair) => {
      seen.push(pair.id);
      if (pair.id === 'primary') {
        return { ok: false, status: 121, quota: true, reason: 'daily_limit' };
      }
      return { ok: true, status: 0, data: 'from-secondary', keyId: pair.id };
    });
    assert.deepEqual(seen, ['primary', 'secondary']);
    assert.equal(result.ok, true);
    assert.equal(result.keyId, 'secondary');
    // 后续首选应跳过已耗尽的 primary
    assert.equal(getOrderedWsKeyPairs()[0].id, 'secondary');
  } finally {
    restore(prev);
    _resetWsKeyPoolForTests();
  }
});

test('markWsKeyExhausted skips primary in ordering', () => {
  _resetWsKeyPoolForTests();
  const prev = {
    k1: process.env.TENCENT_MAP_KEY,
    s1: process.env.TENCENT_MAP_SK,
    k2: process.env.TENCENT_MAP_KEY_2,
    s2: process.env.TENCENT_MAP_SK_2,
  };
  process.env.TENCENT_MAP_KEY = 'KEY-PRIMARY';
  process.env.TENCENT_MAP_SK = 'SK1';
  process.env.TENCENT_MAP_KEY_2 = 'KEY-SECONDARY';
  process.env.TENCENT_MAP_SK_2 = 'SK2';
  try {
    markWsKeyExhausted('primary', { ttlMs: 60_000 });
    assert.equal(getOrderedWsKeyPairs()[0].id, 'secondary');
  } finally {
    restore(prev);
    _resetWsKeyPoolForTests();
  }
});

function restore(prev) {
  setEnv('TENCENT_MAP_KEY', prev.k1);
  setEnv('TENCENT_MAP_SK', prev.s1);
  setEnv('TENCENT_MAP_KEY_2', prev.k2);
  setEnv('TENCENT_MAP_SK_2', prev.s2);
}

function setEnv(k, v) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
