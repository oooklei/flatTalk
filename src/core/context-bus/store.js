import { emptyLogin, emptyTurn, normalizeLogin, normalizeTurn } from './schema.js';

const BUS_KEY = 'context_bus';

export function readBus(session) {
  const raw = session?.global_context?.[BUS_KEY] || {};
  return {
    login: normalizeLogin(raw.login || emptyLogin()),
    turn: normalizeTurn(raw.turn || emptyTurn()),
  };
}

function ensure(session) {
  if (!session.global_context) session.global_context = {};
  if (!session.global_context[BUS_KEY]) {
    session.global_context[BUS_KEY] = { login: emptyLogin(), turn: emptyTurn() };
  }
  return session.global_context[BUS_KEY];
}

export function writeLogin(session, loginPatch) {
  const bus = ensure(session);
  bus.login = normalizeLogin({ ...bus.login, ...loginPatch });
  return bus.login;
}

export function mergeTurn(session, turnPatch) {
  const bus = ensure(session);
  const prevBiz = bus.turn?.business || {};
  const next = normalizeTurn({ ...bus.turn, ...turnPatch });
  if (turnPatch.business) {
    next.business = { ...prevBiz, ...turnPatch.business };
  } else {
    next.business = prevBiz;
  }
  next.updated_at = new Date().toISOString();
  bus.turn = next;
  return bus.turn;
}

export function setSkillBusiness(session, skillKey, resources) {
  const bus = ensure(session);
  bus.turn = normalizeTurn(bus.turn);
  bus.turn.business = { ...(bus.turn.business || {}), [skillKey]: resources || {} };
  bus.turn.updated_at = new Date().toISOString();
  return bus.turn.business[skillKey];
}

export function replacePendingIntents(session, pending) {
  return mergeTurn(session, { pending_intents: Array.isArray(pending) ? pending : [] });
}
