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
    { service_id: 'svc_haircut', name: '上门理发扦脚', category: '生活照料', scene_tags: ['上门服务','个人护理','理发'], target_people: '行动不便老人', price_from: 50, unit: '次', org_type_support: 'homecare', online_booking: true, description: '持证人员上门提供理发、修面、扦脚等个人形象与足部护理。' },
    { service_id: 'svc_errand', name: '代买代办跑腿', category: '生活照料', scene_tags: ['代办','跑腿','上门'], target_people: '居家老人', price_from: 30, unit: '次', org_type_support: 'homecare', online_booking: true, description: '代购日用品、代取药、代缴费、陪同办事等贴心跑腿服务。' },
    { service_id: 'svc_laundry', name: '衣物清洗熨烫', category: '生活照料', scene_tags: ['家政','清洁'], target_people: '居家老人', price_from: 40, unit: '次', org_type_support: 'homecare', online_booking: true, description: '上门收送衣物，提供清洗、消毒与熨烫服务。' },
    { service_id: 'svc_home_modify', name: '适老化改造咨询', category: '生活照料', scene_tags: ['适老化','改造','居家安全'], target_people: '居家老人', price_from: 0, unit: '次', org_type_support: 'homecare', online_booking: false, description: '评估居家环境，提供防滑、扶手、无障碍等适老化改造方案。' },
    { service_id: 'svc_health_visit', name: '上门健康随访', category: '医疗健康', scene_tags: ['健康随访','体检','上门'], target_people: '慢病/高龄老人', price_from: 80, unit: '次', org_type_support: 'nursing_station', online_booking: true, description: '护士上门量血压血糖、用药核对与健康评估随访。' },
    { service_id: 'svc_chronic', name: '慢病管理', category: '医疗健康', scene_tags: ['慢病','健康管理','用药'], target_people: '慢病老人', price_from: 60, unit: '月', org_type_support: 'community', online_booking: true, description: '建立慢病档案，定期随访、用药提醒与生活方式干预。' },
    { service_id: 'svc_tcm', name: '中医理疗', category: '医疗健康', scene_tags: ['中医','理疗','康复'], target_people: '老人', price_from: 100, unit: '次', org_type_support: 'nursing_station', online_booking: true, description: '推拿、艾灸、拔罐等中医适宜技术服务，缓解颈肩腰腿痛。' },
    { service_id: 'svc_daycare', name: '日间照料', category: '机构养老', scene_tags: ['日间照料','托养','社区养老'], target_people: '居家老人', price_from: 80, unit: '天', org_type_support: 'community', online_booking: true, description: '白天托管，含餐饮、午休、康乐活动与安全看护。' },
    { service_id: 'svc_respite', name: '短期托养喘息', category: '机构养老', scene_tags: ['喘息服务','短期托养','家属减负'], target_people: '照护家庭', price_from: 150, unit: '天', org_type_support: 'institution', online_booking: true, description: '为家庭照护者提供短期托养，缓解长期照护压力。' },
    { service_id: 'svc_device', name: '智能养老设备租赁', category: '智慧助老', scene_tags: ['智能设备','手环','紧急呼叫'], target_people: '独居老人', price_from: 30, unit: '月', org_type_support: 'homecare', online_booking: true, description: '提供智能手环、紧急呼叫器、跌倒检测等设备租赁与上门安装。' },
    { service_id: 'svc_remote_care', name: '远程视频看护', category: '智慧助老', scene_tags: ['远程看护','视频','安全'], target_people: '独居老人', price_from: 40, unit: '月', org_type_support: 'homecare', online_booking: true, description: '通过摄像头与AI算法实现远程安全看护与异常行为提醒。' },
    { service_id: 'svc_companion', name: '陪伴聊天心理疏导', category: '精神文化', scene_tags: ['陪伴','心理疏导','聊天'], target_people: '独居/空巢老人', price_from: 60, unit: '次', org_type_support: 'community', online_booking: true, description: '社工陪伴聊天、情绪疏导与认知激活活动，缓解孤独。' },
    { service_id: 'svc_elder_uni', name: '老年大学课程', category: '精神文化', scene_tags: ['老年大学','兴趣','课程'], target_people: '活力老人', price_from: 200, unit: '期', org_type_support: 'community', online_booking: true, description: '书法、声乐、智能手机等兴趣课程，丰富精神文化生活。' },
    { service_id: 'svc_sos', name: '24h紧急呼叫响应', category: '紧急援助', scene_tags: ['紧急呼叫','安全守护','救援'], target_people: '独居/高危老人', price_from: 0, unit: '次', org_type_support: 'homecare', online_booking: true, description: '一键呼叫，7×24小时响应，联动家属、社区与救援力量。' },
  ],
  fs_org: [
    { org_id: 'org_homecare_center', org_name: '青秀社区居家养老服务中心', org_type: 'homecare', address: '南宁市青秀区津头街道', service_scope: '上门护理/助浴/助餐/清洁', bed_count: 0, price_from: 60, rating: 4.7, certified: true },
    { org_id: 'org_guixiaoyang_center', org_name: '桂小养康养中心', org_type: 'institution', address: '南宁市青秀区凤岭片区', service_scope: '机构养老/认知症照护/康复', bed_count: 120, price_from: 2800, rating: 4.8, certified: true },
    { org_id: 'org_qingxiu_nursing', org_name: '青秀护理站', org_type: 'nursing_station', address: '南宁市青秀区', service_scope: '康复训练/上门护理', bed_count: 0, price_from: 100, rating: 4.6, certified: true },
    { org_id: 'org_qingxiu_clinic', org_name: '青秀村医服务点', org_type: 'village_clinic', address: '南宁市青秀区', service_scope: '陪诊/基础医疗', bed_count: 0, price_from: 0, rating: 4.5, certified: true },
    { org_id: 'org_guilin', org_name: '桂林夕阳红养老服务中心', org_type: 'institution', address: '桂林市秀峰区', service_scope: '机构养老/认知症照护/康复', bed_count: 200, price_from: 2800, rating: 4.8, certified: true },
    { org_id: 'org_daycare_nn', org_name: '南宁市长者日间照料中心', org_type: 'community', address: '南宁市兴宁区', service_scope: '日间照料/助餐/陪伴', bed_count: 0, price_from: 80, rating: 4.6, certified: true },
    { org_id: 'org_canteen', org_name: '青秀社区长者食堂', org_type: 'community', address: '南宁市青秀区', service_scope: '助餐/送餐', bed_count: 0, price_from: 12, rating: 4.5, certified: true },
    { org_id: 'org_rehab_hosp', org_name: '广西康复医院医养中心', org_type: 'nursing_station', address: '南宁市良庆区', service_scope: '康复/中医理疗/护理', bed_count: 50, price_from: 150, rating: 4.7, certified: true },
    { org_id: 'org_tech', org_name: '桂颐智养科技公司', org_type: 'homecare', address: '南宁市高新区', service_scope: '智能设备/远程看护', bed_count: 0, price_from: 30, rating: 4.4, certified: true },
    { org_id: 'org_psych', org_name: '南宁暖阳心理服务中心', org_type: 'community', address: '南宁市西乡塘区', service_scope: '陪伴/心理疏导', bed_count: 0, price_from: 60, rating: 4.6, certified: true },
  ],
  fs_worker: [
    { worker_id: 'wk_001', name: '韦芳', skill_tags: ['上门护理','助浴'], cert_level: '高级护理员', service_area: '青秀社区', rating: 4.9, order_count: 132, available: true },
    { worker_id: 'wk_002', name: '黄丽', skill_tags: ['陪诊就医','助餐'], cert_level: '中级护理员', service_area: '凤岭片区', rating: 4.7, order_count: 88, available: true },
    { worker_id: 'wk_003', name: '李强', skill_tags: ['康复','护理'], cert_level: '康复师', service_area: '青秀区', rating: 4.8, order_count: 64, available: false },
    { worker_id: 'wk_004', name: '陈梅', skill_tags: ['居家清洁','助浴'], cert_level: '中级护理员', service_area: '津头街道', rating: 4.6, order_count: 51, available: true },
    { worker_id: 'wk_005', name: '张军', skill_tags: ['认知症'], cert_level: '认知症照护专员', service_area: '桂小养康养中心', rating: 4.9, order_count: 40, available: true },
    { worker_id: 'wk_006', name: '周敏', skill_tags: ['上门服务','理发'], cert_level: '高级护理员', service_area: '青秀社区', rating: 4.8, order_count: 76, available: true },
    { worker_id: 'wk_007', name: '吴勇', skill_tags: ['代办','清洁'], cert_level: '中级护理员', service_area: '凤岭片区', rating: 4.6, order_count: 59, available: true },
    { worker_id: 'wk_008', name: '孙琳', skill_tags: ['健康随访','慢病管理'], cert_level: '执业护士', service_area: '青秀区', rating: 4.9, order_count: 98, available: true },
    { worker_id: 'wk_009', name: '赵刚', skill_tags: ['中医','理疗','康复'], cert_level: '康复师', service_area: '良庆区', rating: 4.7, order_count: 45, available: false },
    { worker_id: 'wk_010', name: '刘洋', skill_tags: ['日间照料','陪伴聊天'], cert_level: '社工', service_area: '兴宁区', rating: 4.8, order_count: 33, available: true },
    { worker_id: 'wk_011', name: '郑爽', skill_tags: ['智能设备','远程看护'], cert_level: '智慧助老专员', service_area: '高新区', rating: 4.7, order_count: 22, available: true },
    { worker_id: 'wk_012', name: '何静', skill_tags: ['心理疏导','陪伴聊天'], cert_level: '心理咨询师', service_area: '西乡塘区', rating: 4.9, order_count: 18, available: true },
    { worker_id: 'wk_013', name: '马涛', skill_tags: ['适老化'], cert_level: '适老化评估师', service_area: '青秀区', rating: 4.6, order_count: 12, available: false },
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
