import { TABLE_SCHEMAS } from './schemas.js';
import { createPgTableDataRepository } from './repository-pg.js';

const DEFAULT_TABLES = Object.freeze({
  elder_profile: [
    { elder_id: 'demo_elder_1', age: 72, conditions: ['糖尿病'], preferences: ['清淡', '软烂'] },
  ],
  meal_rules: [
    { key: 'diabetes', text: '控糖饮食应控制精制碳水和含糖饮品。' },
    { key: 'hypertension', text: '高血压饮食应减少钠盐摄入，避免腌制食品。' },
  ],
  diet_contraindications: [
    { key: 'high_sugar', text: '避免甜豆浆、糖水、糕点和高糖水果。' },
    { key: 'high_salt', text: '避免咸菜、腊肉、浓汤和高盐调味品。' },
  ],
  gxy_travel_route_plan: [
    {
      uid: 'travel_route_demo_1',
      route_id: 'route_bama_winter_3d',
      destination: '广西巴马',
      season: '秋冬适宜',
      budget_level: '舒适型',
      health_tags: '慢病友好,低强度,医疗可达',
      booking_status: '可咨询余量',
    },
    {
      uid: 'travel_route_demo_2',
      route_id: 'route_beihai_warm_4d',
      destination: '广西北海',
      season: '冬季温暖',
      budget_level: '经济型',
      health_tags: '海滨慢行,家属陪同,交通便利',
      booking_status: '需人工确认',
    },
  ],
  model_configs: [
    { config_id: 'mock_default', provider: 'mock', model_id: 'mock', is_active: true, is_default: true },
  ],
  skill_configs: [
    { skill_key: 'meal_plan', enabled: true, default_template: 'diet_card', scene_thresholds: { accept: 0.62, review: 0.45 } },
    { skill_key: 'travel_route', enabled: true, default_template: 'sojourn_route', scene_thresholds: { accept: 0.62, review: 0.45 } },
    { skill_key: 'health_risk_warning', enabled: true, default_template: 'health_warning_card', scene_thresholds: { accept: 0.62, review: 0.45 } },
    { skill_key: 'find_service', enabled: true, default_template: 'service_recommend', scene_thresholds: { accept: 0.6, review: 0.42 } },
    { skill_key: 'dispatch_manage', enabled: true, default_template: 'dispatch_list', scene_thresholds: { accept: 0.6, review: 0.42 } },
  ],
  health_risk_warning_business: [
    {
      id: 'hrw_biz_b',
      package_key: 'health_risk_warning',
      business_scene: '健康风险预警师',
      terminal: 'B',
      role: 'care_worker',
      status: 'enabled',
      sample_payload: '{"level":"关注","signals":["血压","心率"],"rules":["血压持续偏高"]}',
    },
    {
      id: 'hrw_biz_g',
      package_key: 'health_risk_warning',
      business_scene: '健康风险预警师',
      terminal: 'G',
      role: 'village_doctor',
      status: 'enabled',
      sample_payload: '{"level":"关注","signals":["血压","血糖"],"rules":["血压持续偏高","血糖波动"]}',
    },
    {
      id: 'hrw_biz_admin',
      package_key: 'health_risk_warning',
      business_scene: '健康风险预警师',
      terminal: 'Admin',
      role: 'admin',
      status: 'enabled',
      sample_payload: '{"level":"紧急","signals":["血压","血糖","跌倒"],"rules":["血压持续偏高","跌倒高风险"]}',
    },
  ],
  interface_configs: [
    { interface_key: 'remote_knowledge', type: 'knowledge_base', base_url: '', enabled: false },
  ],
  conversation_turns: [],
});

export function createTableDataRepository({ seedTables = DEFAULT_TABLES, pgUrl: configuredPgUrl } = {}) {
  const pgUrl = configuredPgUrl !== undefined
    ? configuredPgUrl
    : process.env.FLATTALK_PG_URL || process.env.FLATTALK_TAG_SYSTEM_PG_URL || process.env.TAG_SYSTEM_PG_URL || '';
  if (pgUrl) {
    return createPgTableDataRepository({ pgUrl, seedTables, fallback: createMemoryTableDataRepository({ seedTables }) });
  }
  return createMemoryTableDataRepository({ seedTables });
}

export function createMemoryTableDataRepository({ seedTables = DEFAULT_TABLES } = {}) {
  const memoryTables = cloneTables(seedTables);

  return {
    source: 'memory',

    async list(tableName) {
      assertTable(tableName);
      return deepClone(memoryTables[tableName] || []);
    },

    async get(tableName, id) {
      assertTable(tableName);
      const key = TABLE_SCHEMAS[tableName].primary_key;
      const row = (memoryTables[tableName] || []).find((item) => item[key] === id);
      return row ? deepClone(row) : null;
    },

    async create(tableName, row) {
      assertTable(tableName);
      assertRowKey(tableName, row);
      const nextRow = deepClone(row);
      memoryTables[tableName].push(nextRow);
      return deepClone(nextRow);
    },

    async update(tableName, id, patch) {
      assertTable(tableName);
      const key = TABLE_SCHEMAS[tableName].primary_key;
      const rows = memoryTables[tableName];
      const index = rows.findIndex((row) => row[key] === id);
      if (index < 0) return null;
      rows[index] = deepClone({ ...rows[index], ...patch, [key]: id });
      return deepClone(rows[index]);
    },

    async remove(tableName, id) {
      assertTable(tableName);
      const key = TABLE_SCHEMAS[tableName].primary_key;
      const rows = memoryTables[tableName];
      const index = rows.findIndex((row) => row[key] === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

function assertTable(tableName) {
  if (!TABLE_SCHEMAS[tableName]) throw new Error(`unknown_table:${tableName}`);
}

function assertRowKey(tableName, row) {
  const key = TABLE_SCHEMAS[tableName].primary_key;
  if (!row || !row[key]) throw new Error(`${tableName}.${key}_required`);
}

function cloneTables(tables) {
  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, deepClone(rows)]),
  );
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
