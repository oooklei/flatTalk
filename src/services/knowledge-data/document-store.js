export const DEFAULT_DOCUMENTS = Object.freeze([
  {
    document_id: 'meal_plan_doc_1',
    skill_key: 'meal_plan',
    title: '糖尿病老人膳食原则',
    source_path: 'src/skills/meal_plan/knowledge-docs/diabetes.md',
    text: '糖尿病老人应减少精制碳水和含糖饮品，主食控制总量，并搭配蛋白质和膳食纤维。',
  },
  {
    document_id: 'meal_plan_doc_2',
    skill_key: 'meal_plan',
    title: '高血压低盐膳食原则',
    source_path: 'src/skills/meal_plan/knowledge-docs/hypertension.md',
    text: '高血压老人应减少钠盐摄入，避免腌制食品和重口味调料。',
  },
  {
    document_id: 'travel_route_doc_1',
    skill_key: 'travel_route',
    title: '广西旅居康养路线原则',
    source_path: 'src/skills/travel_route/knowledge-docs/policy_and_service.md',
    text: '老人旅居路线应优先考虑气候温和、医疗可达、交通接驳清晰、活动强度低，并预留休息和家属陪同空间。',
  },
  {
    document_id: 'travel_route_doc_2',
    skill_key: 'travel_route',
    title: '旅居预订与安全确认',
    source_path: 'src/skills/travel_route/knowledge-docs/operation_guide.md',
    text: '旅居预订前应确认房间余量、无障碍条件、附近医疗资源、天气风险和老人常用药携带情况。',
  },
]);

export const COMMON_POLICY_DOCUMENTS = Object.freeze([
  {
    document_id: 'elder_policy_common_doc_1',
    skill_key: 'common',
    title: '养老政策与补贴咨询通用指引',
    source_path: 'src/skills/common/knowledge-docs/elder-policy.md',
    text: '养老政策咨询通常包括高龄津贴、长期护理保险、护理补贴、居家社区养老服务、助餐补贴、适老化改造、失能评估和能力评估。办理时一般需要确认老人年龄、户籍或居住地、身体能力等级、经济困难情况、医保或社保状态，并以当地民政、人社、医保等部门最新要求为准。',
  },
  {
    document_id: 'elder_policy_common_doc_2',
    skill_key: 'common',
    title: '养老政策申请材料与办理流程',
    source_path: 'src/skills/common/knowledge-docs/elder-policy-apply.md',
    text: '申请养老补贴或养老服务时，常见材料包括身份证、户口簿或居住证明、银行卡、能力评估或失能评估结果、低保或特困证明、医保参保证明、服务申请表等。常见流程为咨询确认条件、提交申请材料、街道或社区初审、主管部门审核、公示或评估、发放补贴或开通服务。',
  },
]);

export function createDocumentStore({ seedDocuments = DEFAULT_DOCUMENTS } = {}) {
  const documents = mergeDefaultDocuments(seedDocuments);

  return {
    async listBySkill(skillKey) {
      return deepClone(documents.filter((document) => document.skill_key === skillKey));
    },

    async listAll() {
      return deepClone(documents);
    },

    addDocuments(newDocs = []) {
      let added = 0;
      for (const document of newDocs) {
        if (!document?.document_id) continue;
        if (documents.some((d) => d.document_id === document.document_id)) continue;
        documents.push(deepClone(document));
        added += 1;
      }
      return added;
    },

    async get(documentId) {
      const document = documents.find((item) => item.document_id === documentId);
      return document ? deepClone(document) : null;
    },

    async upsert(document) {
      if (!document?.document_id) throw new Error('document_id_required');
      const index = documents.findIndex((item) => item.document_id === document.document_id);
      if (index >= 0) {
        documents[index] = deepClone({ ...documents[index], ...document });
      } else {
        documents.push(deepClone(document));
      }
      return deepClone(documents[index >= 0 ? index : documents.length - 1]);
    },

    async remove(documentId) {
      const index = documents.findIndex((item) => item.document_id === documentId);
      if (index < 0) return false;
      documents.splice(index, 1);
      return true;
    },
  };
}

function mergeDefaultDocuments(seedDocuments) {
  const merged = deepClone(seedDocuments);
  for (const document of COMMON_POLICY_DOCUMENTS) {
    if (!merged.some((item) => item.document_id === document.document_id)) {
      merged.push(deepClone(document));
    }
  }
  return merged;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
