export function isTicketValid(ticket) {
  if (!ticket?.issued_at || !ticket?.ttl_seconds) return false;
  const issued = Date.parse(ticket.issued_at);
  if (Number.isNaN(issued)) return false;
  return (Date.now() - issued) / 1000 <= Number(ticket.ttl_seconds);
}

/**
 * @returns {{ mode: 'SORT'|'BOUNDARY'|'SKILL_LOCK', reason: string }}
 */
export function decideRoute({
  ticket,
  context = {},
  skill_key = '',
  utterance = '',
  dialogueTurnCount = 0,
  reenter_chat = false,
} = {}) {
  if (reenter_chat) return { mode: 'SORT', reason: 'reenter_chat' };
  const valid = isTicketValid(ticket);
  const actionLocked = Boolean(context.action_key && (skill_key || context.followup_source));
  const followupLocked = Boolean(context.followup_source && skill_key);
  if (valid && (actionLocked || followupLocked)) {
    return { mode: 'SKILL_LOCK', reason: 'action_or_followup' };
  }
  if (valid && String(utterance || '').trim() && dialogueTurnCount >= 3) {
    return { mode: 'BOUNDARY', reason: 'free_text_with_history' };
  }
  return { mode: 'SORT', reason: valid ? 'insufficient_turns' : 'no_or_invalid_ticket' };
}
