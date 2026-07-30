import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createDataService } from '../src/services/data-service.js';
import { createRagService } from '../src/services/rag-service.js';

const projectRoot = process.cwd();

test('table data service supports meal_plan table reads and CRUD', async () => {
  const dataService = createDataService();
  const tables = await dataService.tableData.getMealPlanTables();

  assert.equal(tables.elder_profile.elder_id, 'demo_elder_1');
  assert.ok(tables.meal_rules.length > 0);

  const created = await dataService.tableData.repository.create('meal_rules', {
    key: 'soft_food',
    text: '吞咽困难老人应优先选择软烂食物。',
  });
  assert.equal(created.key, 'soft_food');

  const updated = await dataService.tableData.repository.update('meal_rules', 'soft_food', {
    text: '软烂食物应避免带刺和坚硬颗粒。',
  });
  assert.equal(updated.text, '软烂食物应避免带刺和坚硬颗粒。');
  assert.equal(await dataService.tableData.repository.remove('meal_rules', 'soft_food'), true);
});

test('table data repository protects nested state from caller mutation', async () => {
  const dataService = createDataService();
  const firstRead = await dataService.tableData.repository.get('elder_profile', 'demo_elder_1');
  firstRead.conditions.push('mutated');

  const secondRead = await dataService.tableData.repository.get('elder_profile', 'demo_elder_1');
  assert.deepEqual(secondRead.conditions, ['糖尿病']);
});

test('knowledge data service retrieves meal_plan knowledge chunks', async () => {
  const dataService = createDataService();
  const ragService = createRagService({ knowledgeData: dataService.knowledgeData });
  const result = await ragService.retrieveMealPlanKnowledge({ query: '糖尿病 精制碳水', limit: 2 });

  assert.equal(result.skill_key, 'meal_plan');
  assert.ok(result.matches.length >= 1);
  assert.ok(result.matches[0].text.includes('糖尿病'));
});

test('knowledge document store protects nested metadata from caller mutation', async () => {
  const dataService = createDataService({
    knowledgeData: {
      seedDocuments: [
        {
          document_id: 'doc_nested',
          skill_key: 'meal_plan',
          title: 'nested',
          text: '糖尿病 控糖',
          metadata: { tags: ['diabetes'] },
        },
      ],
    },
  });

  const firstRead = await dataService.knowledgeData.documentStore.get('doc_nested');
  firstRead.metadata.tags.push('mutated');

  const secondRead = await dataService.knowledgeData.documentStore.get('doc_nested');
  assert.deepEqual(secondRead.metadata.tags, ['diabetes']);

  const upserted = await dataService.knowledgeData.documentStore.upsert({
    document_id: 'doc_nested',
    skill_key: 'meal_plan',
    title: 'nested updated',
    text: '糖尿病 控糖',
    metadata: { tags: ['updated'] },
  });
  upserted.metadata.tags.push('caller_mutated');

  const thirdRead = await dataService.knowledgeData.documentStore.get('doc_nested');
  assert.deepEqual(thirdRead.metadata.tags, ['updated']);
});

test('knowledge data service accepts injected stores for future vector backend swap', async () => {
  const calls = [];
  const knowledgeData = createDataService({
    knowledgeData: {
      chunkStore: {
        async listBySkill(skillKey) {
          calls.push(['chunkStore', skillKey]);
          return [{ chunk_id: 'custom#1', skill_key: skillKey, title: 'custom', text: 'custom vector text' }];
        },
      },
      vectorStore: {
        async search({ query, chunks, limit }) {
          calls.push(['vectorStore', query, limit]);
          return chunks;
        },
      },
    },
  }).knowledgeData;

  const result = await knowledgeData.retriever.retrieve({ skill_key: 'meal_plan', query: 'custom', limit: 1 });
  assert.deepEqual(calls, [['chunkStore', 'meal_plan'], ['vectorStore', 'custom', 1]]);
  assert.equal(result.matches[0].chunk_id, 'custom#1');
});

test('knowledge data service uses remote knowledge adapter when configured', async () => {
  const dataService = createDataService({
    knowledgeData: {
      remoteAdapter: {
        enabled: true,
        search: async ({ skill_key, query, limit, filters }) => ({
          ok: true,
          status: 'remote_hit',
          source: 'remote_knowledge',
          skill_key,
          matches: [{ chunk_id: 'remote#1', skill_key, title: query, text: filters.role_key, score: 0.9 }],
        }),
      },
    },
  });

  const result = await dataService.knowledgeData.retriever.retrieve({
    skill_key: 'meal_plan',
    query: 'remote query',
    limit: 1,
    filters: { role_key: 'elder_family' },
  });

  assert.equal(result.source, 'remote_knowledge');
  assert.equal(result.status, 'remote_hit');
  assert.equal(result.matches[0].chunk_id, 'remote#1');
  assert.equal(result.matches[0].text, 'elder_family');
});

