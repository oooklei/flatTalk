import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartFallbackHandler } from '../src/core/fallback/smart-fallback-handler.js';

test('shouldFallback detects fallback_mock status', () => {
  const handler = createSmartFallbackHandler();
  assert.equal(handler.shouldFallback({ model_status: 'fallback_mock' }), true);
  assert.equal(handler.shouldFallback({ model_status: 'ok' }), false);
});

test('shouldFallback detects fallback_common_answer notes', () => {
  const handler = createSmartFallbackHandler();
  assert.equal(
    handler.shouldFallback({ model_status: 'ok', template_fit_notes: ['fallback_common_answer'] }),
    true,
  );
});

test('shouldFallback detects answer_text starting with 抱歉', () => {
  const handler = createSmartFallbackHandler();
  assert.equal(
    handler.shouldFallback({ model_status: 'ok', answer_text: '抱歉，我暂时无法处理' }),
    true,
  );
});

test('generateNaturalAnswer calls LLM with free-answer prompt', async () => {
  let capturedMessages = null;
  const mockModelClient = {
    model: { id: 'test-model', max_tokens: 2000, url: 'http://test', api_key: 'test' },
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '老人一天饮食建议：早餐小米粥配水煮蛋，午餐杂粮饭搭配清蒸鱼。' }),
  };

  const handler = createSmartFallbackHandler({ modelClient: mockModelClient });
  const result = await handler.generateNaturalAnswer({
    message: '按时间线展示老人一天的饮食安排',
    skill_key: 'meal_plan',
    conversation_history: [{ role: 'user', content: '推荐食谱' }],
  });

  assert.ok(result.answer_text.length > 10);
  assert.equal(result.template_id, 'answer');
  assert.equal(result.model_status, 'smart_fallback');
  assert.ok(!result.answer_text.startsWith('抱歉'), 'should not return 抱歉 text');
});

test('generateNaturalAnswer returns scene-aware text on LLM failure', async () => {
  const mockModelClient = {
    model: { id: 'test', max_tokens: 2000, url: 'http://test', api_key: 'test' },
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'error' }),
  };
  const handler = createSmartFallbackHandler({ modelClient: mockModelClient });
  const result = await handler.generateNaturalAnswer({
    message: '推荐老人食谱',
    skill_key: 'meal_plan',
  });
  assert.ok(result.answer_text.length > 0);
  assert.ok(!result.answer_text.startsWith('抱歉'), 'should return scene-aware text not generic 抱歉');
  assert.ok(result.answer_text.includes('膳食') || result.answer_text.includes('饮食'), 'should be meal-scene aware');
});

test('generateNaturalAnswer falls back to common scene when skill_key unknown', async () => {
  const mockModelClient = {
    model: { id: 'test', max_tokens: 2000, url: 'http://test', api_key: 'test' },
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'error' }),
  };
  const handler = createSmartFallbackHandler({ modelClient: mockModelClient });
  const result = await handler.generateNaturalAnswer({
    message: '随便问问',
    skill_key: 'common',
  });
  assert.ok(result.answer_text.length > 0);
});
