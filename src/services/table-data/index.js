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

    async getFindServiceTables(params = {}) {
      const { assembleFindServiceData } = await import('../../skills/find_service/lib/data-assembler.js');
      return assembleFindServiceData(params);
    },

    async getDispatchManageTables(params = {}) {
      const { assembleDispatchData } = await import('../../skills/dispatch_manage/lib/data-assembler.js');
      return assembleDispatchData(params);
    },

    async getSkillConfigs() {
      const rows = await repository.list('skill_configs');
      const map = {};
      for (const row of rows) map[row.skill_key] = row;
      return map;
    },
  };
}
