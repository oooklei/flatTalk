import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertWithinLimit, normalizeInput } from '../src/core/pipeline/input-normalizer.js';

describe('input-normalizer', () => {
  it('rejects over 500 chars', () => {
    const r = assertWithinLimit('啊'.repeat(501));
    assert.equal(r.ok, false);
    assert.equal(r.error, 'text_too_long');
  });
  it('rules path: fullwidth and slang without LLM', async () => {
    const r = await normalizeInput('　旅居綫路　', { llmCall: null });
    assert.equal(r.needs_clarify, false);
    assert.ok(r.normalized_text.includes('旅居'));
  });
  it('uses llm when provided', async () => {
    const r = await normalizeInput('旅居線路易州', {
      llmCall: async () => ({
        content: JSON.stringify({
          normalized_text: '旅居线路北海涠洲',
          fixes: [{ type: 'typo' }],
          needs_clarify: false,
        }),
      }),
    });
    assert.equal(r.normalized_text, '旅居线路北海涠洲');
  });
});
