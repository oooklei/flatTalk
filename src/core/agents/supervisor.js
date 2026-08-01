import { createAgentRegistry } from './agent-registry.js';
import { createMealPlanAgent } from './agents/meal-plan-agent.js';
import { createTravelRouteAgent } from './agents/travel-route-agent.js';
import { createNearbyResourceAgent } from './agents/nearby-resource-agent.js';
import { createFindServiceAgent } from './agents/find-service-agent.js';
import { createHealthRiskAgent } from './agents/health-risk-agent.js';
import { createDispatchManageAgent } from './agents/dispatch-manage-agent.js';
import { createCommonAgent } from './agents/common-agent.js';
import { LEVEL_1 as SOS_LEVEL_1, LEVEL_2 as SOS_LEVEL_2 } from '../intent-classifier/emergency-detector.js';

const SOS_TERMS = [...SOS_LEVEL_1, ...SOS_LEVEL_2];

export function createSupervisor() {
  const registry = createAgentRegistry();
  registry.register(createMealPlanAgent());
  registry.register(createTravelRouteAgent());
  registry.register(createNearbyResourceAgent());
  registry.register(createFindServiceAgent());
  registry.register(createHealthRiskAgent());
  registry.register(createDispatchManageAgent());
  registry.register(createCommonAgent());

  function detectSOS(text) {
    const lower = text.toLowerCase();
    return SOS_TERMS.some((term) => lower.includes(term));
  }

  return {
    registry,

    async route({ message = '', context = {} }) {
      const text = String(message || '').toLowerCase();

      // Step 1: SOS
      if (detectSOS(text)) {
        return { agentKey: 'health_risk_warning', switched: context.active_agent !== 'health_risk_warning', from: context.active_agent || null, emergency: true, reason: 'SOS_emergency' };
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

      // Step 3: active_agent keep
      if (activeAgentKey) {
        const activeAgent = registry.get(activeAgentKey);
        if (activeAgent) {
          const canHandle = activeAgent.canHandle(message, context);
          if (canHandle === true) {
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
