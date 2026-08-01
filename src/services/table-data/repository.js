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
    { skill_key: 'travel_route', enabled: true, default_template: 'route_card', scene_thresholds: { accept: 0.62, review: 0.45 } },
    { skill_key: 'health_risk_warning', enabled: true, default_template: 'health_warning_card', scene_thresholds: { accept: 0.62, review: 0.45 } },
    { skill_key: 'find_service', enabled: true, default_template: 'service_recommend', scene_thresholds: { accept: 0.6, review: 0.42 } },
    { skill_key: 'dispatch_manage', enabled: true, default_template: 'dispatch_list', scene_thresholds: { accept: 0.6, review: 0.42 } },
  ],

  // find_service 业务种子数据
  fs_service_catalog: [
    { service_id: 'svc_home_nursing', name: '上门护理', category: '生活照料', scene_tags: ['居家养老','上门服务','护理'], target_people: '失能/半失能老人', price_from: 80, unit: '次', org_type_support: 'homecare', online_booking: true, description: '由持证护理员上门提供翻身、助浴、生命体征监测等基础护理。' },
    { service_id: 'svc_bath', name: '助浴服务', category: '生活照料', scene_tags: ['居家养老','上门服务','助浴'], target_people: '行动不便老人', price_from: 120, unit: '次', org_type_support: 'homecare', online_booking: true, description: '专业助浴设备与人员上门，保障洗浴安全与舒适。' },
    { service_id: 'svc_escort', name: '陪诊就医', category: '医疗健康', scene_tags: ['陪诊','就医','医疗'], target_people: '独居/高龄老人', price_from: 150, unit: '半天', org_type_support: 'homecare', online_booking: true, description: '陪同就医、取药、报告解读与就医流程协助。' },
    { service_id: 'svc_meal', name: '助餐送餐', category: '生活照料', scene_tags: ['助餐','送餐','社区养老'], target_people: '居家老人', price_from: 12, unit: '餐', org_type_support: 'community', online_booking: true, description: '社区长者食堂助餐或上门送餐，支持低盐低糖定制。' },
    { service_id: 'svc_clean', name: '居家清洁', category: '生活照料', scene_tags: ['居家养老','家政','清洁'], target_people: '居家老人', price_from: 60, unit: '次', org_type_support: 'homecare', online_booking: true, description: '适老化居家清洁与安全隐患排查。' },
    { service_id: 'svc_nursing_home', name: '机构养老床位', category: '机构养老', scene_tags: ['机构养老','养老院','床位'], target_people: '需长期照护老人', price_from: 2800, unit: '月', org_type_support: 'institution', online_booking: false, description: '养老机构长期照护床位，含生活照料与基础医疗。' },
    { service_id: 'svc_rehab', name: '康复训练', category: '医疗健康', scene_tags: ['康复','训练','医疗'], target_people: '术后/慢病老人', price_from: 100, unit: '次', org_type_support: 'nursing_station', online_booking: true, description: '由康复师指导的肢体功能与平衡训练。' },
    { service_id: 'svc_dementia', name: '认知症照护', category: '机构养老', scene_tags: ['认知症','机构养老','专护'], target_people: '认知症老人', price_from: 4200, unit: '月', org_type_support: 'institution', online_booking: false, description: '认知症专区专业照护，含非药物干预活动。' },
  ],
  fs_org: [
    { org_id: 'org_homecare_center', org_name: '青秀社区居家养老服务中心', org_type: 'homecare', address: '南宁市青秀区津头街道', service_scope: '上门护理/助浴/助餐/清洁', bed_count: 0, price_from: 60, rating: 4.7, certified: true },
    { org_id: 'org_guixiaoyang_center', org_name: '桂小养康养中心', org_type: 'institution', address: '南宁市青秀区凤岭片区', service_scope: '机构养老/认知症照护/康复', bed_count: 120, price_from: 2800, rating: 4.8, certified: true },
    { org_id: 'org_qingxiu_nursing', org_name: '青秀护理站', org_type: 'nursing_station', address: '南宁市青秀区', service_scope: '康复训练/上门护理', bed_count: 0, price_from: 100, rating: 4.6, certified: true },
    { org_id: 'org_qingxiu_clinic', org_name: '青秀村医服务点', org_type: 'village_clinic', address: '南宁市青秀区', service_scope: '陪诊/基础医疗', bed_count: 0, price_from: 0, rating: 4.5, certified: true },
  ],
  fs_worker: [
    { worker_id: 'wk_001', name: '韦芳', skill_tags: ['上门护理','助浴'], cert_level: '高级护理员', service_area: '青秀社区', rating: 4.9, order_count: 132, available: true },
    { worker_id: 'wk_002', name: '黄丽', skill_tags: ['陪诊就医','助餐'], cert_level: '中级护理员', service_area: '凤岭片区', rating: 4.7, order_count: 88, available: true },
    { worker_id: 'wk_003', name: '李强', skill_tags: ['康复训练','上门护理'], cert_level: '康复师', service_area: '青秀区', rating: 4.8, order_count: 64, available: false },
    { worker_id: 'wk_004', name: '陈梅', skill_tags: ['居家清洁','助浴'], cert_level: '中级护理员', service_area: '津头街道', rating: 4.6, order_count: 51, available: true },
    { worker_id: 'wk_005', name: '张军', skill_tags: ['认知症照护'], cert_level: '认知症照护专员', service_area: '桂小养康养中心', rating: 4.9, order_count: 40, available: true },
  ],
  fs_service_order: [
    { order_id: 'so_1001', elder_name: '黄秀英', service_id: 'svc_home_nursing', service_name: '上门护理', org_id: 'org_homecare_center', status: '待派单', created_at: '2026-07-30T09:10:00+08:00', expected_time: '2026-07-31 10:00' },
    { order_id: 'so_1002', elder_name: '李德明', service_id: 'svc_escort', service_name: '陪诊就医', org_id: 'org_qingxiu_clinic', status: '已派单', created_at: '2026-07-30T08:40:00+08:00', expected_time: '2026-07-30 14:30' },
    { order_id: 'so_1003', elder_name: '韦桂兰', service_id: 'svc_rehab', service_name: '康复训练', org_id: 'org_qingxiu_nursing', status: '已完成', created_at: '2026-07-28T10:00:00+08:00', expected_time: '2026-07-28 15:00' },
  ],

  // dispatch_manage 业务种子数据
  dm_dispatch_order: [
    { dispatch_id: 'dp_2001', order_id: 'so_1001', worker_id: 'wk_001', worker_name: '韦芳', skill_tag: '上门护理', status: '待接单', created_at: '2026-07-30T09:12:00+08:00', accepted_at: '', rejected_reason: '' },
    { dispatch_id: 'dp_2002', order_id: 'so_1002', worker_id: 'wk_002', worker_name: '黄丽', skill_tag: '陪诊就医', status: '已接单', created_at: '2026-07-30T08:42:00+08:00', accepted_at: '2026-07-30T08:50:00+08:00', rejected_reason: '' },
    { dispatch_id: 'dp_2003', order_id: 'so_1003', worker_id: 'wk_003', worker_name: '李强', skill_tag: '康复训练', status: '已拒单', created_at: '2026-07-27T10:00:00+08:00', accepted_at: '', rejected_reason: '当天已有排班，时间冲突' },
    { dispatch_id: 'dp_2004', order_id: 'so_1004', worker_id: 'wk_004', worker_name: '陈梅', skill_tag: '居家清洁', status: '待接单', created_at: '2026-07-30T09:30:00+08:00', accepted_at: '', rejected_reason: '' },
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
