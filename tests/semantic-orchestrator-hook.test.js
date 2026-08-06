import test from 'node:test';
import assert from 'node:assert/strict';
import { understandAndAdapt } from '../src/core/semantic/index.js';
import { buildSnapshot } from '../src/core/conversation/context-snapshot.js';

test('snapshot 可携带 semantic 摘要', async () => {
  const semantic = await understandAndAdapt(
    { message: '附近有什么商店' },
    { llmCall: async () => ({ ok: false }) },
  );
  const snap = buildSnapshot({
    skill_key: 'nearby_resource',
    data: {},
    semantic,
  });
  assert.equal(snap.semantic_source, 'rules_fallback');
  assert.ok(snap.semantic_core_need);
  assert.equal(snap.semantic_category, '购');
});
