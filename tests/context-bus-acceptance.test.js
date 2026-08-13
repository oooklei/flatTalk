import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bindFromSso } from '../src/core/context-bus/login-binder.js';
import { injectProfile, emptyTurn } from '../src/core/context-bus/schema.js';
import { runSafetyGate } from '../src/core/pipeline/safety-gate.js';
import { assertWithinLimit } from '../src/core/pipeline/input-normalizer.js';
import { createRegistry } from '../src/core/pipeline/detectors/registry.js';
import { registerDefaultDetectors } from '../src/core/pipeline/detectors/index.js';

describe('context-bus acceptance', () => {
  it('elder bindFromSso → injectProfile meal has_elder true', () => {
    const login = bindFromSso(
      { userId: 'E1', roleId: 'LAO_REN' },
      { roleKey: 'elder' },
    );
    const p = injectProfile(login, emptyTurn(), 'meal_plan');
    assert.equal(p.has_elder, true);
    assert.equal(p.elder_id, 'E1');
    assert.equal(p.role_key, 'elder');
  });

  it('assertWithinLimit 501 fails', () => {
    const r = assertWithinLimit('x'.repeat(501));
    assert.equal(r.ok, false);
    assert.equal(r.error, 'text_too_long');
  });

  it('runSafetyGate 色情暴力 → block', () => {
    const r = runSafetyGate('色情暴力');
    assert.equal(r.action, 'block');
  });

  it('nearby detector missing loc → skipped false, need_location true', async () => {
    const reg = createRegistry();
    registerDefaultDetectors(reg);
    const r = await reg.run('nearby_resource', {
      login: {},
      turn: { need_location: true },
    });
    assert.equal(r.skipped, false);
    assert.equal(r.need_location, true);
  });
});
