import { createClient } from 'redis';

export function createRedisStateStore({ redisUrl = process.env.FLATTALK_REDIS_URL || '', namespace = 'flattalk' } = {}) {
  if (!redisUrl) return createMemoryStateStore();

  const client = createClient({ url: redisUrl });
  let connectPromise = null;
  let available = true;
  const memory = createMemoryStateStore();

  async function ensureConnected() {
    if (!available) return false;
    if (!connectPromise) {
      connectPromise = client.connect().catch(() => {
        available = false;
        return false;
      });
    }
    const result = await connectPromise;
    return result !== false;
  }

  function key(name) {
    return `${namespace}:${name}`;
  }

  return {
    source: 'redis',

    isConfigured() {
      return Boolean(redisUrl);
    },

    async getJson(name, fallbackValue = null) {
      if (!(await ensureConnected())) return memory.getJson(name, fallbackValue);
      const raw = await client.get(key(name));
      return raw ? JSON.parse(raw) : fallbackValue;
    },

    async setJson(name, value, { ttlSeconds = 0 } = {}) {
      if (!(await ensureConnected())) return memory.setJson(name, value, { ttlSeconds });
      const raw = JSON.stringify(value);
      if (ttlSeconds > 0) await client.set(key(name), raw, { EX: ttlSeconds });
      else await client.set(key(name), raw);
      return value;
    },

    async listJson(name) {
      if (!(await ensureConnected())) return memory.listJson(name);
      const rows = await client.lRange(key(name), 0, -1);
      return rows.map((row) => JSON.parse(row));
    },

    async pushJson(name, value) {
      if (!(await ensureConnected())) return memory.pushJson(name, value);
      await client.rPush(key(name), JSON.stringify(value));
      return value;
    },

    async clear(name) {
      if (!(await ensureConnected())) return memory.clear(name);
      await client.del(key(name));
      return true;
    },

    async close() {
      if (client.isOpen) await client.quit();
    },
  };
}

export function createMemoryStateStore() {
  const values = new Map();
  const lists = new Map();

  return {
    source: 'memory',

    isConfigured() {
      return false;
    },

    async getJson(name, fallbackValue = null) {
      return values.has(name) ? clone(values.get(name)) : fallbackValue;
    },

    async setJson(name, value) {
      values.set(name, clone(value));
      return value;
    },

    async listJson(name) {
      return clone(lists.get(name) || []);
    },

    async pushJson(name, value) {
      const items = lists.get(name) || [];
      items.push(clone(value));
      lists.set(name, items);
      return value;
    },

    async clear(name) {
      values.delete(name);
      lists.delete(name);
      return true;
    },
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
