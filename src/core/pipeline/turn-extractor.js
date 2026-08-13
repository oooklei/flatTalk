import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchHotCity } from '../city-extractor/normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '../../prompts/context-bus/turn-extract.md');

let cachedPrompt = null;
function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  try {
    cachedPrompt = readFileSync(PROMPT_PATH, 'utf8');
  } catch {
    cachedPrompt =
      '从用户本轮话语中抽取槽位与意图，输出严格 JSON。字段：pronouns, mentioned_entities, cities, primary_city, location_intent, intents。';
  }
  return cachedPrompt;
}

const LOCATION_RE = /附近|周边|这里/;

function stripJsonFence(raw) {
  return String(raw || '')
    .replace(/```json|```/gi, '')
    .trim();
}

function hasLoginLat(login) {
  return login?.location?.lat != null;
}

function normalizeIntents(rawIntents) {
  const list = Array.isArray(rawIntents) ? rawIntents : [];
  return list
    .filter((it) => it && typeof it === 'object' && it.skill_key)
    .map((it) => ({
      skill_key: String(it.skill_key),
      confidence: Number(it.confidence) || 0,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

function buildResult({
  pronouns = [],
  mentioned_entities = [],
  cities = [],
  primary_city = null,
  location_intent = false,
  intents = [],
  login = null,
}) {
  const capped = normalizeIntents(intents);
  const need_location = Boolean(location_intent) && !hasLoginLat(login);
  return {
    pronouns: Array.isArray(pronouns) ? pronouns : [],
    mentioned_entities: Array.isArray(mentioned_entities) ? mentioned_entities : [],
    cities: Array.isArray(cities) ? cities : [],
    primary_city: primary_city ?? null,
    location_intent: Boolean(location_intent),
    need_location,
    intents: capped,
    primary_intent_index: 0,
    pending_intents: capped.slice(1),
  };
}

function rulesFallback(text, login) {
  const cities = matchHotCity(text);
  const location_intent = LOCATION_RE.test(String(text || ''));
  return buildResult({
    pronouns: [],
    mentioned_entities: [],
    cities,
    primary_city: cities[0] || null,
    location_intent,
    intents: [],
    login,
  });
}

/**
 * Extract turn slots + multi-intent queue for Context Bus mergeTurn.
 * @param {{ text: string, login?: object, turnPrev?: object, llmCall?: Function, timeoutMs?: number }} opts
 */
export async function extractTurn({
  text,
  login = null,
  turnPrev = {},
  llmCall = null,
  timeoutMs = 3000,
} = {}) {
  const utterance = String(text || '');

  if (typeof llmCall !== 'function') {
    return rulesFallback(utterance, login);
  }

  try {
    const result = await Promise.race([
      llmCall({
        messages: [
          { role: 'system', content: loadPrompt() },
          {
            role: 'user',
            content: JSON.stringify({
              text: utterance,
              login_hint: {
                has_elder: Boolean(login?.elder_binding?.elder_id),
                has_location: hasLoginLat(login),
                city: login?.city || null,
              },
              turn_prev: turnPrev || {},
            }),
          },
        ],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);

    const parsed = JSON.parse(stripJsonFence(result?.content));
    return buildResult({
      pronouns: parsed.pronouns,
      mentioned_entities: parsed.mentioned_entities,
      cities: parsed.cities,
      primary_city: parsed.primary_city ?? null,
      location_intent: parsed.location_intent,
      intents: parsed.intents,
      login,
    });
  } catch {
    return rulesFallback(utterance, login);
  }
}
