import { resolveEntityType } from './role-entity-map.js';
import { normalizeLogin, emptyLogin } from './schema.js';

function stripElderScope(scope) {
  const s = String(scope || '');
  if (s.startsWith('elder_')) return s.slice('elder_'.length);
  return s;
}

/** role_key 由 SSO 层传入，避免 login-binder ↔ external-aes-sso 循环依赖 */
export function bindFromSso(userInfo = {}, { roleKey = '' } = {}) {
  const roleId = String(userInfo.roleId || userInfo.role_id || '').trim();
  const mapped = resolveEntityType(roleId);
  const userId = String(userInfo.userId || userInfo.user_id || '').trim();
  let elderId = stripElderScope(userInfo.elderScope || userInfo.elder_id || '');
  if (mapped.binding === 'self' && !elderId) elderId = userId;

  return normalizeLogin({
    ...emptyLogin(),
    user_id: userId,
    role_id: roleId,
    role_key: roleKey || String(userInfo.roleKey || userInfo.role_key || '').trim(),
    entity_type: mapped.entity_type,
    entity_id: userId,
    tags: mapped.tags || [],
    elder_binding: {
      elder_id: elderId,
      elders: elderId ? [{ elder_id: elderId }] : [],
    },
    org: {
      org_id: String(userInfo.orgId || userInfo.org_id || '').trim(),
      org_name: String(userInfo.orgName || userInfo.org_name || '').trim(),
    },
    identity_source: 'sso',
    identity_status: 'provisional',
  });
}
