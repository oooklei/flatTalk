/**
 * Known data-access endpoints for runtime span enrichment.
 * Keys match tracer span `name` (or meta.endpoint_key).
 */

const GXY_API = process.env.GXY_API_URL || process.env.ORDER_API_URL || 'https://aiyl-m.yunxida.com/backend-api/portal-api';
const TAG_HTTP = process.env.FLATTALK_TAG_SYSTEM_BASE_URL || 'http://127.0.0.1:8010';
const TAG_PG = 'tag_system(PG)';

/** @type {Record<string, { method?: string, url?: string, sql?: string, tables?: string[], store?: string }>} */
export const DATA_ACCESS_ENDPOINTS = {
  // DB / local table aggregates
  'elder_profile+meal_rules+diet_contraindications': {
    store: 'table_data',
    tables: ['elder_profile', 'meal_rules', 'diet_contraindications'],
    sql: 'SELECT … FROM elder_profile / meal_rules / diet_contraindications',
  },
  gxy_travel_route_plan: {
    store: 'table_data',
    tables: ['gxy_travel_route_plan'],
    sql: 'SELECT … FROM gxy_travel_route_plan',
  },
  health_risk_warning_business: {
    store: 'table_data',
    tables: ['health_risk_warning_business'],
    sql: 'SELECT … FROM health_risk_warning_business',
  },
  'fs_catalog+org+worker+order': {
    store: 'table_data',
    tables: ['fs_service_catalog', 'fs_org', 'fs_worker', 'fs_service_order'],
    sql: 'SELECT … FROM fs_service_catalog / fs_org / fs_worker / fs_service_order',
  },
  dm_dispatch_order: {
    store: 'table_data',
    tables: ['dm_dispatch_order'],
    sql: 'SELECT … FROM dm_dispatch_order',
  },

  // GXY openapi (orders / workorders)
  listServiceOrders: {
    method: 'POST',
    url: `${GXY_API}/openapi/order/page`,
    store: 'gxy_openapi',
  },
  getServiceOrder: {
    method: 'GET',
    url: `${GXY_API}/openapi/order/detail`,
    store: 'gxy_openapi',
  },
  listWorkOrders: {
    method: 'POST',
    url: `${GXY_API}/openapi/workorder/page`,
    store: 'gxy_openapi',
  },
  getWorkOrder: {
    method: 'GET',
    url: `${GXY_API}/openapi/workorder/detail`,
    store: 'gxy_openapi',
  },

  // tag-system PG business reads
  getEvaluationRecords: {
    method: 'SQL',
    url: TAG_PG,
    sql: 'SELECT … FROM evaluation / service_evaluation (tag_system)',
    tables: ['evaluation'],
    store: 'tag_system_pg',
  },
  getFeedbackMetrics: {
    method: 'SQL',
    url: TAG_PG,
    sql: 'SELECT … FROM feedback (tag_system) → metrics aggregate',
    tables: ['feedback'],
    store: 'tag_system_pg',
  },
  listFeedback: {
    method: 'SQL',
    url: TAG_PG,
    sql: 'SELECT … FROM feedback',
    tables: ['feedback'],
    store: 'tag_system_pg',
  },

  // HTTP third-party
  'jintiaodong.buildRouteProductContext': {
    method: 'HTTP',
    url: 'jintiaodong://buildRouteProductContext',
    store: 'jintiaodong',
  },
  'yunzhen365.buildRiskRemoteContext': {
    method: 'HTTP',
    url: 'yunzhen365://buildRiskRemoteContext',
    store: 'yunzhen365',
  },
  'tencent_map.searchPoisForCity': {
    method: 'GET',
    url: 'https://apis.map.qq.com/ws/place/v1/search',
    store: 'tencent_map',
  },
  'nearbyEnrich(tencent_map+tavily)': {
    method: 'HTTP',
    url: 'tencent_map+tavily://nearbyEnrich',
    store: 'tencent_map',
  },

  // tag HTTP profile (if used)
  getEntityProfile: {
    method: 'GET',
    url: `${TAG_HTTP}/api/v1/tags/entities/{type}/{id}/profile`,
    store: 'tag_system_http',
  },
};

/**
 * @param {string} name
 * @param {object} [meta]
 */
export function resolveEndpoint(name, meta = {}) {
  const key = meta.endpoint_key || name;
  const known = DATA_ACCESS_ENDPOINTS[key] || {};
  return {
    method: meta.method || known.method || undefined,
    url: meta.url || known.url || undefined,
    sql: meta.sql || known.sql || undefined,
    tables: meta.tables || known.tables || undefined,
    store: meta.store || known.store || undefined,
  };
}
