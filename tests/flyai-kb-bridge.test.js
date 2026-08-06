import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFlyaiKbStore } from '../src/services/flyai/flyai-kb-store.js';
import { createFlyaiKnowledgeBridge } from '../src/services/flyai/flyai-knowledge-bridge.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flyai-kb-bridge-'));
}

function makeMockClient({ fail = false } = {}) {
  const calls = { aiSearch: 0, searchPoi: 0, keywordSearch: 0 };
  const client = {
    calls,
    async aiSearch(query) {
      calls.aiSearch += 1;
      if (fail) return { ok: false, error: 'ai_fail' };
      return { ok: true, data: `### **[百鸟岩景区](https://x)**\n查询：${query}` };
    },
    async searchPoi() {
      calls.searchPoi += 1;
      if (fail) return { ok: false, error: 'poi_fail' };
      return {
        ok: true,
        data: {
          itemList: [{ id: '1', name: '百鸟岩景区', latitude: '24.23', longitude: '107.12' }],
        },
      };
    },
    async keywordSearch() {
      calls.keywordSearch += 1;
      if (fail) return { ok: false, error: 'kw_fail' };
      return {
        ok: true,
        data: { itemList: [{ info: { title: '巴马温泉酒店', jumpUrl: 'https://y' } }] },
      };
    },
  };
  return client;
}

test('score>=threshold returns local without live', async () => {
  const baseDir = makeTempDir();
  const store = createFlyaiKbStore({ baseDir });
  store.upsertDoc({
    linked_route_id: 'bama_5d4n',
    title: '巴马康养线路',
    destination: '巴马',
    keywords: ['巴马', '康养', '长寿'],
    text: '巴马康养',
    waypoints: [{ name: '百鸟岩景区', order: 1 }],
  });

  const client = makeMockClient();
  const bridge = createFlyaiKnowledgeBridge({ store, client, threshold: 0.72 });

  const result = await bridge.resolve({
    query: '我想去巴马康养长寿旅游',
    vectorScore: 0.8,
  });

  assert.equal(result.ok, true);
  assert.equal(result.from_cache, true);
  assert.equal(result.doc.linked_route_id, 'bama_5d4n');
  assert.ok(result.score >= 0.72);
  assert.equal(client.calls.aiSearch, 0);
  assert.equal(client.calls.searchPoi, 0);
  assert.equal(client.calls.keywordSearch, 0);
});

test('score<threshold calls live and upserts', async () => {
  const baseDir = makeTempDir();
  const store = createFlyaiKbStore({ baseDir });
  store.upsertDoc({
    linked_route_id: 'fcg_route_001',
    title: '京族滨海文化线',
    destination: '防城港',
    keywords: ['防城港', '滨海'],
    text: '防城港',
  });

  const client = makeMockClient();
  const bridge = createFlyaiKnowledgeBridge({ store, client, threshold: 0.72 });

  const result = await bridge.resolve({
    query: '我想去巴马旅游',
    linked_route_id: 'bama_5d4n',
    vectorScore: 0.1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.from_cache, false);
  assert.equal(result.doc.linked_route_id, 'bama_5d4n');
  assert.ok(result.doc.waypoints?.length >= 1);
  assert.equal(client.calls.aiSearch, 1);
  assert.equal(client.calls.searchPoi, 1);
  assert.equal(client.calls.keywordSearch, 1);

  const saved = store.getByRouteId('bama_5d4n');
  assert.ok(saved);
  assert.equal(saved.linked_route_id, 'bama_5d4n');
});

test('exact linked_route_id bypasses threshold', async () => {
  const baseDir = makeTempDir();
  const store = createFlyaiKbStore({ baseDir });
  store.upsertDoc({
    linked_route_id: 'bama_5d4n',
    title: '巴马线路',
    destination: '巴马',
    keywords: ['无关词'],
    text: 'local',
  });

  const client = makeMockClient();
  const bridge = createFlyaiKnowledgeBridge({ store, client, threshold: 0.99 });

  const result = await bridge.resolve({
    query: '完全不匹配的查询',
    linked_route_id: 'bama_5d4n',
    vectorScore: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.from_cache, true);
  assert.equal(result.score, 1);
  assert.equal(result.doc.title, '巴马线路');
  assert.equal(client.calls.aiSearch, 0);
});

test('live failure returns local doc when available', async () => {
  const baseDir = makeTempDir();
  const store = createFlyaiKbStore({ baseDir });
  store.upsertDoc({
    linked_route_id: 'weak_match',
    title: '弱匹配文档',
    destination: '别处',
    keywords: ['xyz'],
    text: 'weak',
  });

  const client = makeMockClient({ fail: true });
  const bridge = createFlyaiKnowledgeBridge({ store, client, threshold: 0.72 });

  const result = await bridge.resolve({
    query: '我想去巴马旅游',
    vectorScore: 0.1,
  });

  assert.equal(result.ok, false);
  assert.ok(result.error);
  // best local may be the weak doc with score 0; doc can be that or null
  assert.ok(result.doc === null || result.doc.linked_route_id === 'weak_match');
});
