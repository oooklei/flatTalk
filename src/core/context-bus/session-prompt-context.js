export const SESSION_FIELDS_FOR_SKILL_STRIP = [
  'user_name', 'elder_name', 'display_name', 'profile_scope',
  'entity_profile', 'entity_profiles', 'weather', 'location',
  'shared', 'user_id', 'role_key', 'role_id', 'org', 'elders',
  'elder_id', 'has_elder', 'identity_status', 'entity_type', 'entity_id',
  'tags', 'normalized_text', 'mentioned_entities', 'pronouns',
  'need_location', 'resources', 'skill_key', 'primary_city',
];

function pickName(...vals) {
  for (const v of vals) {
    const s = v == null ? '' : String(v).trim();
    if (s) return s;
  }
  return '';
}

function elderNameList(bd = {}) {
  const fromProfiles = (Array.isArray(bd.entity_profiles) ? bd.entity_profiles : [])
    .filter((p) => !p.entity_type || p.entity_type === 'ELDER')
    .map((p) => pickName(p.name, p.entity_name, p.elder_name))
    .filter(Boolean);
  if (fromProfiles.length) return [...new Set(fromProfiles)];
  const fromElders = (Array.isArray(bd.elders) ? bd.elders : [])
    .map((e) => pickName(e.elder_name, e.name))
    .filter(Boolean);
  if (fromElders.length) return [...new Set(fromElders)];
  const one = pickName(bd.elder_name);
  return one ? [one] : [];
}

export function buildSessionContextText(bd = {}) {
  const scope = bd.profile_scope || '';
  const userName = pickName(bd.user_name, bd.display_name);
  const displayName = pickName(bd.display_name, bd.user_name, bd.elder_name);
  const orgName = pickName(bd.org?.org_name, bd.entity_profile?.name, bd.entity_profile?.entity_name);
  const city = pickName(bd.city, bd.primary_city);
  let core = '';
  if (scope === 'family_elders') {
    const names = elderNameList(bd);
    const list = names.length ? names.join('、') : '（暂无绑定老人）';
    core = `当前用户是${userName || '家属用户'}（家属）。你代表其名下老人：${list}。`;
  } else if (scope === 'org') {
    core = `当前用户是${userName || '机构用户'}（机构侧）。你代表机构：${orgName || '（未命名机构）'}。`;
  } else if (scope === 'service_provider') {
    core = `当前用户是${userName || '服务商用户'}（服务商侧）。你代表服务商：${orgName || '（未命名服务商）'}。`;
  } else if (scope === 'self') {
    core = `当前用户是${displayName || userName || '老人用户'}（老人本人）。`;
  } else {
    core = `当前用户是${displayName || userName || '用户'}。`;
  }
  if (city) core += `当前关注城市：${city}。`;
  return core.trim();
}

export function splitBusinessDataForPrompt(businessData) {
  if (!businessData || typeof businessData !== 'object') {
    return { session_profiles: {}, skill_business_data: {} };
  }
  const session_profiles = {};
  const profileKeys = [
    'user_name', 'elder_name', 'display_name', 'profile_scope',
    'entity_profile', 'entity_profiles', 'weather', 'location', 'city',
    'primary_city', 'elders', 'elder_id', 'org',
  ];
  for (const k of profileKeys) {
    if (businessData[k] !== undefined && businessData[k] !== null && businessData[k] !== '') {
      session_profiles[k] = businessData[k];
    }
  }
  const skill_business_data = { ...businessData };
  for (const k of SESSION_FIELDS_FOR_SKILL_STRIP) {
    delete skill_business_data[k];
  }
  delete skill_business_data.city;
  delete skill_business_data.primary_city;
  return { session_profiles, skill_business_data };
}
