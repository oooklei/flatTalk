import "dotenv/config";

export function loadEnv() {
  return {
    host: process.env.FLATTALK_HOST || "127.0.0.1",
    port: Number(process.env.FLATTALK_PORT || 5298),
    
    // HTTPS 配置（用于话筒等需要安全上下文的功能）
    sslPort: Number(process.env.FLATTALK_SSL_PORT || 5444),
    sslKey: process.env.FLATTALK_SSL_KEY || "",
    sslCert: process.env.FLATTALK_SSL_CERT || "",
    
    runtimeMode: process.env.FLATTALK_RUNTIME_MODE || "local",
    pgUrl: process.env.FLATTALK_PG_URL || process.env.FLATTALK_TAG_SYSTEM_PG_URL || process.env.TAG_SYSTEM_PG_URL || "",
    redisUrl: process.env.FLATTALK_REDIS_URL || process.env.TAG_SYSTEM_REDIS_URL || "",
    tagSystemBaseUrl: process.env.FLATTALK_TAG_SYSTEM_BASE_URL || "http://192.168.1.160:8010",
    tagSystemPgUrl: process.env.FLATTALK_TAG_SYSTEM_PG_URL || process.env.FLATTALK_PG_URL || process.env.TAG_SYSTEM_PG_URL || "",
    tagSystemToken: process.env.FLATTALK_TAG_SYSTEM_TOKEN || process.env.TAG_SYSTEM_SSO_TOKEN || "",
    knowledgeBaseUrl: process.env.FLATTALK_KB_BASE_URL || "http://43.138.143.130:9015",
    knowledgeSearchPath: process.env.FLATTALK_KB_SEARCH_PATH || "/api/knowledge/query",
    knowledgeApiKey: process.env.FLATTALK_KB_API_KEY || "",
    knowledgeUsername: process.env.FLATTALK_KB_USERNAME || "admin@nuwax.com",
    knowledgePassword: process.env.FLATTALK_KB_PASSWORD || "123456",
    knowledgeTicket: process.env.FLATTALK_KB_TICKET || "",
    knowledgeSpace: process.env.FLATTALK_KB_SPACE || "23",
    knowledgeAgentId: process.env.FLATTALK_KB_AGENT_ID || "373",
    knowledgeCollections: process.env.FLATTALK_KB_COLLECTIONS || "",
    knowledgeMealPlanCollections: process.env.FLATTALK_KB_MEAL_PLAN_COLLECTIONS || "膳食知识库",
    knowledgeDefaultCollections: process.env.FLATTALK_KB_DEFAULT_COLLECTIONS || "广西养老办事指引知识库,广西养老政策知识库",
    modelMode: process.env.FLATTALK_MODEL_MODE || "admin",
    modelRegistryPath: process.env.FLATTALK_MODEL_REGISTRY_PATH || "",
    modelId: process.env.FLATTALK_MODEL_ID || "",
    openaiBaseUrl: process.env.FLATTALK_OPENAI_BASE_URL || "",
    openaiApiKey: process.env.FLATTALK_OPENAI_API_KEY || "",
    openaiModel: process.env.FLATTALK_OPENAI_MODEL || "",
  };
}