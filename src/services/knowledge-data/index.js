import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { createDocumentStore, DEFAULT_DOCUMENTS, COMMON_POLICY_DOCUMENTS } from './document-store.js';
import { createChunkStore } from './chunk-store.js';
import { createVectorStore } from './vector-store.js';
import { createKnowledgeRetriever } from './retriever.js';
import { createRemoteKnowledgeAdapter } from './remote-knowledge-adapter.js';
import { readModelRegistry, resolveModelApiKey } from '../../core/model-runtime/model-registry.js';
import { callEmbedding } from '../../core/model-runtime/openai-compatible-client.js';

// 同步加载本地知识库服务（local-knowledge-service.js 内部使用 fs.readFileSync，无异步操作）
let localKnowledgeService = null;
function getLocalKnowledgeService() {
  if (!localKnowledgeService) {
    try {
      const require = createRequire(import.meta.url);
      const servicePath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../skills/travel_route/local-knowledge-service.js',
      );
      localKnowledgeService = require(servicePath);
    } catch {
      // 本地知识库服务不可用时降级为 null
      localKnowledgeService = null;
    }
  }
  return localKnowledgeService;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(moduleDir, '../../..');

function hashId(prefix, value) {
  return `${prefix}-${crypto.createHash('md5').update(value).digest('hex').slice(0, 10)}`;
}

/**
 * 从指定目录读取 Markdown 文档
 * @param {string} dir - 目录路径
 * @param {string} skillKey - 技能标识
 * @returns {Array} 文档数组
 */
function readMarkdownDocs(dir, skillKey) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) { 
        walk(p); 
        continue; 
      }
      if (!entry.name.endsWith('.md')) continue;
      if (entry.name === 'INDEX.md' || entry.name.startsWith('_') || entry.name === 'vectorization_plan.md') continue;
      
      const text = fs.readFileSync(p, 'utf8').trim();
      if (!text) continue;
      
      const heading = text.split('\n').find((l) => l.startsWith('#'));
      const title = heading ? heading.replace(/^#+\s*/, '') : entry.name.replace(/\.md$/, '');
      out.push({ 
        document_id: hashId('policy', p), 
        skill_key: skillKey, 
        title, 
        source_path: p, 
        text 
      });
    }
  };
  
  walk(dir);
  return out;
}

/**
 * 从 skills 目录加载知识文档（本地优先）
 * 包含各技能 knowledge_docs 目录 + assets/source-copies 中的 trace_route 旅居线路文档
 */
function loadLocalKnowledgeDocuments(root) {
  const docs = [];

  // 1. 从各技能的 knowledge_docs 目录加载
  const skillKnowledgePaths = [
    { path: 'src/skills/health_risk_warning/knowledge_docs', key: 'health_risk_warning' },
    { path: 'src/skills/travel_route/knowledge_docs', key: 'travel_route' },
    { path: 'src/skills/meal_plan/knowledge_docs', key: 'meal_plan' },
    { path: 'src/skills/common/knowledge_docs', key: 'common' },
  ];

  for (const { path: relativePath, key } of skillKnowledgePaths) {
    const fullPath = path.join(root, relativePath);
    if (fs.existsSync(fullPath)) {
      docs.push(...readMarkdownDocs(fullPath, key));
    }
  }

  // 2. 加载防城港旅居线路文档（trace_route skill_key，供 travel_route 场景的 required_knowledge 检索）
  const traceRouteDir = path.join(root, 'assets', 'source-copies', 'skill-packages', 'travel_route_dispatch', 'knowledge_docs', 'trace_route');
  if (fs.existsSync(traceRouteDir)) {
    docs.push(...readMarkdownDocs(traceRouteDir, 'trace_route'));
  }

  return docs;
}

/**
 * 从 data/knowledge.json 加载导入的知识
 */
