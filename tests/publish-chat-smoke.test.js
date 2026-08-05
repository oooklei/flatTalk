/**
 * 对话侧 published 包抽检（轻量，注入 stub，不打真实 LLM/JTD 网络）
 * Run: node --test tests/publish-chat-smoke.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator.js';

function makeOrch() {
  return createChatOrchestrator({
    intentClassifier: {
      classifyIntent: async () => ({ intent: 'travel_route.plan', confidence: 0.92, source: 'test' }),
    },
    dataService: {
      tableData: {
        getTravelRouteTables: async () => ({ routes: [], products: [] }),
        getSkillConfigs: async () => ({}),
      },
      knowledgeData: {},
    },
    ragService: {
      retrieveKnowledge: async () => ({ source: 'test', status: 'empty', matches: [] }),
    },
    modelService: {
      fillTemplateSlots: async (input) => ({
        template_id: input.template_id || 'route_svg',
        answer_text: `命中:${input.business_data?.route_id || ''}`,
        data: {
          route_id: input.business_data?.route_id || '',
          publish_match: input.business_data?.publish_match || null,
          route_type: input.business_data?.publish_match?.product_type || '',
        },
        actions: [],
        followup_suggestions: [],
        model_status: 'ok',
        model_used: 'test',
      }),
    },
  });
}

const CASES = [
  { message: '京族滨海文化线', expectRoute: 'fcg_route_001' },
  { message: '银发爱情边境线', expectRoute: 'fcg_route_002' },
  { message: '巴马5天4晚康养百魔洞', expectRoute: 'bama_5d4n' },
  { message: '南宁-北海-钦州-防城港滨海养老旅居线', expectRoute: 'gx_excel_05' },
  { message: '七洞乡线路产品', expectRoute: 'jtd_2070305000000000240' },
];

test('chat smoke: travel_route + publish route_id for key utterances', async () => {
  const orch = makeOrch();
  for (const c of CASES) {
    const result = await orch.run({
      message: c.message,
      skill_key: 'travel_route',
      conversation_id: `smoke-${c.expectRoute}`,
      turn_id: `smoke-${c.expectRoute}-t`,
      context: { ambiguity_pick: true, ambiguity_scene_key: 'travel_route' },
    });
    assert.equal(result.skill_key, 'travel_route', c.message);
    assert.notEqual(result.route?.decision, 'ambiguous', c.message);
    const rid = result.data?.route_id || result.data?.publish_match?.route_id;
    assert.equal(rid, c.expectRoute, `${c.message} -> ${rid}`);
  }
});
