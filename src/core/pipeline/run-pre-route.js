import { runSafetyGate, safetyEnvelope } from './safety-gate.js';
import { normalizeInput } from './input-normalizer.js';
import { extractTurn } from './turn-extractor.js';
import { mergeTurn, readBus } from '../context-bus/store.js';

/**
 * Pre-route Context Bus: safety → normalize → extract → mergeTurn.
 * @returns {{ halt: boolean, envelopeHint?: object, safety?: object, error?: object, normalized_text?: string, extracted?: object }}
 */
export async function runPreRoute({ session, message, llmCall, mark }) {
  const safety = runSafetyGate(message);
  mark?.('safety', '安全门', safety);
  if (safety.action !== 'pass') {
    mergeTurn(session, { safety, original_text: message, normalized_text: message });
    return { halt: true, envelopeHint: safetyEnvelope(safety.action), safety };
  }

  const norm = await normalizeInput(message, { llmCall });
  mark?.('normalize', '输入规范化', { fixes: norm.fixes, needs_clarify: norm.needs_clarify });
  if (norm.needs_clarify && norm.ok === false) {
    return { halt: true, error: norm };
  }

  const bus = readBus(session);
  const extracted = await extractTurn({
    text: norm.normalized_text,
    login: bus.login,
    turnPrev: bus.turn,
    llmCall,
  });
  mergeTurn(session, {
    original_text: message,
    normalized_text: norm.normalized_text,
    normalize: { fixes: norm.fixes },
    ...extracted,
  });
  mark?.('turn_extract', '会话抽取', {
    intents: extracted.intents,
    primary_city: extracted.primary_city,
    need_location: extracted.need_location,
  });
  return { halt: false, normalized_text: norm.normalized_text, extracted };
}