test('knowledge data service falls back to local knowledge when remote fails', async () => {
  const dataService = createDataService({
    knowledgeData: {
      seedDocuments: [
        {
          document_id: 'doc_remote_fallback',
          skill_key: 'meal_plan',
          title: 'fallback',
          text: 'remote fallback diabetes breakfast',
        },
      ],
      remoteAdapter: {
        enabled: true,
        search: async () => ({
          ok: false,
          status: 'remote_failed',
          error: 'network down',
          matches: [],
        }),
      },
    },
  });

  const result = await dataService.knowledgeData.retriever.retrieve({
    skill_key: 'meal_plan',
    query: 'diabetes breakfast',
    limit: 1,
  });

  assert.equal(result.source, 'flatTalk_knowledge_data_fallback');
  assert.equal(result.status, 'remote_failed');
  assert.equal(result.remote_error, 'network down');
  assert.equal(result.matches[0].chunk_id, 'doc_remote_fallback#0');
});

test('remote knowledge adapter routes meal_plan and default collections separately', async () => {
  const calls = [];
  const dataService = createDataService({
    knowledgeData: {
      remote: {
        baseUrl: 'http://knowledge.test',
        searchPath: '/api/knowledge/query',
        mealPlanCollections: '膳食知识库',
        defaultCollections: '广西养老办事指引知识库,广西养老政策知识库',
        fetchImpl: async (url, init) => {
          const body = JSON.parse(init.body);
          calls.push({ url, body });
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: [{ id: `${body.collection}-1`, content: `${body.collection} hit`, score: 0.9 }],
            }),
          };
        },
      },
    },
  });

  const meal = await dataService.knowledgeData.retriever.retrieve({
    skill_key: 'meal_plan',
    query: '早餐',
    limit: 3,
  });
  const common = await dataService.knowledgeData.retriever.retrieve({
    skill_key: 'common',
    query: '护理补贴',
    limit: 3,
  });

  assert.deepEqual(calls.map((call) => call.body.collection), [
    '膳食知识库',
    '广西养老办事指引知识库',
    '广西养老政策知识库',
  ]);
  assert.equal(meal.collections[0], '膳食知识库');
  assert.deepEqual(common.collections, ['广西养老办事指引知识库', '广西养老政策知识库']);
});

test('interface data service exposes mock tag profile adapter and HTTP skipped state', async () => {
  const dataService = createDataService({
    interfaceData: {
      tagSystem: {
        profileByEntity: {
          elder_1: { entity_id: 'elder_1', tags: [{ tag_code: 'diabetes' }] },
        },
      },
    },
  });

  const profile = await dataService.interfaceData.tagSystem.getEntityProfile('elder_1');
  assert.equal(profile.ok, true);
  assert.equal(profile.source_status, 'mock');
  assert.equal(profile.data.tags[0].tag_code, 'diabetes');

  const httpResult = await dataService.interfaceData.httpClient.post('/ping', {});
  assert.equal(httpResult.skipped, true);
  assert.equal(httpResult.error, 'http_base_url_not_configured');
});

test('interface data service protects mock tag profile from caller mutation', async () => {
  const dataService = createDataService({
    interfaceData: {
      tagSystem: {
        profileByEntity: {
          elder_2: { entity_id: 'elder_2', tags: [{ tag_code: 'diabetes' }] },
        },
      },
    },
  });

  const firstRead = await dataService.interfaceData.tagSystem.getEntityProfile('elder_2');
  firstRead.data.tags.push({ tag_code: 'mutated' });

  const secondRead = await dataService.interfaceData.tagSystem.getEntityProfile('elder_2');
  assert.deepEqual(secondRead.data.tags, [{ tag_code: 'diabetes' }]);
});

test('interface data service accepts injected adapters', async () => {
  const dataService = createDataService({
    interfaceData: {
      httpClient: { post: async () => ({ ok: true, data: { injected: true } }) },
      tagSystemAdapter: { getEntityProfile: async () => ({ ok: true, data: { injected: true } }) },
    },
  });

  assert.deepEqual(await dataService.interfaceData.httpClient.post('/x'), { ok: true, data: { injected: true } });
  assert.deepEqual(await dataService.interfaceData.tagSystem.getEntityProfile('x'), {
    ok: true,
    data: { injected: true },
  });
});

test('runtime facades do not import copied source modules', async () => {
  const service = await import('../src/services/data-service.js');
  assert.equal(typeof service.createDataService, 'function');
});

test('runtime service source files do not reference copied source directory', () => {
  const serviceFiles = collectRuntimeServiceFiles(path.join(projectRoot, 'src', 'services'));

  for (const file of serviceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('_copied-source'), false, file);
    assert.equal(/guixiaoyang-chat-system|nuwax|code[_-]?plugin/i.test(content), false, file);
  }
});

test('copied source audit files exist but are isolated from runtime scan', () => {
  const copiedRoot = path.join(projectRoot, 'src', 'services', '_copied-source');
  assert.equal(fs.existsSync(copiedRoot), true);
  assert.ok(collectFiles(copiedRoot).length >= 1);
});

function collectRuntimeServiceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_copied-source') continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRuntimeServiceFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}
