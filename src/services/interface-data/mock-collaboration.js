const now = "2026-07-14T10:00:00+08:00";

export const mockOrganizations = [
  { org_id: "org_gx_mca", org_name: "广西壮族自治区民政厅", org_type: "civil_affairs", parent_id: "" },
  { org_id: "org_nanning_mca", org_name: "南宁市民政局", org_type: "civil_affairs", parent_id: "org_gx_mca" },
  { org_id: "org_qingxiu_mca", org_name: "南宁市青秀区民政局", org_type: "civil_affairs", parent_id: "org_nanning_mca" },
  { org_id: "org_jintou_street", org_name: "津头街道办事处", org_type: "street", parent_id: "org_qingxiu_mca" },
  { org_id: "org_qingxiu_community", org_name: "青秀社区", org_type: "community", parent_id: "org_jintou_street" },
  { org_id: "org_guixiaoyang_center", org_name: "桂小养康养中心", org_type: "institution", parent_id: "org_qingxiu_community" },
  { org_id: "org_homecare_center", org_name: "青秀社区居家养老服务中心", org_type: "homecare", parent_id: "org_qingxiu_community" },
  { org_id: "org_qingxiu_nursing", org_name: "青秀护理站", org_type: "nursing_station", parent_id: "org_homecare_center" },
  { org_id: "org_qingxiu_clinic", org_name: "青秀村医服务点", org_type: "village_clinic", parent_id: "org_qingxiu_community" },
  { org_id: "org_provider_1", org_name: "广西康养服务商", org_type: "provider", parent_id: "" },
  { org_id: "org_guangxi_mca", org_name: "广西民政厅", org_type: "civil_affairs", parent_id: "" },
  { org_id: "org_platform", org_name: "桂小养平台运营中心", org_type: "platform", parent_id: "" }
];

export const mockElders = [
  {
    elder_id: "elder_huang_xiuying",
    elder_name: "黄秀英",
    age: 82,
    gender: "女",
    community_id: "org_qingxiu_community",
    community_name: "青秀社区",
    address_label: "南宁市青秀区津头街道",
    care_level: "高龄老人",
    ability_status: "尚未评估"
  },
  {
    elder_id: "elder_huang_xiuying_2",
    elder_name: "黄秀英",
    age: 76,
    gender: "女",
    community_id: "org_qingxiu_community",
    community_name: "青秀社区",
    address_label: "南宁市青秀区凤岭北路",
    care_level: "慢病随访",
    ability_status: "轻度失能"
  },
  {
    elder_id: "elder_li_deming",
    elder_name: "李德明",
    age: 78,
    gender: "男",
    community_id: "org_qingxiu_community",
    community_name: "青秀社区",
    address_label: "南宁市青秀区长湖路片区",
    care_level: "慢病随访",
    ability_status: "轻度失能"
  },
  {
    elder_id: "elder_wei_guilan",
    elder_name: "韦桂兰",
    age: 86,
    gender: "女",
    community_id: "org_qingxiu_community",
    community_name: "青秀社区",
    address_label: "南宁市青秀区凤岭片区",
    care_level: "重点关怀",
    ability_status: "中度失能"
  }
];

