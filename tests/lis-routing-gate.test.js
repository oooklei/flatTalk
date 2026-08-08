import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideRoute } from '../src/core/lis/routing-gate.js';

describe('decideRoute', () => {
  it('SKILL_LOCK when ticket valid and action_key set', () => {
    const r = decideRoute({
      ticket: { issued_at: new Date().toISOString(), ttl_seconds: 1800, domain: 'travel_route' },
      context: { action_key: 'travel_route.check_weather_risk' },
      skill_key: 'travel_route',
      utterance: '查看天气',
      dialogueTurnCount: 5,
    });
    assert.equal(r.mode, 'SKILL_LOCK');
  });

  it('BOUNDARY when ticket valid, free text, turns>=3', () => {
    const r = decideRoute({
      ticket: { issued_at: new Date().toISOString(), ttl_seconds: 1800, domain: 'travel_route' },
      context: {},
      skill_key: '',
      utterance: '那天气怎么样',
      dialogueTurnCount: 3,
    });
    assert.equal(r.mode, 'BOUNDARY');
  });

  it('SORT when no ticket', () => {
    const r = decideRoute({ ticket: null, context: {}, utterance: '你好', dialogueTurnCount: 0 });
    assert.equal(r.mode, 'SORT');
  });

  it('SORT when free text but turns<3', () => {
    const r = decideRoute({
      ticket: { issued_at: new Date().toISOString(), ttl_seconds: 1800, domain: 'travel_route' },
      context: {},
      utterance: '继续',
      dialogueTurnCount: 2,
    });
    assert.equal(r.mode, 'SORT');
  });
});
