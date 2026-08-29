import pg from 'pg';

const { Pool } = pg;

export class PgTagReader {
  constructor({ pgUrl = process.env.FLATTALK_TAG_SYSTEM_PG_URL || process.env.FLATTALK_PG_URL || '', poolSize = 5 } = {}) {
    this.pgUrl = String(pgUrl || '').replace('postgresql+psycopg://', 'postgresql://');
    this.pool = this.pgUrl ? new Pool({
      connectionString: this.pgUrl,
      max: poolSize,
      connectionTimeoutMillis: Number(process.env.FLATTALK_PG_CONNECT_TIMEOUT_MS || 5000),
      idleTimeoutMillis: Number(process.env.FLATTALK_PG_IDLE_TIMEOUT_MS || 30000),
    }) : null;
  }

  isConfigured() {
    return Boolean(this.pool);
  }

  async getEntityProfile(entityId, { entityType = 'ELDER' } = {}) {
    if (!entityId) return { ok: false, source_status: 'invalid_input', error: 'entityId is required' };
    if (!this.pool) return { ok: false, source_status: 'unconfigured', error: 'tag_system_pg_not_configured' };

    try {
      const result = await this.pool.query(
        `
          SELECT er.*,
                 COALESCE(json_agg(et.*) FILTER (WHERE et.id IS NOT NULL), '[]') AS tags
          FROM entity_record er
          LEFT JOIN entity_tag et
            ON et.entity_type = er.entity_type
           AND et.entity_id = er.entity_id
           AND et.status = 'ACTIVE'
          WHERE er.entity_id = $1
            AND ($2::text = '' OR er.entity_type = $2)
          GROUP BY er.id
          LIMIT 1
        `,
        [String(entityId), entityType || ''],
      );
      return { ok: true, source_status: 'real_pg', data: result.rows[0] || null };
    } catch (error) {
      return { ok: false, source_status: 'pg_error', error: error.message, code: error.code || 'TAG_SYSTEM_PG_ERROR' };
    }
  }

  async listEntityTags(entityId, { entityType = 'ELDER', limit = 50 } = {}) {
    if (!entityId) return { ok: false, source_status: 'invalid_input', error: 'entityId is required' };
    if (!this.pool) return { ok: false, source_status: 'unconfigured', error: 'tag_system_pg_not_configured' };
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));

    try {
      const result = await this.pool.query(
        `
          SELECT et.*, td.tag_name, td.tag_category, td.tag_category_name, td.value_type
          FROM entity_tag et
          LEFT JOIN tag_definition td ON td.tag_code = et.tag_code
          WHERE et.entity_id = $1
            AND et.status = 'ACTIVE'
            AND ($2::text = '' OR et.entity_type = $2)
          ORDER BY et.updated_at DESC
          LIMIT $3
        `,
        [String(entityId), entityType || '', safeLimit],
      );
      return { ok: true, source_status: 'real_pg', data: result.rows };
    } catch (error) {
      return { ok: false, source_status: 'pg_error', error: error.message, code: error.code || 'TAG_SYSTEM_PG_ERROR' };
    }
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}
