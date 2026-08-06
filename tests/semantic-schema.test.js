import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySemantic, normalizeSemantic, SEMANTIC_SOURCES } from '../src/core/semantic/schema.js';

test('emptySemantic 默认 source 与空槽', () => {
  const s = emptySemantic('skipped_action');
  assert.equal(s.source, SEMANTIC_SOURCES.SKIPPED_ACTION);
  assert.equal(s.core_need, '');
  assert.equal(s.adapted.category, null);
  assert.deepEqual(s.slots.concept_words, []);
});

test('normalizeSemantic 补齐缺字段并钳制 source', () => {
  const s = normalizeSemantic({ core_need: '查商店', slots: { category_hint: '购' }, source: 'nope' });
  assert.equal(s.core_need, '查商店');
  assert.equal(s.slots.category_hint, '购');
  assert.equal(s.source, SEMANTIC_SOURCES.LLM);
  assert.ok('destination' in s.adapted);
});