export const mockUsers = [
  {
    key: "c_elder",
    label: "C端用户（老人）",
    user_id: "user_huang_xiuying",
    account: "huang_xiuying",
    real_name: "黄秀英",
    role_key: "elder",
    role_id: "LAO_REN",
    role_name: "老人",
    terminal: "C",
    auth_level: "public",
    org_id: "org_qingxiu_community",
    org_name: "青秀社区",
    elder_scope: "elder_huang_xiuying",
    token: "dev-sso-elder-test",
    phone_masked: "138****0001"
  },
  {
    key: "c_family",
    label: "C端用户（家属）",
    user_id: "user_chen_xiaomei",
    account: "chen_xiaomei",
    real_name: "陈晓梅",
    role_key: "elder_family",
    role_id: "JIA_SHU",
    role_name: "家属",
    terminal: "C",
    auth_level: "public",
    org_id: "org_qingxiu_community",
    org_name: "青秀社区",
    elder_scope: "elder_huang_xiuying",
    token: "dev-sso-family-test",
    phone_masked: "138****2601"
  },
  {
    key: "g_civil_affairs_staff",
    label: "G端用户（民政局科员）",
    user_id: "user_li_keyuan",
    account: "li_keyuan",
    real_name: "李文静",
    role_key: "civil_affairs_staff",
    role_id: "MIN_ZHENG_KE_YUAN",
    role_name: "民政局科员",
    terminal: "G",
    auth_level: "government",
    org_id: "org_qingxiu_mca",
    org_name: "南宁市青秀区民政局",
    elder_scope: "district_qingxiu",
    token: "dev-sso-civil-affairs-test",
    phone_masked: "139****6202"
  },
  {
    key: "g_grid_worker",
    label: "G端用户（社区网格员）",
    user_id: "user_huang_lijuan",
    account: "huang_lijuan",
    real_name: "黄丽娟",
    role_key: "grid_worker",
    role_id: "SHE_QU_WANG_GE_YUAN",
    role_name: "社区网格员",
    terminal: "G",
    auth_level: "staff",
    org_id: "org_qingxiu_community",
    org_name: "青秀社区网格",
    elder_scope: "community_qingxiu",
    token: "dev-sso-grid-worker-test",
    phone_masked: "137****3603"
  },
  {
    key: "b_institution_admin",
    label: "B端用户（机构管理员）",
    user_id: "user_chen_yuanzhang",
    account: "chen_yuanzhang",
    real_name: "陈建国",
    role_key: "institution_admin",
    role_id: "manager",
    role_name: "机构端-管理员",
    terminal: "B",
    auth_level: "institution_admin",
    org_id: "org_guixiaoyang_center",
    org_name: "桂小养康养中心",
    elder_scope: "institution_guixiaoyang_center",
    token: "dev-sso-institution-admin-test",
    phone_masked: "136****4104"
  },
  {
    key: "c_care_worker",
    label: "C端用户（护理员）",
    user_id: "user_lan_xiaoqin",
    account: "lan_xiaoqin",
    real_name: "蓝小琴",
    role_key: "care_worker",
    role_id: "HU_LI_YUAN",
    role_name: "护理员",
    terminal: "C",
    auth_level: "care_medical",
    org_id: "org_qingxiu_nursing",
    org_name: "青秀护理站",
    elder_scope: "care_team_qingxiu",
    token: "dev-sso-care-worker-test",
    phone_masked: "135****5105"
  },
  {
    key: "c_village_doctor",
    label: "C端用户（村医）",
    user_id: "user_wei_guoming",
    account: "wei_guoming",
    real_name: "韦国明",
    role_key: "village_doctor",
    role_id: "CUN_YI",
    role_name: "村医",
    terminal: "C",
    auth_level: "care_medical",
    org_id: "org_qingxiu_clinic",
    org_name: "青秀镇卫生院",
    elder_scope: "care_team_qingxiu",
    token: "dev-sso-village-doctor-test",
    phone_masked: "135****5106"
  },
  {
    key: "system_admin",
    label: "系统管理员用户",
    user_id: "user_platform_admin",
    account: "platform_admin",
    real_name: "平台管理员",
    role_key: "system_admin",
    role_id: "CHAO_JI_GUAN_LI_YUAN",
    role_name: "超级管理员",
    terminal: "Admin",
    auth_level: "admin",
    org_id: "org_platform",
    org_name: "桂小养平台运营中心",
    elder_scope: "all",
    token: "dev-sso-system-admin-test",
    phone_masked: "188****8888"
  },
  {
    key: "b_director",
    label: "B端用户（院长）",
    user_id: "user_li_director",
    account: "li_director",
    real_name: "李明远",
    role_key: "institution_admin",
    role_id: "director",
    role_name: "机构端-院长",
    terminal: "B",
    auth_level: "institution_admin",
    org_id: "org_guixiaoyang_center",
    org_name: "桂小养康养中心",
    elder_scope: "institution_guixiaoyang_center",
    token: "dev-sso-director-test",
    phone_masked: "136****4101"
  },
  {
    key: "c_community_doctor",
    label: "C端用户（社区居家-医生）",
    user_id: "user_zhao_doctor",
    account: "zhao_doctor",
    real_name: "赵伟华",
    role_key: "community_doctor",
    role_id: "SQJJ-YS",
    role_name: "社区居家-医生",
    terminal: "C",
    auth_level: "care_medical",
    org_id: "org_qingxiu_clinic",
    org_name: "青秀社区卫生站",
    elder_scope: "care_team_qingxiu",
    token: "dev-sso-community-doctor-test",
    phone_masked: "135****5107"
  },
  {
    key: "c_community_helper",
    label: "C端用户（社区居家-助老员）",
    user_id: "user_wu_helper",
    account: "wu_helper",
    real_name: "吴秀芳",
    role_key: "community_helper",
    role_id: "SQJJ-ZLY",
    role_name: "社区居家-助老员",
    terminal: "C",
    auth_level: "care_medical",
    org_id: "org_qingxiu_community",
    org_name: "青秀社区",
    elder_scope: "community_qingxiu",
    token: "dev-sso-community-helper-test",
    phone_masked: "135****5108"
  },
  {
    key: "c_provider_staff",
    label: "C端用户（服务商）",
    user_id: "user_zhang_provider",
    account: "zhang_provider",
    real_name: "张文强",
    role_key: "provider_staff",
    role_id: "FU_WU_SHANG",
    role_name: "服务商",
    terminal: "C",
    auth_level: "provider",
    org_id: "org_provider_1",
    org_name: "广西康养服务商",
    elder_scope: "provider_scope_1",
    token: "dev-sso-provider-staff-test",
    phone_masked: "135****5109"
  },
  {
    key: "g_senior_official",
    label: "G端用户（厅级干部）",
    user_id: "user_wang_official",
    account: "wang_official",
    real_name: "王志远",
    role_key: "senior_official",
    role_id: "TING_JI_GAN_BU",
    role_name: "厅级干部",
    terminal: "G",
    auth_level: "government",
    org_id: "org_guangxi_mca",
    org_name: "广西民政厅",
    elder_scope: "province_guangxi",
    token: "dev-sso-senior-official-test",
    phone_masked: "139****0001"
  },
  {
    key: "admin_config",
    label: "配置管理员",
    user_id: "user_liu_config",
    account: "liu_config",
    real_name: "刘建国",
    role_key: "admin",
    role_id: "PEI_ZHI_GUAN_LI_YUAN",
    role_name: "配置管理员",
    terminal: "Admin",
    auth_level: "admin",
    org_id: "org_platform",
    org_name: "桂小养平台运营中心",
    elder_scope: "all",
    token: "dev-sso-config-admin-test",
    phone_masked: "188****8889"
  }
];

