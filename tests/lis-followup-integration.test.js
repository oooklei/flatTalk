import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { composeInteractions } from '../src/core/interaction-composer.js';

const BASE = {
  sceneDecision: { scene_key: 'travel_route', decision: 'accept', confidence: 1 },
  modelResult: { data: {}, followup_suggestions: [], compact_followups: [] },
  staticFollowups: [],
};

const WEATHER_SUGGESTION = {
  intent_id: 'travel_route_weather_risk',
  confidence: 0.75,
  skill_key: 'travel_route',
  template_id: 'travel_weather_risk_card',
  label: '查询旅居目的地天气与出行风险',
};

const MEAL_SUGGESTION = {
  intent_id: 'meal_plan_advice',
  confidence: 0.7,
  skill_key: 'meal_plan',
  template_id: 'meal_card',
  label: '膳食饮食建议与控糖食谱',
};

function labels(result) {
  return result.followup_suggestions.map((f) => f.label);
}

describe('LIS secondary suggestions → followup buttons', () => {
  it('keeps a cross-skill suggestion the scene does not already offer', () => {
    // 场景 travel_route 的默认追问里没有膳食相关项。
    // 注意：LIS 建议是跨技能的，若走 filterByScene 的前缀检查会被丢掉。
    const base = composeInteractions(BASE);
    const withLis = composeInteractions({ ...BASE, lisSuggestions: [MEAL_SUGGESTION] });

    assert.equal(withLis.followup_suggestions.length, base.followup_suggestions.length + 1);
    assert.ok(labels(withLis).some((l) => /膳食/.test(l)), '跨技能建议应保留');
  });

  it('dedupes against the scene\'s existing synonymous followup', () => {
    // travel_route 场景默认已有「查看天气风险」。
    // 回归防护：若给 LIS 建议填上 action_key=travel_route_weather_risk，
    // followupIntentKey 会原样返回它，无法与 travel_route.check_weather_risk
    // 归并 —— 卡片底部会出现两个近义的天气按钮。
    const base = composeInteractions(BASE);
    const withLis = composeInteractions({ ...BASE, lisSuggestions: [WEATHER_SUGGESTION] });

    const weatherButtons = withLis.followup_suggestions.filter((f) => /天气/.test(f.label));
    assert.equal(weatherButtons.length, 1, '天气按钮只应有一个');
    assert.equal(
      withLis.followup_suggestions.length,
      base.followup_suggestions.length,
      '同义建议不应增加按钮数',
    );
  });

  it('marks LIS suggestions as category=other', () => {
    const res = composeInteractions({ ...BASE, lisSuggestions: [MEAL_SUGGESTION] });
    const item = res.followup_suggestions.find((f) => /膳食/.test(f.label));
    assert.ok(item);
    assert.equal(item.category, 'other', '应排在紧密追问之后');
  });

  it('carries user_prompt so the button is clickable', () => {
    // isFollowupAllowed 要求 label + user_prompt 都在，缺 user_prompt 会被静默丢弃
    const res = composeInteractions({ ...BASE, lisSuggestions: [MEAL_SUGGESTION] });
    const item = res.followup_suggestions.find((f) => /膳食/.test(f.label));
    assert.ok(item.user_prompt, 'user_prompt 缺失会导致按钮被丢弃');
  });

  it('adds nothing when suggestions are empty', () => {
    const base = composeInteractions(BASE);
    const empty = composeInteractions({ ...BASE, lisSuggestions: [] });
    assert.deepEqual(labels(empty), labels(base));
  });

  it('returns no followups when the scene is rejected', () => {
    const res = composeInteractions({
      sceneDecision: { scene_key: 'travel_route', decision: 'reject' },
      modelResult: {},
      lisSuggestions: [MEAL_SUGGESTION],
    });
    assert.deepEqual(res.followup_suggestions, []);
  });

  it('tolerates malformed suggestion entries', () => {
    const base = composeInteractions(BASE);
    const res = composeInteractions({
      ...BASE,
      lisSuggestions: [null, {}, { intent_id: '' }, 'bad', 42, { label: '' }],
    });
    assert.equal(res.followup_suggestions.length, base.followup_suggestions.length);
  });

  it('falls back to intent_id when label is missing', () => {
    const res = composeInteractions({
      ...BASE,
      lisSuggestions: [{ intent_id: 'elder_policy_consult', confidence: 0.8 }],
    });
    assert.ok(
      labels(res).some((l) => l === 'elder_policy_consult'),
      '无 label 时用 intent_id 兜底',
    );
  });
});