function loadImportedKnowledge(root) {
  const file = path.join(root, 'data', 'knowledge.json');
  if (!fs.existsSync(file)) return [];
  
  try {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = [];
    for (const it of obj.items || []) {
      const src = it.source;
      if (!src || !fs.existsSync(src)) continue;
      const text = fs.readFileSync(src, 'utf8').trim();
      if (!text) continue;
      out.push({ 
        document_id: hashId('kb', it.id || src), 
        skill_key: 'common', 
        title: it.title || path.basename(src), 
        source_path: src, 
        text 
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 从 data/flyai-kb/*.json 加载 FlyAI 旅居线路文档（跳过 raw/ 与 seeds.json）
 */
function loadFlyaiKbDocuments(root) {
  const dir = path.join(root, 'data', 'flyai-kb');
  const out = [];
  if (!fs.existsSync(dir)) return out;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith('.json') || name === 'seeds.json') continue;

    const sourcePath = path.join(dir, name);
    try {
      const doc = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
      const linked_route_id = doc?.linked_route_id;
      if (!linked_route_id) continue;
      out.push({
        document_id: `flyai-${linked_route_id}`,
        skill_key: 'travel_route',
        title: doc.title || linked_route_id,
        source_path: sourcePath,
        text: doc.text || '',
        meta: {
          source: 'flyai',
          linked_route_id,
          waypoints: doc.waypoints || [],
        },
      });
    } catch {
      // 单文件损坏时跳过，不阻断启动
    }
  }

  return out;
}

/**
 * 构建种子文档集合
 * 优先级：DEFAULT_DOCUMENTS > 本地知识文档 > 导入的知识 > FlyAI KB
 */
function buildSeedDocuments(root) {
  const docs = [
    ...DEFAULT_DOCUMENTS,
    ...COMMON_POLICY_DOCUMENTS,
    ...loadLocalKnowledgeDocuments(root),
    ...loadImportedKnowledge(root),
    ...loadFlyaiKbDocuments(root),
  ];
  
  return docs;
}

/**
 * 从模型注册表加载启用的嵌入模型。
 * 仅当模型启用且 API Key 可用时返回 { embedModel, embedClient }，否则返回 null（回退到关键词匹配）。
 */
function loadEmbeddingModel(registryPath) {
  try {
    const models = readModelRegistry(registryPath);
    const embedModel = models.find((model) =>
      model && model.model_type === 'embedding' && model.is_active !== false);
    if (!embedModel) return null;
    // 没有可用 API Key 时降级为关键词匹配
    if (!resolveModelApiKey(embedModel)) return null;
    return { embedModel, embedClient: callEmbedding };
  } catch {
    return null;
  }
}

export function createKnowledgeDataService(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const seedDocuments = options.seedDocuments ?? buildSeedDocuments(root);
  const documentStore = options.documentStore ?? createDocumentStore({ seedDocuments });
  const chunkStore = options.chunkStore ?? createChunkStore({ documentStore });
  const embedConfig = options.embedModel === undefined ? loadEmbeddingModel(options.registryPath) : { embedModel: options.embedModel, embedClient: options.embedClient };
  const vectorStore = options.vectorStore ?? createVectorStore({
    ...options,
    ...(embedConfig?.embedModel && embedConfig?.embedClient
      ? { embedModel: embedConfig.embedModel, embedClient: embedConfig.embedClient }
      : {}),
  });
  // 注入本地知识库服务（同步加载，避免对调用方产生 async 影响）
  // FLATTALK_KB_REMOTE_ONLY=1：禁止第二套本地旅居知识，全走 gxy-local-kb
  const remoteOnly = String(process.env.FLATTALK_KB_REMOTE_ONLY || '').trim() === '1';
  const injectedLocalKnowledge = options.localKnowledgeService
    ?? ((options.disableLocalKnowledge || remoteOnly) ? null : getLocalKnowledgeService());
  const remoteAdapter = options.remoteAdapter ?? createRemoteKnowledgeAdapter({
    ...(options.remote ?? {}),
    localKnowledgeService: injectedLocalKnowledge,
  });
  const retriever = options.retriever ?? createKnowledgeRetriever({ chunkStore, vectorStore, remoteAdapter });

  return {
    documentStore,
    chunkStore,
    vectorStore,
    remoteAdapter,
    retriever,
  };
}

export { getLocalKnowledgeService };
