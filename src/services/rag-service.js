export function createRagService({ knowledgeData }) {
  return {
    async retrieveKnowledge({ skill_key = 'common', query = '', limit = 3, filters = {} } = {}) {
      return knowledgeData.retriever.retrieve({
        skill_key,
        query,
        limit,
        filters,
      });
    },

    async retrieveMealPlanKnowledge({ query = '', limit = 3, filters = {} } = {}) {
      return knowledgeData.retriever.retrieve({
        skill_key: 'meal_plan',
        query,
        limit,
        filters,
      });
    },
  };
}
