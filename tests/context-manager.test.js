import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextManager } from '../src/core/conversation/context-manager.js';

function mockSessionStore(sessions = {}) {
  return {
    async getOrCreate(id) {
      return sessions[id] || {
        conversation_id: id, turns: [], agents: {}, active_agent: '', global_context: {}, updated_at: '',
      };
    },
  };
}

test('buildHistory returns last N valid turns for agent', async () => {
  const store = mockSessionStore({
    conv1: {
      conversation_id: 'conv1',
      turns: [],
      agents: {
        meal_plan: {
          turns: [
            { user_message: '推荐食谱', envelope: { answer_text: '小米粥', template_id: 'diet_card', model_status: 'ok' } },
            { user_message: '换一份', envelope: { answer_text: '抱歉，无法处理', template_id: 'answer', model_status: 'fallback_mock' } },
            { user_message: '清淡点', envelope: { answer_text: '燕麦粥', template_id: 'diet_card', model_status: 'ok' } },
          ],
          last_template: 'diet_card', scoped_data: {}, frozen: false,
        },
      },
      active_agent: 'meal_plan',
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.buildHistory('conv1', 'meal_plan');
  assert.equal(history.length, 4, 'should filter out the fallback_mock turn, leaving 2 valid turns = 4 messages');
});

test('buildHistory limits to 10 turns', async () => {
  const turns = [];
  for (let i = 0; i < 15; i++) {
    turns.push(
      { user_message: `问题${i}`, envelope: { answer_text: `回答${i}`, template_id: 'diet_card', model_status: 'ok' } },
    );
  }
  const store = mockSessionStore({
    conv2: {
      conversation_id: 'conv2', turns: [],
      agents: { meal_plan: { turns, last_template: 'diet_card', scoped_data: {}, frozen: false } },
      active_agent: 'meal_plan', global_context: {},
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.buildHistory('conv2', 'meal_plan');
  assert.equal(history.length, 20, 'should return 10 turns = 20 messages');
});

test('buildHistory returns empty for unknown agent', async () => {
  const store = mockSessionStore({
    conv3: {
      conversation_id: 'conv3', turns: [],
      agents: { meal_plan: { turns: [], last_template: '', scoped_data: {}, frozen: false } },
      active_agent: '', global_context: {},
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.buildHistory('conv3', 'travel_route');
  assert.deepEqual(history, []);
});

test('buildHistory includes assistant message from envelope', async () => {
  const store = mockSessionStore({
    conv4: {
      conversation_id: 'conv4', turns: [],
      agents: {
        health_risk_warning: {
          turns: [
            { user_message: '血压偏高', envelope: { answer_text: '建议低盐饮食', template_id: 'risk_warning_card', model_status: 'ok' } },
          ],
          last_template: 'risk_warning_card', scoped_data: {}, frozen: false,
        },
      },
      active_agent: 'health_risk_warning', global_context: {},
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.buildHistory('conv4', 'health_risk_warning');
  assert.equal(history[0].role, 'user');
  assert.equal(history[0].content, '血压偏高');
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[1].content, '建议低盐饮食');
});

test('getCommonContext returns common agent history', async () => {
  const store = mockSessionStore({
    conv5: {
      conversation_id: 'conv5', turns: [],
      agents: {
        common: {
          turns: [
            { user_message: '你好', envelope: { answer_text: '您好！我是桂小养', template_id: 'answer', model_status: 'ok' } },
          ],
          last_template: 'answer', scoped_data: {}, frozen: false,
        },
      },
      active_agent: 'common', global_context: {},
    },
  });
  const cm = createContextManager({ sessionStore: store });
  const history = await cm.getCommonContext('conv5');
  assert.equal(history.length, 2);
  assert.equal(history[0].content, '你好');
});
