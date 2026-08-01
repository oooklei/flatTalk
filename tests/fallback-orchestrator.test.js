import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';
import { createTemplateCardModelService } from '../src/core/model-runtime/template-card-llm-service.js';

function makeRagService() {
  const state = { retrieved: false };
  return {
    state,
    async retrieveKnowledge() {
      state.retrieved = true;
      return { matches: [{ collection: '广西养老办事指引知识库', text: '示例知识条目', score: 0.9 }], status: 'local' };
    },
    async retrieveMealPlanKnowledge() {
      state.retrieved = true;
      return { matches: [{ collection: '膳食知识库', text: '示例膳食条目', score: 0.9 }], status: 'local' };
    },
  };
}

test('兜底分支：未特例化的 bff 动作走通用兜底（route_card）', async () => {
  const modelService = createTemplateCardModelService({ runtimeMode: 'test' });
  const ragService = makeRagService();
  const result = await runLocalSkill(
    {
      skill_key: 'travel_route',
      message: '测算一下预算',
      context: { action_key: 'travel_route.calculate_budget', action_params: { destination: '防城港', days: 7, headcount: 2 } },
    },
    { modelService, ragService },
  );
  assert.equal(result.skill_key, 'travel_route');
  assert.equal(result.template_id, 'route_card');
  assert.ok(result.rendered_html && result.rendered_html.length > 0, '应渲染出 HTML');
  assert.equal(result.ok, true);
});

test('兜底分支：knowledge 类动作触发知识库检索', async () => {
  const modelService = createTemplateCardModelService({ runtimeMode: 'test' });
  const ragService = makeRagService();
  const result = await runLocalSkill(
    {
      skill_key: 'travel_route',
      message: '讲讲旅居安全',
      context: { action_key: 'travel_route.explain_safety', action_params: {} },
    },
    { modelService, ragService },
  );
  assert.equal(result.template_id, 'route_card');
  assert.equal(ragService.state.retrieved, true, 'knowledge 动作应触发 retrieveKnowledge');
});

test('特例白名单：check_weather_risk 不走兜底', async () => {
  const modelService = createTemplateCardModelService({ runtimeMode: 'test' });
  const ragService = makeRagService();
  const result = await runLocalSkill(
    {
      skill_key: 'travel_route',
      message: '查天气风险',
      context: { action_key: 'travel_route.check_weather_risk', action_params: { city: '防城港' } },
    },
    { modelService, ragService },
  );
  assert.equal(result.template_id, 'travel_weather_risk_card');
  assert.notEqual(result.template_id, 'route_card');
});
