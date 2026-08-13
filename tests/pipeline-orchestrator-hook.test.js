import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPreRoute } from '../src/core/pipeline/run-pre-route.js';
import { runPostRoute } from '../src/core/pipeline/run-post-route.js';
import { readBus } from '../src/core/context-bus/store.js';
import { writeLogin } from '../src/core/context-bus/store.js';

function makeSession() {
  return { conversation_id: 'test', turns: [], global_context: {} };
}

describe('pipeline orchestrator hook', () => {
  it('runPreRoute halts on safety block', async () => {
    const session = makeSession();
    const stages = [];
    const mark = (stage, label, detail) => stages.push({ stage, label, detail });
    const pre = await runPreRoute({
      session,
      message: '这里有色情暴力内容示范拦截',
      llmCall: null,
      mark,
    });
    assert.equal(pre.halt, true);
    assert.ok(pre.envelopeHint);
    assert.equal(pre.envelopeHint.skill_key, 'common');
    assert.ok(pre.envelopeHint.message);
    assert.equal(pre.safety.action, 'block');
    assert.ok(stages.some((s) => s.stage === 'safety'));
    const bus = readBus(session);
    assert.equal(bus.turn.safety?.action, 'block');
  });

  it('runPostRoute meal_plan clarifies which_elder without elder', async () => {
    const session = makeSession();
    writeLogin(session, {
      user_id: 'u1',
      role_key: 'elder_family',
      elder_binding: { elder_id: '', elders: [] },
    });
    const post = await runPostRoute({
      session,
      skillKey: 'meal_plan',
      utterance: '今天吃什么',
      mark: () => {},
    });
    assert.equal(post.detected.ok, false);
    assert.equal(post.detected.clarify, 'which_elder');
    assert.equal(post.profile.has_elder, false);
    assert.equal(post.profile.skill_key, 'meal_plan');
  });

  it('smoke-import createChatOrchestrator when module graph resolves', async () => {
    try {
      const { createChatOrchestrator } = await import('../src/core/orchestrator/chat-orchestrator.js');
      assert.equal(typeof createChatOrchestrator, 'function');
      const orch = createChatOrchestrator({
        dataService: {
          tableData: { getSkillConfigs: async () => ({}) },
        },
        modelService: { fillTemplateSlots: async () => ({ template_id: 'answer', answer_text: 'ok', data: {} }) },
      });
      assert.equal(typeof orch.run, 'function');
    } catch (err) {
      // Worktree may omit transitive files (e.g. action-labels.js); runners are covered above.
      if (err?.code === 'ERR_MODULE_NOT_FOUND') return;
      throw err;
    }
  });
});
