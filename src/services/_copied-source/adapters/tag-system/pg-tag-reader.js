import pg from "pg";

const { Pool } = pg;

const DEFAULT_POOL_SIZE = 5;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_TAG_LIMIT = 50;
const DEFAULT_AUDIT_LIMIT = 50;
const MAX_LIMIT = 200;
const PROFILE_SUMMARY_MAX_LENGTH = 500;

export class PgTagReader {
  constructor({ pgUrl = null, poolSize = DEFAULT_POOL_SIZE, logger = null } = {}) {
    this.logger = logger;
    this.pgUrl =
      pgUrl || process.env.GXY_TAG_SYSTEM_PG_URL || process.env.TAG_SYSTEM_PG_URL || "";
    this.poolSize = Math.max(1, Number(poolSize) || DEFAULT_POOL_SIZE);
    this._pool = null;
    if (this.pgUrl) {
      this._ensurePool();
    }
  }

  isConfigured() {
    return Boolean(this.pgUrl);
  }

  _ensurePool() {
    if (this._pool) return this._pool;
    if (!this.pgUrl) {
      const err = new Error("Tag system PG url is not configured");
      err.code = "TAG_SYSTEM_PG_UNCONFIGURED";
      throw err;
    }
    this._pool = new Pool({
      connectionString: this.pgUrl,
      max: this.poolSize,
      idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MS,
    });
    return this._pool;
  }

  _log(level, message, extra = {}) {
    if (this.logger && typeof this.logger[level] === "function") {
      this.logger[level](message, extra);
    }
  }

  _unavailable(err) {
    return {
      ok: false,
      source_status: "unavailable",
      error: err.message,
      code: err.code || "TAG_SYSTEM_PG_ERROR",
    };
  }

  _invalidInput(message) {
    return {
      ok: false,
      source_status: "invalid_input",
      error: message,
    };
  }

  async _query(sql, params = []) {
    try {
      const result = await this._ensurePool().query(sql, params);
      return { ok: true, source_status: "real_data", data: result.rows };
    } catch (err) {
      this._log("error", "PgTagReader query failed", {
        error: err.message,
        code: err.code,
      });
      return this._unavailable(err);
    }
  }

  async getEntityProfile(entityId) {
    if (!entityId) return this._invalidInput("entityId is required");
    const result = await this._query(
      `
        SELECT er.*,
               COALESCE(json_agg(et.*) FILTER (WHERE et.id IS NOT NULL), '[]') AS tags
        FROM entity_record er
        LEFT JOIN entity_tag et
          ON et.entity_type = er.entity_type
         AND et.entity_id = er.entity_id
         AND et.status = 'ACTIVE'
        WHERE er.entity_id = $1
        GROUP BY er.id
        LIMIT 1
      `,
      [String(entityId)],
    );
    return result.ok ? { ...result, data: result.data[0] || null } : result;
  }

  async listEntityTags(entityId, limit = DEFAULT_TAG_LIMIT) {
    if (!entityId) return this._invalidInput("entityId is required");
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_TAG_LIMIT));
    return this._query(
      `
        SELECT et.*, td.tag_name, td.tag_category, td.tag_category_name, td.value_type
        FROM entity_tag et
        LEFT JOIN tag_definition td ON td.tag_code = et.tag_code
        WHERE et.entity_id = $1 AND et.status = 'ACTIVE'
        ORDER BY et.updated_at DESC
        LIMIT $2
      `,
      [String(entityId), safeLimit],
    );
  }

  async searchEntities({ keyword = null, tagFilters = [], page = 1, pageSize = 20 } = {}) {
    const clauses = ["er.status = 'ACTIVE'"];
    const params = [];

    if (keyword) {
      params.push(`%${keyword}%`);
      clauses.push(`er.entity_name ILIKE $${params.length}`);
    }

    for (const tag of tagFilters) {
      const tagCode = tag?.tag_code || tag?.tagCode;
      if (!tagCode) continue;
      const tagValue = tag?.tag_value || tag?.tagValue || "TRUE";
      params.push(String(tagCode), String(tagValue));
      clauses.push(`
        EXISTS (
          SELECT 1 FROM entity_tag et
          WHERE et.entity_type = er.entity_type
            AND et.entity_id = er.entity_id
            AND et.tag_code = $${params.length - 1}
            AND et.tag_value = $${params.length}
            AND et.status = 'ACTIVE'
        )
      `);
    }

    const safePageSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
    const safePage = Math.max(1, Number(page) || 1);
    const offset = (safePage - 1) * safePageSize;
    params.push(safePageSize, offset);

    return this._query(
      `
        SELECT er.*
        FROM entity_record er
        WHERE ${clauses.join(" AND ")}
        ORDER BY er.updated_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
  }

  async listTagAuditHistory(entityId, limit = DEFAULT_AUDIT_LIMIT) {
    if (!entityId) return this._invalidInput("entityId is required");
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_AUDIT_LIMIT));
    return this._query(
      `
        SELECT *
        FROM tag_audit_log
        WHERE resource_type = 'entity_tag'
          AND (
            "after"->>'entity_id' = $1
            OR "before"->>'entity_id' = $1
          )
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [String(entityId), safeLimit],
    );
  }

  async getProfileSummary(userId) {
    if (!userId) return this._invalidInput("userId is required");

    const tagsResult = await this._query(
      `
        SELECT et.tag_code, et.tag_value, et.confidence,
               td.tag_name, td.tag_category, td.tag_category_name
        FROM entity_tag et
        LEFT JOIN tag_definition td ON td.tag_code = et.tag_code
        WHERE et.entity_type = 'user'
          AND et.entity_id = $1
          AND et.status = 'ACTIVE'
        ORDER BY td.tag_category, et.updated_at DESC
      `,
      [String(userId)],
    );
    if (!tagsResult.ok) return tagsResult;

    const tags = tagsResult.data || [];
    let riskLevel = null;
    const focusAreas = new Set();
    const tagSummaries = [];

    for (const tag of tags) {
      const category = tag.tag_category || tag.tag_category_name || "";
      const code = tag.tag_code || "";
      const value = tag.tag_value || "";
      const name = tag.tag_name || code;

      if (/risk|风险/i.test(category) || /risk|风险/i.test(code)) {
        if (!riskLevel) riskLevel = value || name;
        continue;
      }
      if (category) focusAreas.add(category);
      tagSummaries.push(`${name}:${value}`);
    }

    const parts = [];
    parts.push(`用户 ${userId}`);
    if (riskLevel) parts.push(`风险等级=${riskLevel}`);
    if (focusAreas.size > 0) {
      parts.push(`关注领域=[${Array.from(focusAreas).join(",")}]`);
    }
    parts.push(tagSummaries.length > 0 ? `标签=[${tagSummaries.join(",")}]` : "标签=无");

    let summary = parts.join("; ");
    if (summary.length > PROFILE_SUMMARY_MAX_LENGTH) {
      summary = summary.slice(0, PROFILE_SUMMARY_MAX_LENGTH - 3) + "...";
    }

    return {
      ok: true,
      source_status: "real_data",
      data: {
        user_id: String(userId),
        summary,
        tags_count: tags.length,
        risk_level: riskLevel,
        focus_areas: Array.from(focusAreas),
      },
    };
  }

  async close() {
    if (!this._pool) return;
    try {
      await this._pool.end();
    } catch (err) {
      this._log("error", "PgTagReader pool end failed", { error: err.message });
    } finally {
      this._pool = null;
    }
  }
}
