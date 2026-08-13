import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSafetyGate } from '../src/core/pipeline/safety-gate.js';

describe('safety-gate', () => {
  it('blocks porn/violence keywords', () => {
    const r = runSafetyGate('这里有色情暴力内容示范拦截');
    assert.equal(r.action, 'block');
    assert.ok(['porn', 'violence'].includes(r.category) || r.category === 'porn' || r.category === 'violence');
  });
  it('care on self-harm signals', () => {
    const r = runSafetyGate('我不想活了真的很抑郁');
    assert.equal(r.action, 'care');
    assert.equal(r.category, 'self_harm_negativity');
  });
  it('pass clean', () => {
    const r = runSafetyGate('推荐桂林旅居线路');
    assert.equal(r.action, 'pass');
    assert.equal(r.category, 'clean');
  });
});
