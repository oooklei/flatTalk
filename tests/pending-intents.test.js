import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingFollowups,
  mergePendingIntoInteractions,
} from '../src/core/pipeline/pending-intents.js';
import { ensureLoginOnSession } from '../src/core/context-bus/ensure-login.js';
import { readBus } from '../src/core/context-bus/store.js';

describe('buildPendingFollowups', () => {
  it('maps skill_key to Chinese labels', () => {
    const out = buildPendingFollowups([
      { skill_key: 'meal_plan' },
      { skill_key: 'travel_route' },
      { skill_key: 'nearby_resource' },
    ]);
    assert.equal(out.length, 3);
    assert.equal(out[0].label, '还要继续：膳食食谱？');
    assert.equal(out[1].label, '还要继续：旅居线路？');
    assert.equal(out[2].label, '还要继续：附近资源？');
    assert.ok(out.every((item) => item.user_prompt && item.message));
  });

  it('dedupes by skill_key and skips empty', () => {
    const out = buildPendingFollowups([
      { skill_key: 'travel_route', utterance: '推荐北海线路' },
      { skill_key: 'travel_route' },
      {},
      { skill_key: '' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].message, '推荐北海线路');
    assert.equal(out[0].user_prompt, '推荐北海线路');
  });

  it('returns empty for non-array', () => {
    assert.deepEqual(buildPendingFollowups(null), []);
    assert.deepEqual(buildPendingFollowups(undefined), []);
  });
});

describe('mergePendingIntoInteractions', () => {
  it('appends only when followup arrays already exist', () => {
    const merged = mergePendingIntoInteractions(
      {
        followup_suggestions: [{ label: '已有追问', user_prompt: '已有追问' }],
        compact_followups: [],
      },
      [{ skill_key: 'travel_route' }],
    );
    assert.equal(merged.followup_suggestions.length, 2);
    assert.ok(merged.followup_suggestions.some((f) => f.label.includes('旅居线路')));
    assert.equal(merged.compact_followups.length, 1);
  });

  it('does not invent arrays when missing', () => {
    const merged = mergePendingIntoInteractions(
      { actions: [] },
      [{ skill_key: 'meal_plan' }],
    );
    assert.equal(merged.followup_suggestions, undefined);
    assert.equal(merged.compact_followups, undefined);
  });
});

describe('ensureLoginOnSession location merge', () => {
  it('merges body.location into login', async () => {
    const session = { conversation_id: 'loc-test', turns: [], global_context: {} };
    await ensureLoginOnSession(session, {
      user_id: 'U1',
      roleKey: 'elder',
      roleId: 'LAO_REN',
      location: { lat: 25.27, lng: 110.29, city: '桂林', source: 'device' },
    });
    const login = readBus(session).login;
    assert.equal(login.location.lat, 25.27);
    assert.equal(login.city, '桂林');
  });

  it('skips Tag HTTP when already confirmed', async () => {
    let calls = 0;
    const session = { conversation_id: 'confirmed-test', turns: [], global_context: {} };
    const reader = {
      async getEntityProfile() {
        calls += 1;
        return {
          ok: true,
          data: { entity_type: 'ELDER', entity_id: 'U1', tags: [{ tag_code: 'A' }] },
        };
      },
    };
    await ensureLoginOnSession(session, {
      user_id: 'U1',
      roleKey: 'elder',
      roleId: 'LAO_REN',
    }, { tagReader: reader });
    assert.equal(calls, 1);
    assert.equal(readBus(session).login.identity_status, 'confirmed');
    await ensureLoginOnSession(session, {
      user_id: 'U1',
      roleKey: 'elder',
      roleId: 'LAO_REN',
    }, { tagReader: reader });
    assert.equal(calls, 1);
  });
});
