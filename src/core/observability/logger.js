import fs from 'node:fs';
import path from 'node:path';

export function createRuntimeLogger({ logPath = path.join(process.cwd(), 'data', 'runtime-events.log') } = {}) {
  return {
    logPath,

    write(event = {}) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const payload = {
        ts: new Date().toISOString(),
        ...event,
      };
      fs.appendFileSync(logPath, JSON.stringify(payload) + '\n');
      return payload;
    },

    list({ limit = 200 } = {}) {
      if (!fs.existsSync(logPath)) return [];
      return fs.readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { raw: line };
          }
        });
    },

    clear() {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, '');
      return true;
    },
  };
}

export function summarizeEnvelope(envelope = {}, startedAt = Date.now()) {
  return {
    request_id: envelope.request_id || '',
    conversation_id: envelope.conversation_id || '',
    turn_id: envelope.turn_id || '',
    scene: envelope.route?.scene_key || envelope.skill_key || '',
    template_id: envelope.template_id || '',
    knowledge_status: envelope.route?.knowledge_status || envelope.debug?.knowledge_status || '',
    model_status: envelope.debug?.model_status || (envelope.route?.model_error ? 'error' : 'ok'),
    latency_ms: Math.max(0, Date.now() - startedAt),
  };
}
