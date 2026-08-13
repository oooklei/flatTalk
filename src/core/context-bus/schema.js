export function emptyLogin() {
  return {
    user_id: '',
    role_key: '',
    role_id: '',
    entity_type: '',
    entity_id: '',
    tags: [],
    elder_binding: { elder_id: '', elders: [] },
    org: { org_id: '', org_name: '' },
    city: '',
    location: null,
    identity_source: 'sso',
    identity_status: 'provisional',
  };
}

export function emptyTurn() {
  return {
    original_text: '',
    normalized_text: '',
    pronouns: [],
    mentioned_entities: [],
    cities: [],
    primary_city: '',
    location_intent: false,
    need_location: false,
    intents: [],
    primary_intent_index: 0,
    pending_intents: [],
    business: {},
    safety: null,
    normalize: null,
    updated_at: '',
  };
}

export function normalizeLogin(raw = {}) {
  const base = emptyLogin();
  return {
    ...base,
    ...raw,
    tags: Array.isArray(raw.tags) ? raw.tags : base.tags,
    elder_binding: { ...base.elder_binding, ...(raw.elder_binding || {}) },
    org: { ...base.org, ...(raw.org || {}) },
  };
}

export function normalizeTurn(raw = {}) {
  const base = emptyTurn();
  return {
    ...base,
    ...raw,
    pronouns: Array.isArray(raw.pronouns) ? raw.pronouns : [],
    mentioned_entities: Array.isArray(raw.mentioned_entities) ? raw.mentioned_entities : [],
    cities: Array.isArray(raw.cities) ? raw.cities : [],
    intents: Array.isArray(raw.intents) ? raw.intents : [],
    pending_intents: Array.isArray(raw.pending_intents) ? raw.pending_intents : [],
    business: raw.business && typeof raw.business === 'object' ? raw.business : {},
  };
}

export function injectProfile(login, turn, skillKey) {
  const L = normalizeLogin(login);
  const T = normalizeTurn(turn);
  const elderId = L.elder_binding?.elder_id || '';
  const resources = (T.business && T.business[skillKey]) || {};
  const city = T.primary_city || L.city || '';
  return {
    user_id: L.user_id,
    role_key: L.role_key,
    entity_type: L.entity_type,
    entity_id: L.entity_id || L.user_id,
    tags: L.tags,
    elder_id: elderId,
    has_elder: Boolean(elderId),
    org: L.org,
    city,
    primary_city: city,
    location: L.location,
    need_location: Boolean(T.need_location),
    identity_status: L.identity_status,
    normalized_text: T.normalized_text || T.original_text,
    mentioned_entities: T.mentioned_entities,
    pronouns: T.pronouns,
    resources,
    skill_key: skillKey,
  };
}
