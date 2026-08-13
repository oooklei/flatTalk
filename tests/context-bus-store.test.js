import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readBus, writeLogin, mergeTurn, setSkillBusiness } from '../src/core/context-bus/store.js';
import { emptyLogin } from '../src/core/context-bus/schema.js';

describe('context-bus store', () => {
  it('writeLogin and mergeTurn roundtrip on session object', () => {
    const session = { conversation_id: 'c1', global_context: {} };
    writeLogin(session, { ...emptyLogin(), user_id: 'U1', identity_status: 'provisional' });
    mergeTurn(session, { original_text: 'hi', normalized_text: 'hi', primary_city: '南宁' });
    setSkillBusiness(session, 'travel_route', { route_name: '滨海线' });
    const bus = readBus(session);
    assert.equal(bus.login.user_id, 'U1');
    assert.equal(bus.turn.primary_city, '南宁');
    assert.equal(bus.turn.business.travel_route.route_name, '滨海线');
  });
});