export const mockRelations = [
  { user_id: "user_chen_xiaomei", elder_id: "elder_huang_xiuying", relation_type: "family", relation_name: "女儿" },
  { user_id: "user_huang_lijuan", elder_id: "elder_huang_xiuying", relation_type: "grid_scope", relation_name: "社区网格员" },
  { user_id: "user_huang_lijuan", elder_id: "elder_li_deming", relation_type: "grid_scope", relation_name: "社区网格员" },
  { user_id: "user_huang_lijuan", elder_id: "elder_wei_guilan", relation_type: "grid_scope", relation_name: "社区网格员" },
  { user_id: "user_chen_yuanzhang", elder_id: "elder_wei_guilan", relation_type: "institution_scope", relation_name: "机构管理员" },
  { user_id: "user_lan_xiaoqin", elder_id: "elder_huang_xiuying", relation_type: "care_service", relation_name: "护理员" },
  { user_id: "user_wei_guoming", elder_id: "elder_huang_xiuying", relation_type: "care_service", relation_name: "村医" },
  { user_id: "user_li_keyuan", elder_id: "elder_huang_xiuying", relation_type: "district_scope", relation_name: "民政科员" }
];

export const mockOrders = [
  {
    order_id: "order_20260714_001",
    title: "青秀区养老机构推荐预约",
    elder_id: "elder_huang_xiuying",
    creator_user_id: "user_chen_xiaomei",
    service_type: "养老机构推荐",
    status: "pending_grid_confirm",
    org_id: "org_qingxiu_community",
    created_at: now
  }
];

export const mockWorkOrders = [
  {
    work_order_id: "work_20260714_001",
    order_id: "order_20260714_001",
    title: "黄秀英养老机构推荐协助确认",
    elder_id: "elder_huang_xiuying",
    assignee_user_id: "user_huang_lijuan",
    assignee_role: "grid_worker",
    org_id: "org_qingxiu_community",
    status: "pending",
    created_at: now
  },
  {
    work_order_id: "work_20260714_002",
    order_id: "order_20260714_001",
    title: "桂小养康养中心待接单",
    elder_id: "elder_huang_xiuying",
    assignee_user_id: "user_chen_yuanzhang",
    assignee_role: "institution_admin",
    org_id: "org_guixiaoyang_center",
    status: "pending_accept",
    created_at: now
  }
];

