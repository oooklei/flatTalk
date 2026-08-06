import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptParams, normalizeCategory } from '../src/core/semantic/adapter.js';

test('normalizeCategory 商店→购', () => {
  assert.equal(normalizeCategory('商店'), '购');
  assert.equal(normalizeCategory('购物'), '购');
  assert.equal(normalizeCategory('医院'), '养');
});

test('adaptParams 从 place/concept 得到 destination', () => {
  const adapted = adaptParams({
    place_candidates: ['防城港'],
    scenic_candidates: [],
    concept_words: [],
    category_hint: null,
    entity_name: null,
    service_type: null,
  });
  assert.equal(adapted.destination, '防城港');
});

test('adaptParams 看海概念映射 destination', () => {
  const adapted = adaptParams({
    place_candidates: [],
    scenic_candidates: [],
    concept_words: ['看海'],
    category_hint: null,
  });
  assert.ok(adapted.destination); // 防城港或北海等滨海映射
});

test('adaptParams category_hint 购', () => {
  const adapted = adaptParams({
    place_candidates: [],
    scenic_candidates: [],
    concept_words: ['商店'],
    category_hint: '购',
  });
  assert.equal(adapted.category, '购');
});

test('adaptParams 商店概念不映射 destination', () => {
  const adapted = adaptParams({
    place_candidates: [],
    scenic_candidates: [],
    concept_words: ['商店'],
    category_hint: '购',
  });
  assert.equal(adapted.destination, null);
  assert.equal(adapted.category, '购');
});
