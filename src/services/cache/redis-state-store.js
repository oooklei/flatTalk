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

  /** 若历史脏数据把 LIST key 写成了 STRING（或反之），先删掉再按正确类型重建 */
  async function ensureListKey(name) {
    const k = key(name);
    const t = await client.type(k);
    if (t === 'none' || t === 'list') return t;
    console.warn(`[redis-state-store] WRONGTYPE risk on ${k} type=${t}, deleting for list rebuild`);
    await client.del(k);
    return 'none';
  }

  async function ensureStringKey(name) {
    const k = key(name);
    const t = await client.type(k);
    if (t === 'none' || t === 'string') return t;
    console.warn(`[redis-state-store] WRONGTYPE risk on ${k} type=${t}, deleting for string rebuild`);
    await client.del(k);
    return 'none';
  }

  return {
    source: 'redis',

    isConfigured() {
      return Boolean(redisUrl);
    },

    async getJson(name, fallbackValue = null) {
      if (!(await ensureConnected())) return memory.getJson(name, fallbackValue);
      await ensureStringKey(name);
      const raw = await client.get(key(name));
      return raw ? JSON.parse(raw) : fallbackValue;
    },

    async setJson(name, value, { ttlSeconds = 0 } = {}) {
      if (!(await ensureConnected())) return memory.setJson(name, value, { ttlSeconds });
      await ensureStringKey(name);
      const raw = JSON.stringify(value);
      if (ttlSeconds > 0) await client.set(key(name), raw, { EX: ttlSeconds });
      else await client.set(key(name), raw);
      return value;
    },

    async listJson(name) {
      if (!(await ensureConnected())) return memory.listJson(name);
      await ensureListKey(name);
      const rows = await client.lRange(key(name), 0, -1);
      return rows.map((row) => {
        try {
          return JSON.parse(row);
        } catch {
          return row;
        }
      });
    },

    async pushJson(name, value) {
      if (!(await ensureConnected())) return memory.pushJson(name, value);
      await ensureListKey(name);
      await client.rPush(key(name), JSON.stringify(value));
      return value;
    },

    async replaceListJson(name, values = []) {
      if (!(await ensureConnected())) return memory.replaceListJson(name, values);
      const k = key(name);
      await client.del(k);
      if (Array.isArray(values) && values.length > 0) {
        await client.rPush(k, values.map((v) => JSON.stringify(v)));
      }
      return values;
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

    async replaceListJson(name, values = []) {
      lists.set(name, clone(Array.isArray(values) ? values : []));
      return lists.get(name);
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
