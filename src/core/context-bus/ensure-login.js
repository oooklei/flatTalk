import { bindFromSso } from './login-binder.js';
import { applyTagCorrection } from './tag-corrector.js';
import { readBus, writeLogin } from './store.js';

/**
 * Ensure session.context_bus.login is bound (SSO provisional) and optionally tag-corrected.
 * Safe to call every chat turn; merges location when present.
 * Already-confirmed identities skip Tag HTTP unless forceCorrect=true.
 */
export async function ensureLoginOnSession(session, request = {}, {
  tagReader = null,
  sessionStore = null,
  forceCorrect = false,
} = {}) {
  const existing = readBus(session).login;
  let login = existing?.user_id
    ? existing
    : bindFromSso({
      userId: request.user_id || request.userId || '',
      roleId: request.roleId || request.role_id || '',
      elderScope: request.elderScope || request.elder_id || '',
      elder_id: request.elder_id || request.elderScope || '',
      orgId: request.orgId || request.org_id || '',
      orgName: request.orgName || request.org_name || '',
      roleKey: request.role_key || request.roleKey || '',
      role_key: request.role_key || request.roleKey || '',
    }, {
      roleKey: request.role_key || request.roleKey || request.role || '',
    });

  const needCorrect = forceCorrect
    || login.identity_status !== 'confirmed'
    || !Array.isArray(login.tags);

  if (needCorrect) {
    login = await applyTagCorrection(login, { tagReader });
  }

  if (request.location && typeof request.location === 'object') {
    const city = String(request.location.city || request.location.province || '').trim();
    login = {
      ...login,
      location: request.location,
      ...(city ? { city } : {}),
    };
  }

  writeLogin(session, login);
  if (sessionStore && typeof sessionStore.save === 'function') {
    await sessionStore.save(session);
  }
  return login;
}