export const mockTodos = [
  {
    todo_id: "todo_grid_001",
    title: "协助确认黄秀英养老机构推荐需求",
    business_type: "service_order",
    business_id: "order_20260714_001",
    assignee_user_id: "user_huang_lijuan",
    assignee_role: "grid_worker",
    org_id: "org_qingxiu_community",
    elder_id: "elder_huang_xiuying",
    status: "pending",
    due_at: "2026-07-14T18:00:00+08:00",
    actions: ["联系家属", "补充能力评估", "转机构接单"]
  },
  {
    todo_id: "todo_institution_001",
    title: "确认桂小养康养中心是否可承接",
    business_type: "service_order",
    business_id: "order_20260714_001",
    assignee_user_id: "user_chen_yuanzhang",
    assignee_role: "institution_admin",
    org_id: "org_guixiaoyang_center",
    elder_id: "elder_huang_xiuying",
    status: "pending_accept",
    due_at: "2026-07-14T20:00:00+08:00",
    actions: ["接单", "拒单", "转派护理员"]
  },
  {
    todo_id: "todo_care_001",
    title: "上门评估黄秀英照护需求",
    business_type: "work_order",
    business_id: "work_20260714_001",
    assignee_user_id: "user_lan_xiaoqin",
    assignee_role: "care_doctor",
    org_id: "org_qingxiu_nursing",
    elder_id: "elder_huang_xiuying",
    status: "scheduled",
    due_at: "2026-07-15T09:30:00+08:00",
    actions: ["上门签到", "填写评估", "提交结果"]
  }
];

export const mockMessages = [
  {
    message_id: "msg_family_001",
    type: "order",
    title: "养老机构推荐已提交",
    content: "已为黄秀英提交青秀区附近养老机构推荐需求，等待社区网格员协助确认。",
    business_type: "service_order",
    business_id: "order_20260714_001",
    source_user_id: "user_chen_xiaomei",
    source_role: "elder_family",
    target_user_id: "user_chen_xiaomei",
    target_role: "elder_family",
    target_terminal: "C",
    org_id: "org_qingxiu_community",
    elder_id: "elder_huang_xiuying",
    status: "delivered",
    read_status: "unread",
    priority: "normal",
    action_buttons: ["查看订单", "补充需求"],
    created_at: now,
    updated_at: now
  },
  {
    message_id: "msg_grid_001",
    type: "todo",
    title: "新的社区协助确认待办",
    content: "黄秀英家属提交养老机构推荐需求，请核实老人能力状态、居住情况与服务偏好。",
    business_type: "service_order",
    business_id: "order_20260714_001",
    source_user_id: "user_chen_xiaomei",
    source_role: "elder_family",
    target_user_id: "user_huang_lijuan",
    target_role: "grid_worker",
    target_terminal: "G",
    org_id: "org_qingxiu_community",
    elder_id: "elder_huang_xiuying",
    status: "delivered",
    read_status: "unread",
    priority: "high",
    action_buttons: ["联系家属", "确认需求", "转机构"],
    created_at: now,
    updated_at: now
  },
  {
    message_id: "msg_inst_001",
    type: "todo",
    title: "机构待接单",
    content: "桂小养康养中心收到黄秀英养老机构推荐候选，请确认床位和评估安排。",
    business_type: "service_order",
    business_id: "order_20260714_001",
    source_user_id: "user_huang_lijuan",
    source_role: "grid_worker",
    target_user_id: "user_chen_yuanzhang",
    target_role: "institution_admin",
    target_terminal: "B",
    org_id: "org_guixiaoyang_center",
    elder_id: "elder_huang_xiuying",
    status: "delivered",
    read_status: "unread",
    priority: "high",
    action_buttons: ["接单", "拒单", "转派护理员"],
    created_at: now,
    updated_at: now
  },
  {
    message_id: "msg_care_001",
    type: "work_order",
    title: "上门评估任务",
    content: "请于明日上午到黄秀英家中完成照护需求评估。",
    business_type: "work_order",
    business_id: "work_20260714_001",
    source_user_id: "user_chen_yuanzhang",
    source_role: "institution_admin",
    target_user_id: "user_lan_xiaoqin",
    target_role: "care_doctor",
    target_terminal: "C",
    org_id: "org_qingxiu_nursing",
    elder_id: "elder_huang_xiuying",
    status: "delivered",
    read_status: "unread",
    priority: "normal",
    action_buttons: ["查看地址", "上门签到", "提交评估"],
    created_at: now,
    updated_at: now
  },
  {
    message_id: "msg_gov_001",
    type: "supervision",
    title: "辖区养老服务协同事件",
    content: "青秀社区产生 1 条养老机构推荐协同事件，可在辖区监管中查看流转状态。",
    business_type: "service_order",
    business_id: "order_20260714_001",
    source_user_id: "user_huang_lijuan",
    source_role: "grid_worker",
    target_user_id: "user_li_keyuan",
    target_role: "civil_affairs_staff",
    target_terminal: "G",
    org_id: "org_qingxiu_mca",
    elder_id: "elder_huang_xiuying",
    status: "delivered",
    read_status: "read",
    priority: "normal",
    action_buttons: ["查看辖区事件"],
    created_at: now,
    updated_at: now
  },
  {
    message_id: "msg_admin_001",
    type: "audit",
    title: "平台协同链路审计",
    content: "订单 order_20260714_001 已生成 C/G/B/护理员多端消息链路。",
    business_type: "audit",
    business_id: "order_20260714_001",
    source_user_id: "system",
    source_role: "system",
    target_user_id: "user_platform_admin",
    target_role: "system_admin",
    target_terminal: "Admin",
    org_id: "org_platform",
    elder_id: "elder_huang_xiuying",
    status: "delivered",
    read_status: "read",
    priority: "normal",
    action_buttons: ["查看审计"],
    created_at: now,
    updated_at: now
  }
];

