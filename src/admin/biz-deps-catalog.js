/**
 * Static catalog: skill → tables / tag-system APIs / third-party integrations.
 * Used by admin biz-deps scan (governance). Runtime truth still comes from data-access spans.
 */

/** @type {Record<string, {
 *   label: string,
 *   tables: string[],
 *   tag_system: string[],
 *   integrations: string[],
 *   notes?: string,
 * }>} */
export const SKILL_BIZ_DEPS = {
  meal_plan: {
    label: '膳食推荐',
    tables: ['elder_profile', 'meal_rules', 'diet_contraindications'],
    tag_system: [],
    integrations: [],
    notes: '默认多为本地种子表；可切 PG repository',
  },
  travel_route: {
    label: '旅居规划',
    tables: ['gxy_travel_route_plan'],
    tag_system: [],
    integrations: ['jintiaodong', 'tencent_weather', 'qweather', 'tencent_map'],
    notes: 'JTD 产品/可订；天气动作走腾讯/和风；地图可选',
  },
  health_risk_warning: {
    label: '健康风险预警',
    tables: ['health_risk_warning_business'],
    tag_system: [],
    integrations: ['yunzhen365'],
    notes: 'remoteHealth / 云诊；本地业务场景表',
  },
  find_service: {
    label: '服务发现与匹配',
    tables: ['fs_service_catalog', 'fs_org', 'fs_worker', 'fs_service_order'],
    tag_system: [
      'listMobileServiceItems',
      'getServiceOrder',
      'createServiceOrder',
      'getEvaluationRecords',
      'getFeedbackMetrics',
      'listFeedback',
    ],
    integrations: ['tag_system', 'unified_auth'],
    notes: '订单/目录优先 tag-system；质量评价与反馈直连 PG tag_system',
  },
  dispatch_manage: {
    label: '派单与工单',
    tables: ['dm_dispatch_order'],
    tag_system: [
      'getWorkOrder',
      'createWorkOrder',
      'getEvaluationRecords',
      'getFeedbackMetrics',
      'saveWorkOrderEvaluation',
    ],
    integrations: ['tag_system'],
    notes: '工单远程 + tag-system 质量/反馈',
  },
  service_quality_eval: {
    label: '服务质量评价',
    tables: [],
    tag_system: ['getEvaluationRecords', 'getFeedbackMetrics', 'listFeedback'],
    integrations: ['tag_system'],
  },
  nearby_resource: {
    label: '周边资源',
    tables: [],
    tag_system: [],
    integrations: ['tencent_map', 'tavily'],
    notes: '腾讯地图 POI / 可选网页搜索增强',
  },
  common: {
    label: '通用兜底',
    tables: [],
    tag_system: [],
    integrations: [],
    notes: 'LLM + answer 模板，无强制业务表',
  },
};

/** Integration keys that appear in integrations.json seeds / runtime */
export const KNOWN_INTEGRATION_ALIASES = {
  jintiaodong: ['jintiaodong', 'jtd'],
  yunzhen365: ['yunzhen365', 'remote_health'],
  tag_system: ['tag_system'],
  unified_auth: ['unified_auth', 'gxy_auth'],
  tencent_weather: ['tencent_weather'],
  qweather: ['qweather'],
  tencent_map: ['tencent_map'],
  tavily: ['tavily'],
};
