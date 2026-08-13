export function createRegistry() {
  const map = new Map();
  return {
    register(skillKey, fn) {
      map.set(skillKey, fn);
    },
    async run(skillKey, ctx) {
      const fn = map.get(skillKey);
      if (!fn) return { ok: true, resources: {}, skill_key: skillKey, detector: 'noop' };
      return fn(ctx);
    },
    has(skillKey) {
      return map.has(skillKey);
    },
  };
}
