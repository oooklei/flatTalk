import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeFlyaiDoc, extractTitlesFromMarkdown } from '../src/services/flyai/normalize-flyai-doc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('extractTitlesFromMarkdown finds linked spot names', () => {
  const md = '### **[巴马水晶宫](https://router.feizhu.com/x)**\n- **亮点**：溶洞';
  assert.deepEqual(extractTitlesFromMarkdown(md), ['巴马水晶宫']);
});

test('extractTitlesFromMarkdown finds bold links without heading', () => {
  const md = '推荐 **[百鸟岩景区](https://x)** 和 **[赐福湖](https://y)**';
  assert.deepEqual(extractTitlesFromMarkdown(md), ['百鸟岩景区', '赐福湖']);
});

test('normalize merges poi latlng by name', () => {
  const doc = normalizeFlyaiDoc({
    linked_route_id: 'bama_5d4n',
    query: '我想去巴马旅游',
    aiMarkdown: '### **[百鸟岩景区](https://x)**\n',
    poiList: [{ id: '17165738', name: '百鸟岩景区', latitude: '24.23', longitude: '107.12' }],
    products: [{ info: { title: '巴马温泉酒店', jumpUrl: 'https://y' } }],
  });
  assert.equal(doc.waypoints[0].name, '百鸟岩景区');
  assert.equal(doc.waypoints[0].lat, 24.23);
  assert.equal(doc.source, 'flyai');
  assert.ok(doc.content_hash);
});

test('normalize with bama fixtures aligns POI and extracts titles', () => {
  const aiFixture = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/flyai-ai-search-bama.md.json'), 'utf8'),
  );
  const poiFixture = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/flyai-poi-bama.json'), 'utf8'),
  );

  const doc = normalizeFlyaiDoc({
    linked_route_id: 'bama_5d4n',
    query: '我想去巴马旅游',
    aiMarkdown: aiFixture.data,
    poiList: poiFixture.data.itemList,
    products: [{ info: { title: '巴马温泉酒店', jumpUrl: 'https://y', picUrl: 'https://pic' } }],
  });

  const titles = extractTitlesFromMarkdown(aiFixture.data);
  assert.ok(titles.length >= 6);
  assert.equal(doc.waypoints.length, titles.length);
  assert.equal(doc.waypoints[0].name, '巴马仁寿文化源');
  assert.equal(doc.waypoints[0].lat, 24.126306);
  assert.equal(doc.waypoints[2].name, '巴马洞天福地景区');
  assert.equal(doc.waypoints[2].lat, 24.317669);
  assert.equal(doc.products[0].title, '巴马温泉酒店');
  assert.equal(doc.products[0].jumpUrl, 'https://y');
  assert.ok(doc.text.includes('巴马仁寿文化源'));
  assert.ok(doc.title);
});
