/**
 * Match LIS IntentSupply against enabled flatTalk catalog entries.
 * Execution key is intent_id; domain is not used as a hard filter.
 */

const CONFIDENCE_THRESHOLD = 0.5;

/**
 * @param {object} supply - IntentSupply-like { intents, decision }
 * @param {Array<object>} catalogEntries - catalog intent packages
 * @returns {{ ok: boolean, entry: object|null, intent: object|null }}
 */
export function matchSupplyToCatalog(supply = {}, catalogEntries = []) {
  const intents = Array.isArray(supply?.intents) ? supply.intents : [];
  const decision = supply?.decision || {};
  const statusOk =
    decision.status === 'MATCH_OK' || Number(decision.max_confidence) >= CONFIDENCE_THRESHOLD;

  const enabledById = new Map();
  for (const pkg of Array.isArray(catalogEntries) ? catalogEntries : []) {
    if (!pkg || typeof pkg !== 'object') continue;
    if (pkg.enabled === false) continue;
    const id = pkg.intent_id;
    if (!id) continue;
    enabledById.set(String(id), pkg);
  }

  let best = null;
  for (const intent of intents) {
    if (!intent || typeof intent !== 'object') continue;
    const id = intent.intent_id;
    if (!id) continue;
    const pkg = enabledById.get(String(id));
    if (!pkg) continue;
    const confidence = Number(intent.confidence);
    const score = Number.isFinite(confidence) ? confidence : 0;
    if (!best || score > best.score) {
      best = { intent, pkg, score };
    }
  }

  if (!statusOk || !best) {
    return { ok: false, entry: null, intent: null };
  }

  return {
    ok: true,
    entry: best.pkg.entry ?? null,
    intent: best.intent,
  };
}
