import pg from 'pg';

import { TABLE_SCHEMAS } from './schemas.js';

const { Pool } = pg;
const STORE_TABLE = 'flattalk_table_rows';

export function createPgTableDataRepository({ pgUrl, seedTables = {}, fallback = null } = {}) {
  const pool = new Pool({
    connectionString: normalizePgUrl(pgUrl),
    max: Number(process.env.FLATTALK_PG_POOL_SIZE || 5),
    connectionTimeoutMillis: Number(process.env.FLATTALK_PG_CONNECT_TIMEOUT_MS || 5000),
    idleTimeoutMillis: Number(process.env.FLATTALK_PG_IDLE_TIMEOUT_MS || 30000),
  });
  let readyPromise = null;
  let pgAvailable = true;

  async function ready() {
    if (!readyPromise) {
      readyPromise = initializeStore(pool, seedTables).catch((error) => {
        pgAvailable = false;
        throw error;
      });
    }
    return readyPromise;
  }

  async function withFallback(operation, fallbackOperation) {
    if (!pgAvailable) return fallbackOperation();
    try {
      await ready();
      return await operation();
    } catch {
      pgAvailable = false;
      return fallbackOperation();
    }
  }

  async function getRow(tableName, id) {
    const result = await pool.query(
      `SELECT data FROM ${STORE_TABLE} WHERE table_name = $1 AND row_id = $2 LIMIT 1`,
      [tableName, String(id)],
    );
    return result.rows[0]?.data || null;
  }

  async function upsert(tableName, row) {
    return withFallback(async () => {
      const key = primaryKey(tableName);
      const next = deepClone(row);
      await pool.query(
        `
          INSERT INTO ${STORE_TABLE} (table_name, row_id, data, updated_at)
          VALUES ($1, $2, $3::jsonb, now())
          ON CONFLICT (table_name, row_id)
          DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        `,
        [tableName, String(next[key]), JSON.stringify(next)],
      );
      return next;
    }, () => fallback.create(tableName, row));
  }

  return {
    source: 'pg',

    isConfigured() {
      return Boolean(pgUrl);
    },

    async list(tableName) {
      assertTable(tableName);
      return withFallback(async () => {
        const result = await pool.query(
          `SELECT data FROM ${STORE_TABLE} WHERE table_name = $1 ORDER BY updated_at DESC`,
          [tableName],
        );
        return result.rows.map((row) => row.data);
      }, () => fallback.list(tableName));
    },

    async get(tableName, id) {
      assertTable(tableName);
      return withFallback(() => getRow(tableName, id), () => fallback.get(tableName, id));
    },

    async create(tableName, row) {
      assertTable(tableName);
      assertRowKey(tableName, row);
      return upsert(tableName, row);
    },

    async update(tableName, id, patch) {
      assertTable(tableName);
      return withFallback(async () => {
        const current = await getRow(tableName, id);
        if (!current) return null;
        return upsert(tableName, { ...current, ...patch, [primaryKey(tableName)]: id });
      }, () => fallback.update(tableName, id, patch));
    },

    async remove(tableName, id) {
      assertTable(tableName);
      return withFallback(async () => {
        const result = await pool.query(
          `DELETE FROM ${STORE_TABLE} WHERE table_name = $1 AND row_id = $2`,
          [tableName, String(id)],
        );
        return result.rowCount > 0;
      }, () => fallback.remove(tableName, id));
    },

    async close() {
      await pool.end();
    },
  };
}

async function initializeStore(pool, seedTables) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${STORE_TABLE} (
      table_name text NOT NULL,
      row_id text NOT NULL,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (table_name, row_id)
    )
  `);

  for (const [tableName, rows] of Object.entries(seedTables || {})) {
    if (!TABLE_SCHEMAS[tableName]) continue;
    for (const row of rows || []) {
      const key = primaryKey(tableName);
      await pool.query(
        `
          INSERT INTO ${STORE_TABLE} (table_name, row_id, data)
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (table_name, row_id) DO NOTHING
        `,
        [tableName, String(row[key]), JSON.stringify(row)],
      );
    }
  }
}

function normalizePgUrl(url) {
  return String(url || '').replace('postgresql+psycopg://', 'postgresql://');
}

function assertTable(tableName) {
  if (!TABLE_SCHEMAS[tableName]) throw new Error(`unknown_table:${tableName}`);
}

function assertRowKey(tableName, row) {
  const key = primaryKey(tableName);
  if (!row || !row[key]) throw new Error(`${tableName}.${key}_required`);
}

function primaryKey(tableName) {
  return TABLE_SCHEMAS[tableName].primary_key;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
