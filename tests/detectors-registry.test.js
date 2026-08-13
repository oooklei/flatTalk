import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../src/core/pipeline/detectors/registry.js';
import { registerDefaultDetectors } from '../src/core/pipeline/detectors/index.js';

describe('detectors', () => {
  it('meal_plan requires elder', async () => {
    const reg = createRegistry();
    registerDefaultDetectors(reg);
    const miss = await reg.run('meal_plan', {
      utterance: '今天吃什么',
      login: { elder_binding: {} },
      turn: {},
    });
    assert.equal(miss.ok, false);
    assert.equal(miss.clarify, 'which_elder');
  });
  it('nearby need_location', async () => {
    const reg = createRegistry();
    registerDefaultDetectors(reg);
    const r = await reg.run('nearby_resource', {
      utterance: '附近目的地',
      login: { location: null },
      turn: { need_location: true },
    });
    assert.equal(r.ok, false);
    assert.equal(r.need_location, true);
    assert.equal(r.skipped, false);
  });
  it('travel_route extracts city/route hints', async () => {
    const reg = createRegistry();
    registerDefaultDetectors(reg);
    const r = await reg.run('travel_route', {
      utterance: '北海涠洲旅居线路',
      login: {},
      turn: { primary_city: '北海', cities: ['北海'] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.resources.primary_city, '北海');
  });
});
