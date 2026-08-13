import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bindFromSso } from '../src/core/context-bus/login-binder.js';
import { applyTagCorrection } from '../src/core/context-bus/tag-corrector.js';

describe('login-binder', () => {
  it('builds provisional ELDER from LAO_REN', () => {
    const login = bindFromSso({
      userId: 'U_E',
      roleId: 'LAO_REN',
      elderScope: 'elder_E1',
      orgId: '',
      orgName: '',
    }, { roleKey: 'elder' });
    assert.equal(login.identity_status, 'provisional');
    assert.equal(login.entity_type, 'ELDER');
    assert.equal(login.elder_binding.elder_id, 'E1');
  });
});

describe('tag-corrector', () => {
  it('marks confirmed when tag reader returns profile', async () => {
    const reader = {
      async getEntityProfile() {
        return {
          ok: true,
          data: {
            entity_type: 'ELDER',
            entity_id: 'U_E',
            tags: [{ tag_code: 'DIABETES' }],
          },
        };
      },
    };
    const next = await applyTagCorrection(
      { user_id: 'U_E', entity_type: 'ELDER', elder_binding: { elder_id: 'U_E' }, tags: [] },
      { tagReader: reader },
    );
    assert.equal(next.identity_status, 'confirmed');
    assert.equal(next.identity_source, 'merged');
    assert.ok(next.tags.some((t) => t.tag_code === 'DIABETES' || t === 'DIABETES'));
  });
  it('keeps provisional on reader failure', async () => {
    const reader = {
      async getEntityProfile() {
        return { ok: false, error: 'pg_error' };
      },
    };
    const next = await applyTagCorrection(
      { user_id: 'U_E', entity_type: 'ELDER', identity_status: 'provisional', tags: [] },
      { tagReader: reader },
    );
    assert.equal(next.identity_status, 'provisional');
  });
  it('skips reader when user_id empty', async () => {
    let called = 0;
    const reader = {
      async getEntityProfile() {
        called += 1;
        return { ok: true, data: { entity_id: 'x', tags: [] } };
      },
    };
    const next = await applyTagCorrection(
      { user_id: '', identity_status: 'provisional', tags: [] },
      { tagReader: reader },
    );
    assert.equal(called, 0);
    assert.equal(next.identity_status, 'provisional');
  });
});
