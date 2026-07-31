import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCity, matchHotCity } from '../src/core/city-extractor/normalize.js';

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
