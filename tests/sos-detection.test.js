import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';
import { detectEmergency } from '../src/core/intent-classifier/emergency-detector.js';

test('SOS input with intent override still triggers emergency', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id,
        answer_text: '应急响应',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });

  const result = await orchestrator.run({
    message: 'SOS救命老人摔倒了',
    intent: 'common.chat',
    conversation_id: 'test-sos-1',
    turn_id: 'turn-sos-1',
    context: {},
  });

  assert.equal(result.intent, 'SOS', 'should route to SOS despite intent override');
  assert.equal(result.skill_key, 'find_service');
  assert.equal(result.template_id, 'service_emergency');
  assert.equal(result.card?.templateId, 'service_emergency');
  assert.ok(result.answer_text.includes('120'));
  assert.ok(result.rendered_html.includes('立即拨打 120'));
  assert.ok(result.actions.some((action) => action.action_key === 'sos.call_120'));
  assert.equal(result.debug?.sos_bypass, true);
});

test('acute chest pain and breathing difficulty renders emergency card, not generic answer', async () => {
  const orchestrator = createChatOrchestrator({
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id,
        answer_text: '已收到您的问题，我会结合健康状况提供建议。',
        data: {},
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });

  const result = await orchestrator.run({
    message: '老人突然胸痛呼吸困难，快打120',
    skill_key: 'common',
    conversation_id: 'test-sos-chest-pain',
    turn_id: 'turn-sos-chest-pain',
    context: {},
  });

  assert.equal(result.intent, 'SOS');
  assert.equal(result.skill_key, 'find_service');
  assert.equal(result.template_id, 'service_emergency');
  assert.equal(result.card?.templateId, 'service_emergency');
  assert.equal(result.route?.source, 'flatTalk.sos_emergency_bypass');
  assert.equal(result.route?.urgency_level, 'P0');
  assert.ok(result.answer_text.includes('立即拨打120'));
  assert.ok(result.rendered_html.includes('立即拨打 120'));
  assert.ok(result.rendered_html.includes('检测到紧急情况'));
  assert.ok(result.actions.some((action) => action.action_key === 'sos.call_120'));
  assert.ok(result.actions.some((action) => action.action_key === 'sos.notify_family'));
  assert.equal(result.debug?.sos_bypass, true);
});

test('all emergency LEVEL_1 keywords are detected', () => {
  const emergencyLevel1 = ['救命', '昏迷', '晕倒', '不能呼吸', '喘不过气', '胸痛', '中风', '抽搐', '大出血', 'SOS', 'sos', '120', '999', '急救', '求救', '救护车', '叫救护车', '打120'];
  for (const word of emergencyLevel1) {
    const detected = detectEmergency({ text: word });
    assert.equal(detected.matched, true, `should detect "${word}" as emergency`);
  }
});

test('supervisor SOS_TERMS includes keywords from emergency-detector', async () => {
  const { createSupervisor } = await import('../src/core/agents/supervisor.js');
  const supervisor = createSupervisor();
  // Test that supervisor detects SOS keywords now
  const result = await supervisor.route({ message: '救命', context: {} });
  assert.equal(result.emergency, true, 'supervisor should detect 救命 as emergency');
});
