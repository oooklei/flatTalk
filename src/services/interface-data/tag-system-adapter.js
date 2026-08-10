import { HttpClient } from './http-client.js';
import { PgTagReader } from './pg-tag-reader.js';

export function createTagSystemAdapter(options = {}) {
  const baseUrl = options.baseUrl || process.env.FLATTALK_TAG_SYSTEM_BASE_URL || 'http://10.21.202.9:8010';
  const token = options.token || process.env.FLATTALK_TAG_SYSTEM_TOKEN || process.env.TAG_SYSTEM_SSO_TOKEN || '';
  const profileByEntity = options.profileByEntity || null;
  const pgReader = options.pgReader ?? new PgTagReader({ pgUrl: options.pgUrl });
  const httpClient = options.httpClient ?? new HttpClient({
    baseUrl,
    defaultHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  return {
    isConfigured() {
      return pgReader.isConfigured() || httpClient.isConfigured();
    },

    async health() {
      if (!httpClient.isConfigured()) return { ok: false, source_status: 'unconfigured' };
      return httpClient.get('/api/v1/health');
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
      const pgProfile = await pgReader.getEntityProfile(entityId, { entityType });
      if (pgProfile.ok && pgProfile.data) return pgProfile;

      if (!httpClient.isConfigured()) return pgProfile;
      const remote = await httpClient.get(`/api/v1/tags/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/profile`);
      return {
        ok: remote.ok,
        source_status: remote.ok ? 'real_api' : 'api_error',
        data: remote.data,
        error: remote.error || remote.data?.message,
        http_status: remote.status,
        pg_status: pgProfile.source_status,
      };
    },

    async listEntityTags(entityId, options = {}) {
      return pgReader.listEntityTags(entityId, options);
    },
  };
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
