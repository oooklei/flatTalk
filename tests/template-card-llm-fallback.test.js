import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateCardModelService } from '../src/core/model-runtime/template-card-llm-service.js';

function makeTestModel() {
  return {
    id: 'test-model',
    model_id: 'test-model',
    api_base: 'http://test.local/v1',
    api_key: 'test-key',
    max_tokens: 800,
    temperature: 0.3,
  };
}

test('fillFallback: 无可用模型（mock 模式）返回兜底说明', async () => {
  const svc = createTemplateCardModelService({ runtimeMode: 'test' });
  const res = await svc.fillFallback({ prompt: '测试提示词', template_id: 'route_card' });
  assert.equal(res.model_status, 'fallback_mock');
  assert.ok(res.answer_text.includes('兜底'), '兜底说明应包含「兜底」字样');
  assert.equal(res.template_id, 'route_card');
});

test('fillFallback: 注入 testModel 时走真实 LLM 通道', async () => {
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: '测试标题', summary: '测试摘要', points: ['要点1'], risks: [], suggestions: ['建议1'],
      }) } }],
    }),
  });
  const svc = createTemplateCardModelService({ runtimeMode: 'test' });
  svc.testModel = makeTestModel();
  const res = await svc.fillFallback({ prompt: '测试提示词', template_id: 'route_card', fetchImpl: fakeFetch });
  assert.equal(res.model_status, 'ok');
  assert.equal(res.template_id, 'route_card');
  assert.ok(res.data && res.data.title === '测试标题', '应解析模型 JSON 并落到 data');
});

test('fillFallback: 模型返回非 JSON 时降级为兜底说明', async () => {
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ choices: [{ message: { content: '这不是合法 JSON' } }] }),
  });
  const svc = createTemplateCardModelService({ runtimeMode: 'test' });
  svc.testModel = makeTestModel();
  const res = await svc.fillFallback({ prompt: '测试提示词', template_id: 'route_card', fetchImpl: fakeFetch });
  assert.equal(res.model_status, 'fallback_mock');
  assert.ok(res.answer_text.includes('兜底'));
});
