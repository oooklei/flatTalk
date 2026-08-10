import { createAgentRegistry } from './agent-registry.js';
import { createMealPlanAgent } from './agents/meal-plan-agent.js';
import { createTravelRouteAgent } from './agents/travel-route-agent.js';
import { createNearbyResourceAgent } from './agents/nearby-resource-agent.js';
import { createFindServiceAgent } from './agents/find-service-agent.js';
import { createHealthRiskAgent } from './agents/health-risk-agent.js';
import { createDispatchManageAgent } from './agents/dispatch-manage-agent.js';
import { createServiceQualityEvalAgent } from './agents/service-quality-eval-agent.js';
import { createCommonAgent } from './agents/common-agent.js';
import { detectEmergency } from '../intent-classifier/emergency-detector.js';

export function createSupervisor() {
  const registry = createAgentRegistry();
  registry.register(createMealPlanAgent());
  registry.register(createTravelRouteAgent());
  registry.register(createNearbyResourceAgent());
  registry.register(createFindServiceAgent());
  registry.register(createHealthRiskAgent());
  registry.register(createDispatchManageAgent());
  registry.register(createServiceQualityEvalAgent());
  registry.register(createCommonAgent());

  // 找出除 excludeKey 外、matchScore 最高的非 common agent（用于 keep 阶段的对抗性再判定）。
  function bestOtherAgent(message, excludeKey) {
    let bestKey = null;
    let bestScore = 0;
    for (const agent of registry.list()) {
      if (agent.key === 'common' || agent.key === excludeKey) continue;
      const s = agent.matchScore(message);
      if (s > bestScore) { bestScore = s; bestKey = agent.key; }
    }
    return bestKey ? { key: bestKey, score: bestScore } : null;
  }

  return {
    registry,

    async route({ message = '', context = {} }) {
      const text = String(message || '').toLowerCase();

      // Step 1: SOS → find_service/service_emergency（与 orchestrator + emergency-detector 一致）
      const emergency = detectEmergency({ text: message });
      if (emergency.matched && (emergency.intent_type === 'SOS' || emergency.urgency_level === 'P0')) {
        return { agentKey: 'find_service', switched: context.active_agent !== 'find_service', from: context.active_agent || null, emergency: true, reason: 'SOS_emergency' };
      }

      // Step 2: action_key prefix
      const actionKey = context.action_key;
      if (actionKey) {
        const agent = registry.findByActionPrefix(actionKey);
        if (agent) {
          return { agentKey: agent.key, switched: false, from: null, emergency: false, reason: 'action_prefix' };
        }
      }

      const activeAgentKey = context.active_agent;

      // Step 3: active_agent keep（带对抗性再判定，避免场景过粘）
      if (activeAgentKey) {
        const activeAgent = registry.get(activeAgentKey);
        if (activeAgent) {
          const canHandle = activeAgent.canHandle(message, context);
          if (canHandle === true) {
            // 活跃场景仅因弱/泛意图命中而能 handle 时，若另有场景存在明显更强的意图，
            // 则切走，让用户能按新意图回到对应场景；否则保留同场景续写粘性。
            const best = bestOtherAgent(message, activeAgentKey);
            if (best && best.key !== activeAgentKey && best.score >= 0.5 && best.score > activeAgent.matchScore(message)) {
              return { agentKey: best.key, switched: true, from: activeAgentKey, emergency: false, reason: `keep_override:${best.key}` };
            }
            return { agentKey: activeAgentKey, switched: false, from: null, emergency: false, reason: 'active_agent_keep' };
          }
          if (canHandle && canHandle.suggest) {
            const suggested = registry.get(canHandle.suggest);
            if (suggested) {
              return { agentKey: canHandle.suggest, switched: true, from: activeAgentKey, emergency: false, reason: `boundary:${canHandle.reason}` };
            }
          }
        }
      }

      // Step 4: keyword match
      const allAgents = registry.list();
      let bestKey = 'common';
      let bestScore = 0;
      for (const agent of allAgents) {
        if (agent.key === 'common') continue;
        const score = agent.matchScore(message);
        if (score > bestScore) { bestScore = score; bestKey = agent.key; }
      }

      if (bestScore >= 0.3) {
        const switched = activeAgentKey != null && activeAgentKey !== bestKey;
        return { agentKey: bestKey, switched, from: switched ? activeAgentKey : null, emergency: false, reason: 'keyword_match' };
      }

      // Step 5: fallback common
      return { agentKey: 'common', switched: activeAgentKey != null && activeAgentKey !== 'common', from: activeAgentKey && activeAgentKey !== 'common' ? activeAgentKey : null, emergency: false, reason: 'fallback' };
    },

    getAgent(key) { return registry.get(key); },
  };
}
