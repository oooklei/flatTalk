/**
 * ContextProjector — SessionStore → DialogueView + BizHints for LIS.
 *
 * Session turns are often a single record (user_message + envelope).
 * We expand each into user + assistant DialogueTurns when text is present.
 * Do not fabricate turns to reach the boundary minimum of 3.
 */

const DEFAULT_LIMIT = 5;
const HARD_CAP_LIMIT = 8;

const ENTITY_LOCK_KEYS = [
  'entity_type',
  'entity_id',
  'display_name',
  'route_id',
  'product_id',
  'route_title',
  'destination',
  'city',
  'elder_id',
  'elder_name',
  'service_id',
  'org_id',
  'worker_id',
  'order_id',
  'dispatch_id',
  'staff_id',
  'org_name',
  'center',
  'category',
];

/**
 * @param {object} session
 * @param {{ ticket?: object|null, limit?: number }} [options]
 * @returns {import('../../types').DialogueView|object}
 */
export function projectDialogueView(session = {}, { ticket = null, limit = DEFAULT_LIMIT } = {}) {
  const requested = Number(limit);
  const capped = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_LIMIT;
  const maxPairs = Math.min(HARD_CAP_LIMIT, Math.max(1, capped));
  const rawTurns = Array.isArray(session.turns) ? session.turns : [];
  // Take last N session turns (each may expand to 2 DialogueTurns)
  const window = rawTurns.slice(-maxPairs);
  const turns = [];

  for (const turn of window) {
    if (!turn || typeof turn !== 'object') continue;
    const meta = extractTurnMeta(turn);
    const userText = extractUserText(turn);
    const assistantText = extractAssistantText(turn);

    if (userText) {
      turns.push(buildDialogueTurn({
        turn_id: `${meta.base_id}:user`,
        role: 'user',
        text: userText,
        ...meta.fields,
      }));
    }
    if (assistantText) {
      turns.push(buildDialogueTurn({
        turn_id: `${meta.base_id}:assistant`,
        role: 'assistant',
        text: assistantText,
        ...meta.fields,
      }));
    }
  }

  return {
    schema_version: '1.0',
    conversation_id: String(session.conversation_id || session.id || ''),
    active_agent: session.active_agent ?? null,
    routing_ticket: ticket ?? null,
    turns,
  };
}

/**
 * @param {{
 *   request?: object,
 *   snapshot?: object|null,
 *   catalogIntentIds?: string[],
 *   semantic?: object|null,
 * }} [input]
 */
export function projectBizHints({
  request = {},
  snapshot = null,
  catalogIntentIds = [],
  semantic = null,
} = {}) {
  const ctx = request.context || {};
  const location = ctx.location || request.location || {};
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};

  const user = {
    elder_id: firstText(request.elder_id, ctx.elder_id, snap.elder_id),
    elder_name: firstText(request.elder_name, ctx.elder_name, snap.elder_name),
    role: firstText(request.role, ctx.role, request.roleKey),
    user_token: firstText(request.user_token, request.userToken, ctx.user_token),
  };

  const geo = {
    location: {
      lat: location.lat ?? location.latitude ?? null,
      lng: location.lng ?? location.longitude ?? null,
      city: firstText(location.city, snap.city),
      address: firstText(location.address),
    },
    city: firstText(location.city, snap.city, snap.destination),
    center: firstText(snap.center, ctx.center, request.center),
    destination: firstText(snap.destination, ctx.destination, request.destination),
  };

  // scene soft-bias 仅来自上一轮 LIS 锁定结果，禁止 Supervisor / 客户端自造 skill_key 摆渡。
  const scene = {
    skill_key: firstText(snap.scene, ctx.previous_scene, ctx.lis_locked_scene),
    scene_key: firstText(snap.scene, ctx.previous_scene, ctx.lis_locked_scene),
    intent_id: firstText(snap.intent, ctx.previous_intent, ctx.lis_locked_intent),
    template_id: firstText(
      snap.template_id,
      ctx.previous_template,
      ctx.last_template,
      ctx.lis_locked_template,
    ),
    action_key: firstText(ctx.action_key, request.action_key),
    action_params: isPlainObject(ctx.action_params)
      ? ctx.action_params
      : (isPlainObject(request.params) ? request.params : {}),
    followup_source: firstText(ctx.followup_source, request.followup_source),
  };

  const entity_lock = {};
  for (const key of ENTITY_LOCK_KEYS) {
    const value = firstText(snap[key], ctx[`previous_${key}`], request[key]);
    if (value) entity_lock[key] = value;
  }

  return {
    schema_version: '1.0',
    user,
    geo,
    scene,
    entity_lock,
    semantic: semantic && typeof semantic === 'object' ? semantic : {},
    catalog_intent_ids: Array.isArray(catalogIntentIds)
      ? catalogIntentIds.map(String)
      : [],
    extras: {},
  };
}

function extractTurnMeta(turn) {
  const env = turn.envelope || {};
  const base_id = String(turn.turn_id || env.turn_id || `turn_${Date.now().toString(36)}`);
  const fields = {};
  const skill_key = firstText(turn.skill_key, env.skill_key, env.agent_key);
  const intent_id = firstText(turn.intent_id, turn.intent, env.intent);
  const template_id = firstText(turn.template_id, env.template_id);
  const decision_status = firstText(turn.decision_status, env.decision_status, env.route?.decision);
  const source = firstText(turn.source, env.source, env.route?.source);

  if (skill_key) fields.skill_key = skill_key;
  if (intent_id) fields.intent_id = intent_id;
  if (template_id) fields.template_id = template_id;
  if (decision_status) fields.decision_status = decision_status;
  if (isValidSource(source)) fields.source = source;

  return { base_id, fields };
}

function extractUserText(turn) {
  return firstText(
    turn.user_text,
    turn.user_message,
    turn.message,
    turn.utterance,
    turn.envelope?.user_message,
    turn.envelope?.message,
  );
}

function extractAssistantText(turn) {
  const env = turn.envelope || {};
  return firstText(
    turn.assistant_text,
    env.answer_text,
    env.answer,
    env.message,
    env.llm?.answer,
    summarizeTemplate(env),
  );
}

function summarizeTemplate(env = {}) {
  const templateId = firstText(env.template_id, env.template_key);
  const skill = firstText(env.skill_key);
  if (!templateId && !skill) return '';
  if (templateId && skill) return `[${skill}/${templateId}]`;
  return `[${templateId || skill}]`;
}

function buildDialogueTurn({ turn_id, role, text, ...rest }) {
  const out = { turn_id, role, text };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function isValidSource(value) {
  return ['lis_sort', 'skill_lock', 'boundary_stay', 'llm', 'clarify'].includes(value);
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
