import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCity, matchHotCity } from '../src/core/city-extractor/normalize.js';
import { extractCities } from '../src/core/city-extractor/index.js';

test('normalizeCity 景点归一化为城市', () => {
  assert.equal(normalizeCity('涠洲岛'), '北海');
  assert.equal(normalizeCity('银滩'), '北海');
  assert.equal(normalizeCity('亚龙湾'), '三亚');
  assert.equal(normalizeCity('阳朔'), '桂林');
  assert.equal(normalizeCity('龙脊梯田'), '桂林');
});

test('normalizeCity 非景点原样返回', () => {
  assert.equal(normalizeCity('北海'), '北海');
  assert.equal(normalizeCity('防城港'), '防城港');
  assert.equal(normalizeCity('未知地名'), '未知地名');
});

test('matchHotCity 匹配热门城市', () => {
  assert.deepEqual(matchHotCity('想去北海旅居'), ['北海']);
  assert.deepEqual(matchHotCity('防城港和北海'), ['北海']);
});

test('matchHotCity 未命中热门城市返回空数组', () => {
  assert.deepEqual(matchHotCity('想去防城港'), []);
  assert.deepEqual(matchHotCity('帮我规划旅居'), []);
});

test('extractCities 正则命中热门城市不调 LLM', async () => {
  const result = await extractCities({
    message: '想去北海旅居',
    business_data: {},
  });
  assert.equal(result.primary, '北海');
  assert.deepEqual(result.cities, ['北海']);
  assert.equal(result.source, 'regex');
});

test('extractCities 未命中热门城市时调 LLM', async () => {
  const mockLlm = async () => ({
    ok: true,
    content: '{"primary":"防城港","cities":["防城港"],"confidence":0.9}',
  });
  const result = await extractCities({
    message: '想去防城港旅居',
    business_data: {},
  }, { llmCall: mockLlm });
  assert.equal(result.primary, '防城港');
  assert.deepEqual(result.cities, ['防城港']);
  assert.equal(result.source, 'llm');
});

test('extractCities LLM 多城市 + 景点归一化', async () => {
  const mockLlm = async () => ({
    ok: true,
    content: '{"primary":"防城港","cities":["防城港","涠洲岛"],"confidence":0.85}',
  });
  const result = await extractCities({
    message: '想去防城港和涠洲岛',
    business_data: {},
  }, { llmCall: mockLlm });
  assert.equal(result.primary, '防城港');
  assert.deepEqual(result.cities, ['防城港', '北海']);
  assert.equal(result.source, 'llm');
});

test('extractCities LLM 失败降级到正则', async () => {
  const mockLlm = async () => ({ ok: false, error: 'timeout' });
  const result = await extractCities({
    message: '想去北海旅居',
    business_data: {},
  }, { llmCall: mockLlm });
  assert.equal(result.primary, '北海');
  assert.equal(result.source, 'regex');
});

test('extractCities 无城市时返回 null', async () => {
  const mockLlm = async () => ({
    ok: true,
    content: '{"primary":null,"cities":[],"confidence":0.1}',
  });
  const result = await extractCities({
    message: '帮我规划旅居',
    business_data: {},
  }, { llmCall: mockLlm });
  assert.equal(result.primary, null);
  assert.deepEqual(result.cities, []);
  assert.equal(result.source, 'llm');
});

test('extractCities LLM 未配置时走正则', async () => {
  const result = await extractCities({
    message: '桂林天气怎么样',
    business_data: {},
  });
  assert.equal(result.primary, '桂林');
  assert.equal(result.source, 'regex');
});

test('extractCities 从 business_data 的 jtd 产品中提取目的地', async () => {
  const result = await extractCities({
    message: '帮我看看这个产品',
    business_data: { jtd: { selected_product: { destination: '北海' } } },
  });
  assert.equal(result.primary, '北海');
  assert.equal(result.source, 'regex');
});
