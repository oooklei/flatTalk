import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionContextText,
  splitBusinessDataForPrompt,
  SESSION_FIELDS_FOR_SKILL_STRIP,
} from '../src/core/context-bus/session-prompt-context.js';

describe('buildSessionContextText', () => {
  it('elder self: one sentence', () => {
    const t = buildSessionContextText({
      profile_scope: 'self',
      display_name: '黄秀英',
      user_name: '黄秀英',
    });
    assert.match(t, /黄秀英/);
    assert.match(t, /老人本人/);
  });

  it('family: lists elder names', () => {
    const t = buildSessionContextText({
      profile_scope: 'family_elders',
      user_name: '陈晓梅',
      entity_profiles: [
        { entity_type: 'ELDER', name: '黄秀英' },
        { entity_type: 'ELDER', name: '李德明' },
      ],
      elders: [{ elder_name: '黄秀英' }, { elder_name: '李德明' }],
    });
    assert.match(t, /陈晓梅/);
    assert.match(t, /家属/);
    assert.match(t, /黄秀英/);
    assert.match(t, /李德明/);
  });

  it('org: names institution', () => {
    const t = buildSessionContextText({
      profile_scope: 'org',
      user_name: '陈建国',
      org: { org_id: 'o1', org_name: '桂小养康养中心' },
    });
    assert.match(t, /机构/);
    assert.match(t, /桂小养康养中心/);
  });

  it('service_provider: names provider', () => {
    const t = buildSessionContextText({
      profile_scope: 'service_provider',
      user_name: '张服务',
      org: { org_name: '广西康养服务商' },
      entity_profile: { name: '广西康养服务商' },
    });
    assert.match(t, /服务商/);
    assert.match(t, /广西康养服务商/);
  });

  it('appends city half-sentence when present', () => {
    const t = buildSessionContextText({
      profile_scope: 'self',
      display_name: '黄秀英',
      city: '南宁',
    });
    assert.match(t, /南宁/);
  });
});

describe('splitBusinessDataForPrompt', () => {
  it('moves session fields to profiles and keeps jtd in skill', () => {
    const { session_profiles, skill_business_data } = splitBusinessDataForPrompt({
      user_name: '陈晓梅',
      entity_profile: { entity_id: 'e1', name: '黄秀英', tags: [] },
      entity_profiles: [{ entity_id: 'e1', name: '黄秀英' }],
      weather: { ok: true, text: '晴' },
      location: { city: '南宁' },
      city: '南宁',
      profile_scope: 'family_elders',
      jtd: { products: [{ product_id: 'p1' }] },
      routes: [{ route_id: 'r1' }],
      destination: '北海',
    });
    assert.equal(session_profiles.user_name, '陈晓梅');
    assert.equal(session_profiles.entity_profile?.name, '黄秀英');
    assert.ok(session_profiles.entity_profiles?.length);
    assert.equal(session_profiles.weather?.text, '晴');
    assert.deepEqual(skill_business_data.jtd.products[0], { product_id: 'p1' });
    assert.equal(skill_business_data.destination, '北海');
    assert.equal(skill_business_data.entity_profile, undefined);
    assert.equal(skill_business_data.user_name, undefined);
    assert.equal(skill_business_data.weather, undefined);
  });

  it('handles empty / non-object', () => {
    const a = splitBusinessDataForPrompt(null);
    assert.deepEqual(a.session_profiles, {});
    assert.deepEqual(a.skill_business_data, {});
  });
});
