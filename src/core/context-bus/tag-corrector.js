import { normalizeLogin } from './schema.js';

function resolveTimeoutMs(timeoutMs) {
  if (timeoutMs != null && Number.isFinite(Number(timeoutMs))) return Number(timeoutMs);
  const fromEnv = Number(process.env.FLATTALK_TAG_CORRECT_TIMEOUT_MS || 2500);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 2500;
}

/**
 * Merge Tag-System entity profile into login context.
 * Skips when no reader / no user_id; failures keep provisional.
 */
export async function applyTagCorrection(login, { tagReader, timeoutMs } = {}) {
  const base = normalizeLogin(login);
  if (!tagReader || typeof tagReader.getEntityProfile !== 'function') {
    return base;
  }
  if (!base.user_id) {
    return { ...base, identity_status: base.identity_status || 'provisional' };
  }
  try {
    const result = await Promise.race([
      tagReader.getEntityProfile(base.user_id, {
        entityType: base.entity_type || base.entityType || 'ELDER',
      }),
      new Promise((resolve) => setTimeout(
        () => resolve({ ok: false, error: 'timeout' }),
        resolveTimeoutMs(timeoutMs),
      )),
    ]);
    if (!result?.ok || !result.data) return { ...base, identity_status: 'provisional' };
    const tags = Array.isArray(result.data.tags) ? result.data.tags : [];
    return normalizeLogin({
      ...base,
      entity_type: result.data.entity_type || base.entity_type,
      entity_id: result.data.entity_id || base.entity_id,
      tags,
      identity_source: 'merged',
      identity_status: 'confirmed',
    });
  } catch {
    return { ...base, identity_status: 'provisional' };
  }
}
