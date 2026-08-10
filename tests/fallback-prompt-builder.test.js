import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFallbackActionPrompt, loadActionResourceMap, buildFallbackContext } from '../src/core/actions/fallback-prompt-builder.js';

test('buildFallbackActionPrompt: 五要素齐全', () => {
  const map = loadActionResourceMap();
  const action = map.actions.find((a) => a.action_key === 'travel_route.calculate_budget');
  const context = { destination: '防城港', days: 7, headcount: 2 };
  const prompt = buildFallbackActionPrompt(action, context, [action]);

  assert.ok(prompt.includes('【谁】'), '缺【谁】');
  assert.ok(prompt.includes('【做什么】'), '缺【做什么】');
  assert.ok(prompt.includes('【怎么做】'), '缺【怎么做】');
  assert.ok(prompt.includes('【有什么资源】'), '缺【有什么资源】');
  assert.ok(prompt.includes('【每个动作的资源】'), '缺【每个动作的资源】');
});

test('buildFallbackActionPrompt: 参数计数与 param_sources 注入', () => {
  const map = loadActionResourceMap();
  const action = map.actions.find((a) => a.action_key === 'travel_route.calculate_budget');
  const context = { destination: '防城港', days: 7, headcount: 2 };
  const prompt = buildFallbackActionPrompt(action, context, [action]);

  assert.ok(prompt.includes('参数个数：3'), '参数个数应为 3');
  assert.ok(prompt.includes('第1个参数'), '应有第1个参数');
  assert.ok(prompt.includes('第2个参数'), '应有第2个参数');
  assert.ok(prompt.includes('destination'), '应出现参数名 destination');
  assert.ok(prompt.includes('从上下文旅居产品 destination 抽取'), '应注入 param_sources 的取值说明');
});

test('buildFallbackActionPrompt: label/description 注入', () => {
  const map = loadActionResourceMap();
  const action = map.actions.find((a) => a.action_key === 'travel_route.calculate_budget');
  const prompt = buildFallbackActionPrompt(action, {}, [action]);
  assert.ok(prompt.includes('测算旅居预算'), '应包含按钮标签');
  assert.ok(prompt.includes('测算住宿、交通'), '应包含 description');
});

test('buildFallbackActionPrompt: raw action_key is localized before prompt injection', () => {
  const action = {
    action_key: 'meal_plan.adjust_for_condition',
    label: 'meal_plan.adjust_for_condition',
    target: 'bff',
    description: 'adjust meal plan',
    endpoint: '/mock',
    params_schema: {},
    param_sources: {},
  };
  const prompt = buildFallbackActionPrompt(action, {}, [action]);

  assert.ok(prompt.includes('\u6309\u5065\u5eb7\u72b6\u51b5\u8c03\u6574'));
  assert.equal(prompt.includes('\u6309\u94ae\u6807\u7b7e\uff1ameal_plan.adjust_for_condition'), false);
  assert.equal(prompt.includes('- meal_plan.adjust_for_condition'), false);
});

test('buildFallbackActionPrompt: 上下文摘要注入（目的地防城港）', () => {
  const map = loadActionResourceMap();
  const action = map.actions.find((a) => a.action_key === 'travel_route.calculate_budget');
  const context = { destination: '防城港', days: 7, headcount: 2 };
  const prompt = buildFallbackActionPrompt(action, context, [action]);
  assert.ok(prompt.includes('防城港'), '上下文摘要应包含目的地');
});

test('buildFallbackActionPrompt: 缺省资源（未知 action_key）仍生成五要素', () => {
  const action = {
    action_key: 'unknown.action',
    label: '未知动作',
    target: 'bff',
    description: '未知动作说明',
    endpoint: '（无）',
    params_schema: {},
    param_sources: {},
  };
  const prompt = buildFallbackActionPrompt(action, {}, []);
  assert.ok(prompt.includes('【谁】'));
  assert.ok(prompt.includes('未知动作'));
  assert.ok(prompt.includes('参数个数：0'), '无参数时应写 0');
});

test('buildFallbackContext: 从 businessData/request 抽取上下文', () => {
  const businessData = {
    jtd: { selected_product: { destination: '北海', days: 10, headcount: 3 } },
    region: '广西北海',
    condition: 'diabetes',
  };
  const request = { message: '帮我看看' };
  const ctx = buildFallbackContext(businessData, request);
  assert.equal(ctx.destination, '北海');
  assert.equal(ctx.days, 10);
  assert.equal(ctx.headcount, 3);
  assert.equal(ctx.region, '广西北海');
  assert.equal(ctx.condition, 'diabetes');
});
