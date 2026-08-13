import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntityType, ROLE_ENTITY_MAP } from '../src/core/context-bus/role-entity-map.js';
import {
  emptyLogin,
  emptyTurn,
  injectProfile,
  normalizeLogin,
  normalizeTurn,
} from '../src/core/context-bus/schema.js';

describe('role-entity-map', () => {
  it('maps LAO_REN to ELDER self-binding', () => {
    const r = resolveEntityType('LAO_REN');
    assert.equal(r.entity_type, 'ELDER');
    assert.equal(r.binding, 'self');
  });
  it('maps JIA_SHU to USER family binding', () => {
    const r = resolveEntityType('JIA_SHU');
    assert.equal(r.entity_type, 'USER');
    assert.equal(r.binding, 'family');
  });
  it('maps SQJJ-GLY to USER+ORG', () => {
    const r = resolveEntityType('SQJJ-GLY');
    assert.equal(r.entity_type, 'USER');
    assert.equal(r.org_required, true);
  });
});

describe('schema inject_profile', () => {
  it('merges login + turn common + skill business', () => {
    const login = normalizeLogin({
      ...emptyLogin(),
      user_id: 'U1',
      role_key: 'elder',
      entity_type: 'ELDER',
      elder_binding: { elder_id: 'E1' },
      identity_status: 'confirmed',
    });
    const turn = normalizeTurn({
      ...emptyTurn(),
      primary_city: '桂林',
      business: { meal_plan: { meal_slot: 'lunch' } },
    });
    const p = injectProfile(login, turn, 'meal_plan');
    assert.equal(p.elder_id, 'E1');
    assert.equal(p.has_elder, true);
    assert.equal(p.role_key, 'elder');
    assert.equal(p.primary_city, '桂林');
    assert.equal(p.resources.meal_slot, 'lunch');
  });
  it('has_elder false when no binding', () => {
    const p = injectProfile(emptyLogin(), emptyTurn(), 'meal_plan');
    assert.equal(p.has_elder, false);
  });
});
