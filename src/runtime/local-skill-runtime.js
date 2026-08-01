import { createChatOrchestrator } from '../core/orchestrator/chat-orchestrator.js';
import { createSupervisor } from '../core/agents/supervisor.js';

const supervisor = createSupervisor();

export async function runLocalSkill(request = {}, options = {}) {
  const message = request.message || request.text || '';
  const context = request.context || {};

  // ★ Supervisor 路由决策（仅当不是 followup bypass 时）
  if (!context.followup_source && !context.action_key) {
    const route = await supervisor.route({ message, context });
    request.context = {
      ...context,
      agent_key: route.agentKey,
      agent_switched: route.switched,
      agent_from: route.from,
      agent_emergency: route.emergency,
      agent_reason: route.reason,
    };
  } else if (context.action_key) {
    const route = await supervisor.route({ message, context });
    request.context = {
      ...context,
      agent_key: route.agentKey,
      agent_reason: route.reason,
    };
  }

  return createChatOrchestrator(options).run(request);
}