function orgById(orgId) {
  return mockOrganizations.find((org) => org.org_id === orgId) || null;
}

function elderById(elderId) {
  return mockElders.find((elder) => elder.elder_id === elderId) || null;
}

/** 按姓名精确匹配可见范围内的老人档案（用于同名确认） */
export function findEldersByName(name = '', user = null) {
  const target = String(name || '').trim();
  if (!target) return [];
  const pool = user ? getVisibleElders(user) : mockElders;
  return pool.filter((elder) => elder.elder_name === target);
}

export function getMockUserByToken(token = "", roleKey = "") {
  return mockUsers.find((user) => token && user.token === token)
    || mockUsers.find((user) => roleKey && user.role_key === roleKey)
    || mockUsers[0];
}

function canSeeScopedItem(user, item) {
  if (!user) return false;
  if (user.auth_level === "admin" || user.elder_scope === "all") return true;
  if (item.target_user_id && item.target_user_id === user.user_id) return true;
  if (item.assignee_user_id && item.assignee_user_id === user.user_id) return true;
  if (item.creator_user_id && item.creator_user_id === user.user_id) return true;
  if (item.org_id && item.org_id === user.org_id) return true;
  if (user.elder_scope?.startsWith("community_")) {
    const elder = elderById(item.elder_id);
    return elder?.community_id === "org_qingxiu_community";
  }
  if (user.elder_scope?.startsWith("district_")) return true;
  return item.elder_id && item.elder_id === user.elder_scope;
}

export function getVisibleElders(user) {
  if (!user) return [];
  if (user.auth_level === "admin" || user.elder_scope === "all" || user.elder_scope?.startsWith("district_")) {
    return mockElders;
  }
  if (user.elder_scope?.startsWith("community_")) {
    return mockElders.filter((elder) => elder.community_id === "org_qingxiu_community");
  }
  const ids = new Set(mockRelations.filter((relation) => relation.user_id === user.user_id).map((relation) => relation.elder_id));
  if (user.elder_scope?.startsWith("elder_")) ids.add(user.elder_scope);
  return mockElders.filter((elder) => ids.has(elder.elder_id));
}

export function getMessages(query = {}) {
  const user = getMockUserByToken(query.token || query.userToken, query.roleKey);
  const status = query.status || "";
  return mockMessages
    .filter((message) => canSeeScopedItem(user, message))
    .filter((message) => !status || message.status === status || message.read_status === status)
    .map((message) => ({ ...message, elder: elderById(message.elder_id) }));
}

