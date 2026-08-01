export function buildEnvelope(input = {}) {
  return {
    schema: input.schema || 'gxy.envelope.v1',
    ok: input.ok !== false,
    request_id: input.request_id || makeId('req'),
    conversation_id: input.conversation_id || '',
    turn_id: input.turn_id || makeId('turn'),
    skill_key: input.skill_key || 'common',
    agent_key: input.agent_key || input.skill_key || '',
    agent_switched: input.agent_switched || input.route_extras?.agent_switched || false,
    intent: input.intent || 'common.chat',
    template_id: input.template_id || 'common.answer.v1',
    template_key: input.template_key || input.template_id || 'common.answer.v1',
    render_mode: input.render_mode || 'frontend_template',
    answer_text: input.answer_text || '',
    data: isPlainObject(input.data) ? input.data : {},
    actions: Array.isArray(input.actions) ? input.actions : [],
    followup_suggestions: Array.isArray(input.followup_suggestions) ? input.followup_suggestions : [],
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    route: input.route || { source: 'flatTalk', confidence: 0 },
    error: input.error || null,
    created_at: input.created_at || new Date().toISOString(),
  };
}

export function validateEnvelope(envelope) {
  if (!isPlainObject(envelope)) return { ok: false, errors: ['envelope_must_be_object'] };

  const errors = [];
  if (envelope.schema !== 'gxy.envelope.v1') errors.push('schema must equal gxy.envelope.v1');
  if (!envelope.conversation_id) errors.push('conversation_id is required');
  if (!Array.isArray(envelope.actions)) errors.push('actions must be an array');
  if (!Array.isArray(envelope.followup_suggestions)) errors.push('followup_suggestions must be an array');
  if (!isPlainObject(envelope.data)) errors.push('data must be an object');
  if (!Array.isArray(envelope.evidence)) errors.push('evidence must be an array');
  if (!isPlainObject(envelope.route)) errors.push('route must be an object');

  if (Array.isArray(envelope.actions)) {
    envelope.actions.forEach((action, index) => {
      if (!isPlainObject(action)) {
        errors.push(`actions[${index}].must_be_object`);
        return;
      }
      if (!action.action_key) errors.push(`actions[${index}].action_key_required`);
      if (!action.label) errors.push(`actions[${index}].label_required`);
      if (action.params !== undefined && !isPlainObject(action.params)) {
        errors.push(`actions[${index}].params_must_be_object`);
      }
    });
  }

  if (Array.isArray(envelope.followup_suggestions)) {
    envelope.followup_suggestions.forEach((followup, index) => {
      if (!isPlainObject(followup)) {
        errors.push(`followup_suggestions[${index}].must_be_object`);
        return;
      }
      if (!followup.label) errors.push(`followup_suggestions[${index}].label_required`);
      if (!followup.user_prompt) errors.push(`followup_suggestions[${index}].user_prompt_required`);
      if (followup.action_key !== undefined && typeof followup.action_key !== 'string') {
        errors.push(`followup_suggestions[${index}].action_key_must_be_string`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
