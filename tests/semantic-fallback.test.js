import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFallback } from '../src/core/semantic/fallback.js';
import { SEMANTIC_SOURCES } from '../src/core/semantic/schema.js';

test('附近有什么商店 → category 购 + rules_fallback', () => {
  const s = rulesFallback('附近有什么商店');
  assert.equal(s.source, SEMANTIC_SOURCES.RULES_FALLBACK);
  assert.ok(s.core_need.includes('商店') || s.core_need.includes('附近'));
  assert.equal(s.adapted.category, '购');
  assert.equal(s.adapted.destination, null);
  assert.equal(s.confidence, 0.45);
  assert.ok(s.slots.concept_words.includes('附近'));
  assert.ok(s.slots.concept_words.length > 0);
});

test('想去防城港旅居 → destination 防城港', () => {
  const s = rulesFallback('想去防城港旅居');
  assert.equal(s.adapted.destination, '防城港');
});
