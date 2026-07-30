import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createDocumentStore, DEFAULT_DOCUMENTS } from './document-store.js';
import { createChunkStore } from './chunk-store.js';
import { createVectorStore } from './vector-store.js';
import { createKnowledgeRetriever } from './retriever.js';
import { createRemoteKnowledgeAdapter } from './remote-knowledge-adapter.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(moduleDir, '../../..');

function hashId(prefix, value) {
  return `${prefix}-${crypto.createHash('md5').update(value).digest('hex').slice(0, 10)}`;
}

function readMarkdownDocs(dir, skillKey) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.name.endsWith('.md')) continue;
      if (entry.name === 'INDEX.md' || entry.name.startsWith('_') || entry.name === 'vectorization_plan.md') continue;
      const text = fs.readFileSync(p, 'utf8').trim();
      if (!text) continue;
      const heading = text.split('\n').find((l) => l.startsWith('#'));
      const title = heading ? heading.replace(/^#+\s*/, '') : entry.name.replace(/\.md$/, '');
      out.push({ document_id: hashId('policy', p), skill_key: skillKey, title, source_path: p, text });
    }
  };
  walk(dir);
  return out;
}

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
      out.push({ document_id: hashId('kb', it.id || src), skill_key: 'common', title: it.title || path.basename(src), source_path: src, text });
    }
    return out;
  } catch {
    return [];
  }
}

function buildSeedDocuments(root) {
  const policyRoot = path.join(root, 'assets', 'source-copies', 'skill-packages', 'guixiaoyang_dispatch', 'knowledge_docs');
  const docs = [
    ...readMarkdownDocs(path.join(policyRoot, 'business'), 'common'),
    ...readMarkdownDocs(path.join(policyRoot, 'dialogue'), 'common'),
    ...readMarkdownDocs(path.join(policyRoot, 'trace_route'), 'trace_route'),
    ...readMarkdownDocs(path.join(root, 'assets', 'source-copies', 'skill-packages', 'health_risk_warning', 'knowledge_docs', 'business'), 'health_risk_warning'),
    ...readMarkdownDocs(path.join(root, 'assets', 'source-copies', 'skill-packages', 'health_risk_warning', 'knowledge_docs', 'dialogue'), 'health_risk_warning'),
    ...loadImportedKnowledge(root),
  ];
  return [...DEFAULT_DOCUMENTS, ...docs];
}

export function createKnowledgeDataService(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const seedDocuments = options.seedDocuments ?? buildSeedDocuments(root);
  const documentStore = options.documentStore ?? createDocumentStore({ seedDocuments });
  const chunkStore = options.chunkStore ?? createChunkStore({ documentStore });
  const vectorStore = options.vectorStore ?? createVectorStore(options);
  const remoteAdapter = options.remoteAdapter ?? createRemoteKnowledgeAdapter(options.remote ?? {});
  const retriever = options.retriever ?? createKnowledgeRetriever({ chunkStore, vectorStore, remoteAdapter });

  return {
    documentStore,
    chunkStore,
    vectorStore,
    remoteAdapter,
    retriever,
  };
}
