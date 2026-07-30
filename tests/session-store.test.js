import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore } from '../src/core/conversation/session-store.js';
import { createMemoryStateStore } from '../src/services/cache/redis-state-store.js';

test('session store creates sessions and appends turns', async () => {
  const sessionStore = createSessionStore({ stateStore: createMemoryStateStore() });

  const session = await sessionStore.getOrCreate('conv_session_1');
  assert.equal(session.conversation_id, 'conv_session_1');
  assert.deepEqual(session.turns, []);

  await sessionStore.appendTurn('conv_session_1', {
    turn_id: 'turn_1',
    user_message: 'first',
    envelope: { skill_key: 'meal_plan' },
  });

  const previous = await sessionStore.getPreviousTurn('conv_session_1');
  assert.equal(previous.turn_id, 'turn_1');
  assert.equal(previous.envelope.skill_key, 'meal_plan');
});

test('session store conversation index is unique', async () => {
  const sessionStore = createSessionStore({ stateStore: createMemoryStateStore() });

  await sessionStore.appendTurn('conv_session_2', { turn_id: 'turn_1', user_message: 'first' });
  await sessionStore.appendTurn('conv_session_2', { turn_id: 'turn_2', user_message: 'second' });

  const conversations = await sessionStore.listConversations();
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].conversation_id, 'conv_session_2');
  assert.equal(conversations[0].turn_count, 2);
});

test('session store syncs mobile conversation history payloads', async () => {
  const sessionStore = createSessionStore({ stateStore: createMemoryStateStore() });

  await sessionStore.syncClientConversations([{
    id: 'mconv_session_3',
    title: '推荐今日膳食',
    status: '已答复',
    favorite: true,
    latestQuestion: '推荐今日膳食',
    latestAnswer: '已生成膳食方案',
    messages: [
      { role: 'user', content: '推荐今日膳食', at: 1 },
      { role: 'ai', content: '已生成膳食方案', at: 2 },
    ],
    roleKey: 'elder_family',
  }]);

  const conversations = await sessionStore.listConversations();
  const restored = JSON.parse(conversations[0].messages);
  assert.equal(conversations[0].conversation_id, 'mconv_session_3');
  assert.equal(conversations[0].title, '推荐今日膳食');
  assert.equal(conversations[0].favorite, true);
  assert.equal(restored.messages.length, 2);
});
