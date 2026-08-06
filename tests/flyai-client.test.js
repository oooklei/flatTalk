import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlyaiClient } from '../src/services/flyai/flyai-client.js';

test('keywordSearch parses itemList JSON', async () => {
  const client = createFlyaiClient({
    runner: async () => ({
      stdout: JSON.stringify({ data: { itemList: [{ info: { title: '百鸟岩景区' } }] }, status: 'ok' }),
      stderr: '',
      code: 0,
    }),
  });
  const r = await client.keywordSearch('我想去巴马旅游');
  assert.equal(r.ok, true);
  assert.equal(r.data.itemList[0].info.title, '百鸟岩景区');
});

test('parseStdout returns not_json for non-JSON stdout', async () => {
  const client = createFlyaiClient({
    runner: async () => ({
      stdout: 'Error: something went wrong',
      stderr: '',
      code: 1,
    }),
  });
  const r = await client.keywordSearch('test');
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.equal(r.error, 'not_json');
});

test('keywordSearch strips Windows Assertion failed noise after JSON', async () => {
  const payload = { data: { itemList: [{ info: { title: '百鸟岩景区' } }] }, status: 'ok' };
  const client = createFlyaiClient({
    runner: async () => ({
      stdout: `${JSON.stringify(payload)}\nAssertion failed: false`,
      stderr: '',
      code: 0,
    }),
  });
  const r = await client.keywordSearch('我想去巴马旅游');
  assert.equal(r.ok, true);
  assert.equal(r.data.itemList[0].info.title, '百鸟岩景区');
});

test('aiSearch unwraps markdown string from data envelope', async () => {
  const markdown = '### **[巴马水晶宫](https://x)**\n- **亮点**：溶洞';
  const client = createFlyaiClient({
    runner: async () => ({
      stdout: JSON.stringify({ data: markdown, status: 'ok' }),
      stderr: '',
      code: 0,
    }),
  });
  const r = await client.aiSearch('我想去巴马旅游');
  assert.equal(r.ok, true);
  assert.equal(r.data, markdown);
});

test('searchPoi passes keyword and cityName args', async () => {
  let capturedArgs;
  const client = createFlyaiClient({
    runner: async (args) => {
      capturedArgs = args;
      return {
        stdout: JSON.stringify({ data: { poiList: [{ name: '百鸟岩景区' }] }, status: 'ok' }),
        stderr: '',
        code: 0,
      };
    },
  });
  const r = await client.searchPoi({ keyword: '百鸟岩', cityName: '河池' });
  assert.equal(r.ok, true);
  assert.equal(r.data.poiList[0].name, '百鸟岩景区');
  assert.deepEqual(capturedArgs, ['search-poi', '--keyword', '百鸟岩', '--city-name', '河池']);
});
