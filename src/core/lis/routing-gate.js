export function isTicketValid(ticket) {
  if (!ticket?.issued_at || !ticket?.ttl_seconds) return false;
  const issued = Date.parse(ticket.issued_at);
  if (Number.isNaN(issued)) return false;
  return (Date.now() - issued) / 1000 <= Number(ticket.ttl_seconds);
}

/**
 * Pure-SORT consumer: flatTalk always sorts via LIS.
 * BOUNDARY / SKILL_LOCK ticket modes are retired on the FT main path.
 *
 * @returns {{ mode: 'SORT', reason: string }}
 */
export function decideRoute({
  reenter_chat = false,
} = {}) {
  if (reenter_chat) return { mode: 'SORT', reason: 'reenter_chat' };
  return { mode: 'SORT', reason: 'pure_sort' };
}
