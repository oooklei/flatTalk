/**
 * Serialize chat envelope as SSE: optional stream_events, then final envelope event.
 * @param {{ data?: { stream_events?: Array<{ event: string, payload?: unknown }> } }} envelope
 * @returns {string}
 */
export function serializeChatSse(envelope) {
  const chunks = [];
  const events = envelope?.data?.stream_events;
  if (Array.isArray(events)) {
    for (const ev of events) {
      const name = ev?.event || 'message';
      const payload = ev?.payload === undefined ? null : ev.payload;
      chunks.push(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  }
  chunks.push(`event: envelope\ndata: ${JSON.stringify(envelope)}\n\n`);
  return chunks.join('');
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function wantsChatSse(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.searchParams.get('stream') === '1') return true;
  const accept = String(req.headers?.accept || '');
  return accept.includes('text/event-stream');
}

/**
 * Write SSE response for a completed chat envelope.
 * @param {import('node:http').ServerResponse} res
 * @param {object} envelope
 */
export function writeChatSse(res, envelope) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(serializeChatSse(envelope));
  res.end();
}
