import { HttpClient } from './http-client.js';
import { PgTagReader } from './pg-tag-reader.js';

/**
 * Tag-System HTTP 适配器（文档：D:/GuiCare/Tag-System/docs/标签系统API接口文档.md）
 * 认证：请求头 X-API-Key: tk_live_...
 */
export function createTagSystemAdapter(options = {}) {
  const baseUrl = options.baseUrl
    || process.env.FLATTALK_TAG_SYSTEM_BASE_URL
    || 'http://127.0.0.1:8010';
  const apiKey = options.apiKey
    || options.token
    || process.env.FLATTALK_TAG_SYSTEM_API_KEY
    || process.env.FLATTALK_TAG_SYSTEM_TOKEN
    || process.env.TAG_SYSTEM_CLIENT_KEY
    || process.env.TAG_SYSTEM_SSO_TOKEN
    || '';
  const profileByEntity = options.profileByEntity || null;
  const preferHttp = options.preferHttp
    ?? String(process.env.FLATTALK_TAG_PREFER_HTTP || '1').trim() !== '0';
  const pgReader = options.pgReader ?? new PgTagReader({ pgUrl: options.pgUrl });
  const httpClient = options.httpClient ?? new HttpClient({
    baseUrl,
    defaultHeaders: apiKey ? { 'X-API-Key': apiKey } : {},
  });

  return {
    isConfigured() {
      return Boolean(apiKey && httpClient.isConfigured()) || pgReader.isConfigured();
    },

    hasApiKey() {
      return Boolean(apiKey);
    },

    async health() {
      if (!httpClient.isConfigured()) return { ok: false, source_status: 'unconfigured' };
      return httpClient.get('/api/v1/health');
    },

    /** GET /api/v1/tags/definitions */
    async listTagDefinitions({ status = 'ACTIVE' } = {}) {
      const q = status ? `?status=${encodeURIComponent(status)}` : '';
      return httpClient.get(`/api/v1/tags/definitions${q}`);
    },

    /** GET /api/v1/tags/definitions/{tag_code} */
    async getTagDefinition(tagCode) {
      return httpClient.get(`/api/v1/tags/definitions/${encodeURIComponent(tagCode)}`);
    },

    /** GET /api/v1/entities/{entity_type}/{entity_id} */
    async getEntity(entityType, entityId) {
      return httpClient.get(
        `/api/v1/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
      );
    },

    /** GET /api/v1/entities/by-id/{entity_id} */
    async getEntityById(entityId) {
      return httpClient.get(`/api/v1/entities/by-id/${encodeURIComponent(entityId)}`);
    },

    /** GET /api/v1/entities/by-id/{entity_id}/full */
    async getEntityFull(entityId, { includeInactive = false } = {}) {
      const q = includeInactive ? '?include_inactive=true' : '';
      return httpClient.get(`/api/v1/entities/by-id/${encodeURIComponent(entityId)}/full${q}`);
    },

    /** GET /api/v1/entities/by-id/{entity_id}/check */
    async checkEntityTag(entityId, { tagCode, expect } = {}) {
      const params = new URLSearchParams();
      if (tagCode) params.set('tag_code', tagCode);
      if (expect != null && expect !== '') params.set('expect', String(expect));
      const q = params.toString() ? `?${params}` : '';
      return httpClient.get(`/api/v1/entities/by-id/${encodeURIComponent(entityId)}/check${q}`);
    },

    async getEntityProfile(entityId, options = {}) {
      if (profileByEntity) {
        return {
          ok: true,
          source_status: 'mock',
          data: deepClone(profileByEntity[entityId] || { entity_id: entityId, tags: [], summary: '' }),
        };
      }
      const entityType = options.entity_type || options.entityType || 'ELDER';

      if (preferHttp && httpClient.isConfigured() && apiKey) {
        // 优先完整信息（含 tags）
        const full = await this.getEntityFull(entityId);
        if (full.ok && full.data) {
          const entity = full.data.entity || full.data;
          const tags = full.data.tags || entity.tags || [];
          return {
            ok: true,
            source_status: 'real_api',
            data: {
              ...entity,
              entity_id: entity.entity_id || entityId,
              entity_type: entity.entity_type || entityType,
              tags,
            },
            http_status: full.status,
          };
        }
        const byType = await this.getEntity(entityType, entityId);
        if (byType.ok && byType.data) {
          return {
            ok: true,
            source_status: 'real_api',
            data: byType.data,
            http_status: byType.status,
          };
        }
      }

      const pgProfile = await pgReader.getEntityProfile(entityId, { entityType });
      if (pgProfile.ok && pgProfile.data) return pgProfile;

      return {
        ok: false,
        source_status: 'api_error',
        error: 'entity_profile_unavailable',
        pg_status: pgProfile.source_status,
      };
    },

    async listEntityTags(entityId, options = {}) {
      const entityType = options.entity_type || options.entityType || 'ELDER';
      if (preferHttp && httpClient.isConfigured() && apiKey) {
        const remote = await httpClient.get(
          `/api/v1/tags/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/tags`,
        );
        if (remote.ok) {
          return {
            ok: true,
            source_status: 'real_api',
            data: Array.isArray(remote.data) ? remote.data : (remote.data?.items || remote.data?.tags || []),
            http_status: remote.status,
          };
        }
      }
      return pgReader.listEntityTags(entityId, options);
    },
  };
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
