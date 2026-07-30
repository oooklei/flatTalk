import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyIntent } from '../src/core/intent-classifier/index.js';

test('classifyIntent detects meal health intent and entities', async () => {
  const result = await classifyIntent({ text: '糖尿病老人早餐怎么吃' });

  assert.equal(result.intent_type, 'HEALTH');
  assert.equal(result.urgency_level, 'P1');
  assert.equal(result.entities.symptom, null);
  assert.ok(result.confidence >= 0.7);
});

test('classifyIntent bypasses to SOS for emergency text', async () => {
  const result = await classifyIntent({ text: '老人胸痛喘不过气，快点救命' });

  assert.equal(result.intent_type, 'SOS');
  assert.equal(result.urgency_level, 'P0');
  assert.equal(result.classification_path, 'emergency_bypass');
  assert.ok(result.keyword_match.length > 0);
});

test('classifyIntent uses TextCNN fallback when BERT confidence is low', async () => {
  const calls = [];
  const result = await classifyIntent({ text: '我想找清洁服务' }, {
    intentModelClient: {
      isConfigured: () => true,
      classifyWithBert: async () => {
        calls.push('bert');
        return { intent_type: 'CHAT', confidence: 0.62, model_used: 'BERT-base' };
      },
      classifyWithTextCnn: async () => {
        calls.push('textcnn');
        return { intent_type: 'SERVICE', confidence: 0.78, model_used: 'TextCNN' };
      },
      extractEntities: async () => ({ service_type: '清洁服务' }),
    },
  });

  assert.deepEqual(calls, ['bert', 'textcnn']);
  assert.equal(result.intent_type, 'SERVICE');
  assert.equal(result.model_used, 'TextCNN');
  assert.deepEqual(result.model_path, ['BERT-base', 'TextCNN']);
  assert.equal(result.entities.service_type, '清洁服务');
});

test('classifyIntent falls back to rules when intent models fail', async () => {
  const result = await classifyIntent({ text: '推荐今日膳食' }, {
    intentModelClient: {
      isConfigured: () => true,
      classifyWithBert: async () => {
        throw new Error('bert down');
      },
      classifyWithTextCnn: async () => {
        throw new Error('textcnn down');
      },
    },
  });

  assert.equal(result.intent_type, 'HEALTH');
  assert.equal(result.model_used, 'rules');
  assert.ok(result.model_path.some((item) => item.includes('BERT-base:error')));
  assert.ok(result.model_path.some((item) => item.includes('TextCNN:error')));
  assert.ok(result.model_path.includes('rules_fallback'));
});

test('classifyIntent treats travel route planning as service intent', async () => {
  const result = await classifyIntent({
    text: '\u6211\u60f3\u53bb\u767e\u8272\u5df4\u9a6c\u65c5\u6e38\uff0c\u8bf7\u5e2e\u89c4\u5212\u8def\u7ebf',
  });

  assert.equal(result.intent_type, 'SERVICE');
  assert.equal(result.urgency_level, 'P1');
  assert.ok(result.confidence >= 0.7);
});

test('classifyIntent treats short travel planning request as service intent', async () => {
  const result = await classifyIntent({
    text: '\u5e2e\u6211\u89c4\u5212\u65c5\u5c45\u8def\u7ebf',
  });

  assert.equal(result.intent_type, 'SERVICE');
  assert.equal(result.urgency_level, 'P1');
  assert.ok(result.confidence >= 0.7);
});

test('classifyIntent returns ambiguous for low ASR confidence', async () => {
  const result = await classifyIntent({
    text: '我想要那个',
    asr_confidence: 0.42,
  });

  assert.equal(result.intent_type, 'AMBIGUOUS');
  assert.equal(result.needs_clarification, true);
  assert.equal(result.classification_path, 'clarification');
});
