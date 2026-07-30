import { createChatOrchestrator } from '../core/orchestrator/chat-orchestrator.js';

export async function runLocalSkill(request = {}, options = {}) {
  return createChatOrchestrator(options).run(request);
}
