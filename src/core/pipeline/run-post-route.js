import { setSkillBusiness, readBus, replacePendingIntents } from '../context-bus/store.js';
import { injectProfile } from '../context-bus/schema.js';
import { getDefaultRegistry } from './detectors/index.js';

/**
 * Post-route Context Bus: detectors → setSkillBusiness → injectProfile.
 * @returns {{ detected: object, profile: object }}
 */
export async function runPostRoute({ session, skillKey, utterance, mark }) {
  const reg = getDefaultRegistry();
  const bus = readBus(session);
  const detected = await reg.run(skillKey, { utterance, login: bus.login, turn: bus.turn });
  setSkillBusiness(session, skillKey, detected.resources || {});
  if (Array.isArray(bus.turn.pending_intents) && bus.turn.pending_intents.length) {
    // primary already consuming intents[0]; keep pending as-is for drain UX later
    replacePendingIntents(session, bus.turn.pending_intents);
  }
  const nextBus = readBus(session);
  const profile = injectProfile(nextBus.login, nextBus.turn, skillKey);
  mark?.('inject', 'profile注入', {
    skill_key: skillKey,
    has_elder: profile.has_elder,
    need_location: profile.need_location || detected.need_location,
    inject_keys: Object.keys(profile.resources || {}),
  });
  return { detected, profile };
}
