import test from 'node:test';
import assert from 'node:assert/strict';
import { understandAndAdapt, shouldSkipEnrichment } from '../src/core/semantic/index.js';
import { SEMANTIC_SOURCES } from '../src/core/semantic/schema.js';

test('shouldSkipEnrichment：action / followup 跳过', () => {
  assert.equal(shouldSkipEnrichment({ action: 'x' }), true);
  assert.equal(shouldSkipEnrichment({ context: { followup_source: 'tight' }, skill_key: 'nearby_resource' }), true);
  assert.equal(shouldSkipEnrichment({ message: '附近有什么商店' }), false);
});

test('understandAndAdapt：skip 不调 llmCall', async () => {
  let called = 0;
  const s = await understandAndAdapt(
    { action: 'foo', message: '附近有什么商店' },
    { llmCall: async () => { called += 1; return { ok: true, content: '{}' }; } },
  );
  assert.equal(called, 0);
  assert.equal(s.source, SEMANTIC_SOURCES.SKIPPED_ACTION);
});

test('understandAndAdapt：mock LLM 产出 category', async () => {
  const s = await understandAndAdapt(
    { message: '附近有什么商店' },
    {
      llmCall: async () => ({
        ok: true,
        content: JSON.stringify({
          core_need: '用户想查附近商店',
          place_candidates: [],
          scenic_candidates: [],
          concept_words: ['附近', '商店'],
          category_hint: '购',
          entity_name: null,
          service_type: null,
          time: null,
        }),
      }),
    },
  );
  assert.equal(s.source, SEMANTIC_SOURCES.LLM);
  assert.equal(s.adapted.category, '购');
  assert.ok(s.core_need.includes('商店') || s.core_need.includes('附近'));
});

test('understandAndAdapt：LLM 失败走 rules_fallback', async () => {
  const s = await understandAndAdapt(
    { message: '附近有什么商店' },
    { llmCall: async () => ({ ok: false, error: 'timeout' }), timeoutMs: 50 },
  );
  assert.equal(s.source, SEMANTIC_SOURCES.RULES_FALLBACK);
  assert.equal(s.adapted.category, '购');
});
