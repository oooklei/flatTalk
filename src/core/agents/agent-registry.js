export function createAgentRegistry() {
  const agents = new Map();

  return {
    register(agent) {
      if (!agent?.key) throw new Error(`Agent must have a key, got: ${JSON.stringify(agent?.key)}`);
      agents.set(agent.key, agent);
    },

    get(key) {
      return agents.get(key);
    },

    list() {
      return Array.from(agents.values());
    },

    findByActionPrefix(actionKey) {
      if (!actionKey || typeof actionKey !== 'string') return undefined;
      const prefix = actionKey.split('.')[0];
      return agents.get(prefix);
    },
  };
}
