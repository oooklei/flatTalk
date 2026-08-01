import { createTableDataRepository } from './repository.js';

export function createTableDataService(options = {}) {
  const repository = createTableDataRepository(options);

  return {
    repository,

    async getMealPlanTables({ elder_id = 'demo_elder_1' } = {}) {
      return {
        elder_profile: await repository.get('elder_profile', elder_id),
        meal_rules: await repository.list('meal_rules'),
        diet_contraindications: await repository.list('diet_contraindications'),
        source: 'flatTalk_table_data',
      };
    },

    async getTravelRouteTables() {
      return {
        routes: await repository.list('gxy_travel_route_plan'),
        source: 'flatTalk_table_data',
      };
    },

    async getHealthRiskWarningTables() {
      return {
        business_scenes: await repository.list('health_risk_warning_business'),
        source: 'flatTalk_table_data',
      };
    },

    async getFindServiceTables() {
      return {
        service_catalog: await repository.list('fs_service_catalog'),
        orgs: await repository.list('fs_org'),
        workers: await repository.list('fs_worker'),
        orders: await repository.list('fs_service_order'),
        source: 'flatTalk_table_data',
      };
    },

    async getDispatchManageTables() {
      return {
        dispatch_orders: await repository.list('dm_dispatch_order'),
        orders: await repository.list('fs_service_order'),
        workers: await repository.list('fs_worker'),
        source: 'flatTalk_table_data',
      };
    },

    async getSkillConfigs() {
      const rows = await repository.list('skill_configs');
      const map = {};
      for (const row of rows) map[row.skill_key] = row;
      return map;
    },
  };
}