export function getTodos(query = {}) {
  const user = getMockUserByToken(query.token || query.userToken, query.roleKey);
  const status = query.status || "";
  return mockTodos
    .filter((todo) => canSeeScopedItem(user, todo))
    .filter((todo) => !status || todo.status === status)
    .map((todo) => ({ ...todo, elder: elderById(todo.elder_id) }));
}

export function getOrders(query = {}) {
  const user = getMockUserByToken(query.token || query.userToken, query.roleKey);
  return mockOrders
    .filter((order) => canSeeScopedItem(user, order))
    .map((order) => ({ ...order, elder: elderById(order.elder_id) }));
}

export function getWorkOrders(query = {}) {
  const user = getMockUserByToken(query.token || query.userToken, query.roleKey);
  return mockWorkOrders
    .filter((workOrder) => canSeeScopedItem(user, workOrder))
    .map((workOrder) => ({ ...workOrder, elder: elderById(workOrder.elder_id) }));
}

export function getProfile(query = {}) {
  const user = getMockUserByToken(query.token || query.userToken, query.roleKey);
  const org = orgById(user.org_id);
  const elders = getVisibleElders(user);
  const messages = getMessages({ token: user.token, roleKey: user.role_key });
  const todos = getTodos({ token: user.token, roleKey: user.role_key });
  return {
    user,
    org,
    elders,
    summary: {
      message_count: messages.length,
      unread_count: messages.filter((item) => item.read_status === "unread").length,
      todo_count: todos.length,
      pending_todo_count: todos.filter((item) => item.status.includes("pending")).length
    }
  };
}

export function getMobileBootstrap(query = {}) {
  // 支持 external_aes_sso 外部 SSO 用户信息
  // 仅凭 presetKey 即可判定为外部 SSO，不要求 userName 非空（避免回退到 mock 数据）
  if (query.presetKey === 'external_aes_sso') {
    // 构建外部 SSO 用户的 profile
    const displayName = query.userName || query.userId || '用户';
    const profile = {
      user: {
        user_id: query.userId || 'external_user',
        real_name: displayName,
        role_key: query.roleKey || 'guest',
        role_name: query.roleKey || 'guest',
        org_id: query.orgId || '',
        org_name: query.orgName || '',
        terminal: query.terminal || 'H5',
        auth_level: query.authLevel || 'external',
        elder_scope: query.elderScope || '',
      },
      org: query.orgName ? { org_id: query.orgId || '', org_name: query.orgName } : null,
      elders: [],
      summary: {
        message_count: 0,
        unread_count: 0,
        todo_count: 0,
        pending_todo_count: 0,
      },
    };
    return {
      profile,
      messages: [],
      todos: [],
      orders: [],
      workOrders: [],
      quickActions: [
        { key: 'find_service', label: '找服务', prompt: '推荐附近的养老机构' },
        { key: 'policy_consult', label: '查补贴', prompt: '老人有什么补贴' },
        { key: 'travel_route', label: '旅居规划', prompt: '规划旅居线路' },
        { key: 'meal_plan', label: '膳食推荐', prompt: '推荐适合老人的一日三餐' },
      ],
    };
  }

  // 默认：从 mock 用户数据查找
  const profile = getProfile(query);
  const params = { token: profile.user.token, roleKey: profile.user.role_key };
  return {
    profile,
    messages: getMessages(params).slice(0, 10),
    todos: getTodos(params).slice(0, 10),
    orders: getOrders(params).slice(0, 10),
    workOrders: getWorkOrders(params).slice(0, 10),
    quickActions: [
      { key: 'find_service', label: '找服务', prompt: '推荐青秀区附近的养老机构' },
      { key: 'policy_consult', label: '查补贴', prompt: '老人有什么补贴' },
      { key: 'travel_route', label: '旅居规划', prompt: '规划南宁周边旅居线路' },
      { key: 'meal_plan', label: '膳食推荐', prompt: '推荐适合老人的一日三餐' },
    ],
  };
}

export function getDevSsoPresets() {
  return mockUsers.map((user) => ({
    key: user.key,
    label: user.label,
    roleKey: user.role_key,
    userName: user.real_name,
    terminal: user.terminal,
    authLevel: user.auth_level,
    orgId: user.org_id,
    orgName: user.org_name,
    elderScope: user.elder_scope,
    token: user.token,
    phoneMasked: user.phone_masked
  }));
}

