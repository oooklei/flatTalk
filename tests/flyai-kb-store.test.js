import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFlyaiKbStore } from '../src/services/flyai/flyai-kb-store.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flyai-kb-store-'));
}

test('upsertDoc writes route json and raw snapshot', () => {
  const baseDir = makeTempDir();
  const store = createFlyaiKbStore({ baseDir });

  const result = store.upsertDoc({
    linked_route_id: 'bama_5d4n',
    title: '巴马旅游推荐',
    destination: '巴马',
    keywords: ['巴马', '康养'],
    waypoints: [{ name: '百鸟岩景区', order: 1 }],
    content_hash: 'abc',
  });

  assert.ok(fs.existsSync(result.path));
  assert.ok(fs.existsSync(result.rawPath));
  assert.equal(result.doc.linked_route_id, 'bama_5d4n');
  assert.ok(result.doc.raw_path.startsWith('raw/'));

  const loaded = store.getByRouteId('bama_5d4n');
  assert.equal(loaded.title, '巴马旅游推荐');
  assert.equal(store.listDocs().length, 1);
});

test('getByKeyword scans keywords title and destination', () => {
  const baseDir = makeTempDir();
  const store = createFlyaiKbStore({ baseDir });

  store.upsertDoc({
    linked_route_id: 'bama_5d4n',
    title: '巴马康养线路',
    destination: '巴马',
    keywords: ['巴马', '康养'],
  });
  store.upsertDoc({
    linked_route_id: 'fcg_route_001',
    title: '京族滨海文化线',
    destination: '防城港',
    keywords: ['防城港', '滨海'],
  });

  const hits = store.getByKeyword('巴马');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].linked_route_id, 'bama_5d4n');

  const coastal = store.getByKeyword('滨海');
  assert.equal(coastal.length, 1);
  assert.equal(coastal[0].linked_route_id, 'fcg_route_001');
});
