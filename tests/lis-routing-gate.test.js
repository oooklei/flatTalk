import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideRoute, isTicketValid } from '../src/core/lis/routing-gate.js';

describe('decideRoute (pure SORT)', () => {
  it('always returns SORT for free text', () => {
    const r = decideRoute({
      ticket: { issued_at: new Date().toISOString(), ttl_seconds: 1800 },
      context: { action_key: 'x' },
      skill_key: 'travel_route',
      utterance: '查天气',
      dialogueTurnCount: 4,
    });
    assert.equal(r.mode, 'SORT');
  });

  it('reenter_chat still SORT', () => {
    const r = decideRoute({ reenter_chat: true });
    assert.equal(r.mode, 'SORT');
    assert.equal(r.reason, 'reenter_chat');
  });

  it('isTicketValid still works for legacy tickets', () => {
    assert.equal(isTicketValid({
      issued_at: new Date().toISOString(),
      ttl_seconds: 1800,
    }), true);
  });
});
