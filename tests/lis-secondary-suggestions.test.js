import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { matchSupplyToCatalog } from '../src/core/lis/matcher.js';

const CATALOG = [
  {
    intent_id: 'travel_route_plan',
    intent_desc: '规划或推荐旅居旅游线路',
    entry: { kind: 'template', skill_key: 'travel_route', template_id: 'route_svg' },
    enabled: true,
  },
  {
    intent_id: 'travel_route_weather_risk',
    intent_desc: '查询旅居目的地天气与出行风险',
    entry: { kind: 'template', skill_key: 'travel_route', template_id: 'travel_weather_risk_card' },
    enabled: true,
  },
  {
    intent_id: 'meal_plan_advice',
    intent_desc: '膳食饮食建议与控糖食谱',
    entry: { kind: 'template', skill_key: 'meal_plan', template_id: 'meal_card' },
    enabled: true,
  },
  {
    intent_id: 'nearby_resource.food',
    intent_desc: '查询周边餐饮餐馆美食',
    entry: { kind: 'template', skill_key: 'nearby_resource', template_id: 'nearby_food_card' },
    enabled: true,
  },
];

function supply(intents, decision = {}) {
  return {
    intents,
    decision: { status: 'MATCH_OK', max_confidence: intents[0]?.confidence ?? 0, ...decision },
  };
}

// ── 显式读 role=primary ─────────────────────────────────

describe('primary role selection', () => {
  it('prefers role=primary over raw max confidence', () => {
    // LIS 的域软偏置会重排序；显式读 role 才不依赖"恰好最高分"
    const hit = matchSupplyToCatalog(
      supply([
        { intent_id: 'meal_plan_advice', confidence: 0.72, role: 'secondary' },
        { intent_id: 'travel_route_plan', confidence: 0.7, role: 'primary' },
      ]),
      CATALOG,
    );
    assert.equal(hit.ok, true);
    assert.equal(hit.intent.intent_id, 'travel_route_plan', '应执行 LIS 标记的 primary');
    assert.equal(hit.entry.template_id, 'route_svg');
  });

  it('falls back to max confidence when no role is marked', () => {
    const hit = matchSupplyToCatalog(
      supply([
        { intent_id: 'meal_plan_advice', confidence: 0.9 },
        { intent_id: 'travel_route_plan', confidence: 0.5 },
      ]),
      CATALOG,
    );
    assert.equal(hit.intent.intent_id, 'meal_plan_advice');
  });

  it('falls back to max confidence when primary is not in local catalog', () => {
    const hit = matchSupplyToCatalog(
      supply([
        { intent_id: 'not_in_catalog', confidence: 0.95, role: 'primary' },
        { intent_id: 'travel_route_plan', confidence: 0.8, role: 'secondary' },
      ]),
      CATALOG,
    );
    assert.equal(hit.ok, true);
    assert.equal(hit.intent.intent_id, 'travel_route_plan');
  });
});

// ── secondary 转追问建议 ────────────────────────────────

describe('secondary suggestions', () => {
  it('surfaces a genuine second need above 0.6', () => {
    // 实测语料：「防城港三日游天气怎么样」
    const hit = matchSupplyToCatalog(
      supply([
        { intent_id: 'travel_route_plan', confidence: 1.0, role: 'primary' },
        { intent_id: 'travel_route_weather_risk', confidence: 0.75, role: 'secondary' },
        { intent_id: 'nearby_resource.food', confidence: 0.14, role: 'secondary' },
      ]),
      CATALOG,
    );
    assert.equal(hit.intent.intent_id, 'travel_route_plan');
    assert.equal(hit.suggestions.length, 1);
    assert.equal(hit.suggestions[0].intent_id, 'travel_route_weather_risk');
    assert.equal(hit.suggestions[0].template_id, 'travel_weather_risk_card');
    assert.equal(hit.suggestions[0].label, '查询旅居目的地天气与出行风险');
  });

  it('drops low-confidence noise', () => {
    // 实测语料：「给我做个控糖食谱」—— 用户完全没提旅游/餐馆
    const hit = matchSupplyToCatalog(
      supply([
        { intent_id: 'meal_plan_advice', confidence: 1.0, role: 'primary' },
        { intent_id: 'travel_route_plan', confidence: 0.31, role: 'secondary' },
        { intent_id: 'nearby_resource.food', confidence: 0.07, role: 'secondary' },
      ]),
      CATALOG,
    );
    assert.equal(hit.intent.intent_id, 'meal_plan_advice');
    assert.deepEqual(hit.suggestions, [], '噪音不应变成按钮');
  });

  it('caps suggestions at 2', () => {
    const hit = matchSupplyToCatalog(
      supply([
        { intent_id: 'travel_route_plan', confidence: 1.0, role: 'primary' },
        { intent_id: 'travel_route_weather_risk', confidence: 0.9, role: 'secondary' },
        { intent_id: 'meal_plan_advice', confidence: 0.8, role: 'secondary' },
        { intent_id: 'nearby_resource.food', confidence: 0.7, role: 'secondary' },
      ]),
      CATALOG,
    );
    assert.equal(hit.suggestions.length, 2);
    assert.deepEqual(
      hit.suggestions.map((s) => s.intent_id),
      ['travel_route_weather_risk', 'meal_plan_advice'],
      '应按分数降序取前两个',
    );
  });

  it('never includes the primary itself', () => {
    const hit = matchSupplyToCatalog(
      supply([{ intent_id: 'travel_route_plan', confidence: 1.0, role: 'primary' }]),
      CATALOG,
    );
    assert.deepEqual(hit.suggestions, []);
  });

  it('excludes disabled catalog entries from suggestions', () => {
    const catalog = CATALOG.map((e) =>
      e.intent_id === 'travel_route_weather_risk' ? { ...e, enabled: false } : e,
    );
    const hit = matchSupplyToCatalog(
      supply([
        { intent_id: 'travel_route_plan', confidence: 1.0, role: 'primary' },
        { intent_id: 'travel_route_weather_risk', confidence: 0.9, role: 'secondary' },
      ]),
      catalog,
    );
    assert.deepEqual(hit.suggestions, [], '已禁用的意图不应被建议');
  });

  it('returns empty suggestions when match fails', () => {
    const hit = matchSupplyToCatalog(
      supply(
        [{ intent_id: 'travel_route_plan', confidence: 0.2, role: 'primary' }],
        { status: 'NEED_CLARIFY', max_confidence: 0.2 },
      ),
      CATALOG,
    );
    assert.equal(hit.ok, false);
    assert.deepEqual(hit.suggestions, []);
  });
});
