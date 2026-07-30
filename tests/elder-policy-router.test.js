import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyIntent } from '../src/core/intent-classifier/index.js';
import { identifyScene } from '../src/core/scene-router/index.js';
import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';

test('养老政策问题命中政策咨询卡片', async () => {
  const intent = await classifyIntent({ text: '老人有什么养老政策' });
  const scene = identifyScene({ text: '老人有什么养老政策', role: 'elder_family', intent_context: intent });
  const result = await runLocalSkill({
    message: '老人有什么养老政策',
    role: 'elder_family',
  });

  assert.equal(intent.intent_type, 'SERVICE');
  assert.equal(scene.scene_key, 'common');
  assert.equal(scene.intent, 'elder_policy_consult');
  assert.equal(scene.decision, 'accept');
  assert.equal(result.template_id, 'policy_card');
  assert.equal(result.debug.knowledge_status, 'local_hit');
  assert.ok(result.evidence.length > 0);
  assert.deepEqual(result.actions, []);
  assert.ok(result.followup_suggestions.some((item) => item.label === '查询补贴条件'));
  assert.ok(result.card.pages[0].includes('养老政策咨询'));
  assert.ok(result.card.pages[0].includes('高龄津贴'));
});

test('养老助手使用问题命中使用指引卡片', async () => {
  const intent = await classifyIntent({ text: '养老助手怎么用?' });
  const scene = identifyScene({ text: '养老助手怎么用?', role: 'elder_family', intent_context: intent });
  const result = await runLocalSkill({
    message: '养老助手怎么用?',
    role: 'elder_family',
  });

  assert.equal(intent.intent_type, 'SERVICE');
  assert.equal(scene.scene_key, 'common');
  assert.equal(scene.intent, 'elder_assistant_usage');
  assert.equal(scene.decision, 'accept');
  assert.equal(result.template_id, 'policy_card');
  assert.deepEqual(result.actions, []);
  assert.ok(result.followup_suggestions.some((item) => item.label === '整理办理材料'));
  assert.ok(result.card.pages[0].includes('桂小养养老助手'));
  assert.ok(result.card.pages[0].includes('查政策'));
});
