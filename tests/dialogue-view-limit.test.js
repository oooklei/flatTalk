import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDialogueView } from '../src/core/lis/context-projector.js';

test('DialogueView defaults to 5 pairs max and hard-caps at 8', () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({
    turn_id: `t${i}`,
    user_message: `u${i}`,
    envelope: { answer_text: `a${i}`, skill_key: 'common', template_id: 'answer' },
  }));
  const d5 = projectDialogueView({ conversation_id: 'c', turns }, { limit: undefined });
  assert.ok(d5.turns.length <= 10);
  const d8 = projectDialogueView({ conversation_id: 'c', turns }, { limit: 8 });
  assert.ok(d8.turns.length <= 16);
  const dOver = projectDialogueView({ conversation_id: 'c', turns }, { limit: 99 });
  assert.ok(dOver.turns.length <= 16);
});
