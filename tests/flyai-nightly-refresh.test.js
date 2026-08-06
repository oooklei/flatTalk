import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFlyaiKbStore } from '../src/services/flyai/flyai-kb-store.js';
import {
  refreshOneDoc,
  shouldSkipRefresh,
} from '../scripts/flyai-nightly-refresh.mjs';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flyai-nightly-'));
}

function makeMockClient(markdown = '### **[百鸟岩景区](https://x)**\n') {
  return {
    async aiSearch() {
      return { ok: true, data: markdown };
    },
    async searchPoi() {
      return {
        ok: true,
        data: {
          itemList: [{ id: '1', name: '百鸟岩景区', latitude: '24.23', longitude: '107.12' }],
        },
      };
    },
    async keywordSearch() {
      return {
        ok: true,
        data: { itemList: [{ info: { title: '巴马温泉酒店', jumpUrl: 'https://y' } }] },
      };
    },
  };
}

test('shouldSkipRefresh returns true when hashes match', () => {
  assert.equal(shouldSkipRefresh('abc', 'abc'), true);
  assert.equal(shouldSkipRefresh('abc', 'def'), false);
  assert.equal(shouldSkipRefresh(null, 'def'), false);
});

test('refreshOneDoc skips upsert when content_hash unchanged', async () => {
  const baseDir = makeTempDir();
  const store = createFlyaiKbStore({ baseDir });
  const client = makeMockClient();
  const seed = {
    linked_route_id: 'bama_5d4n',
    destination: '巴马',
    city_name: '河池',
    keywords: ['巴马', '康养'],
    query: '我想去巴马旅游',
  };

  const first = await refreshOneDoc({
    client,
    store,
    existingDoc: { linked_route_id: 'bama_5d4n' },
    seed,
  });
  assert.equal(first.action, 'updated');
  assert.ok(first.content_hash);

  const existing = store.getByRouteId('bama_5d4n');
  const second = await refreshOneDoc({
    client,
    store,
    existingDoc: existing,
    seed,
  });

  assert.equal(second.action, 'skipped');
  assert.equal(second.content_hash, first.content_hash);
  assert.equal(store.listDocs().length, 1);
});

test('refreshOneDoc updates when fetched content changes', async () => {
  const baseDir = makeTempDir();
  const store = createFlyaiKbStore({ baseDir });
  const seed = {
    linked_route_id: 'bama_5d4n',
    destination: '巴马',
    city_name: '河池',
    keywords: ['巴马', '康养'],
    query: '我想去巴马旅游',
  };

  const first = await refreshOneDoc({
    client: makeMockClient('### **[百鸟岩景区](https://x)**\n'),
    store,
    existingDoc: { linked_route_id: 'bama_5d4n' },
    seed,
  });
  assert.equal(first.action, 'updated');

  const existing = store.getByRouteId('bama_5d4n');
  const second = await refreshOneDoc({
    client: makeMockClient('### **[水晶宫](https://x)**\n'),
    store,
    existingDoc: existing,
    seed,
  });

  assert.equal(second.action, 'updated');
  assert.notEqual(second.content_hash, first.content_hash);
});
