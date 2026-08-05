import test from 'node:test';
import assert from 'node:assert/strict';
import { logSceneDecision, getRecentSceneDecisions } from '../src/core/scene-router/decision-log.js';

test('logSceneDecision records rows readable via getRecentSceneDecisions', () => {
  const prev = process.env.FLAT_TALK_ROUTE_LOG;
  process.env.FLAT_TALK_ROUTE_LOG = '0';
  try {
    const before = getRecentSceneDecisions(200).length;
    const a = logSceneDecision({
      utterance: '巴马康养旅居线路怎么安排',
      candidates: [{ scene_key: 'travel_route', score: 12, confidence: 0.9, decision: 'accept' }],
      margin: 0.2,
      transition_type: 'ROUTE',
      ambiguity: false,
      final_scene: 'travel_route',
    });
    const b = logSceneDecision({
      utterance: '老人血压偏高有什么风险',
      candidates: [
        { scene_key: 'health_risk_warning', score: 10, confidence: 0.85, decision: 'accept' },
        { scene_key: 'travel_route', score: 3, confidence: 0.4, decision: 'reject' },
      ],
      margin: 0.3,
      transition_type: 'ROUTE',
      ambiguity: false,
      final_scene: 'health_risk_warning',
    });
    assert.equal(a.final_scene, 'travel_route');
    assert.equal(b.final_scene, 'health_risk_warning');
    const recent = getRecentSceneDecisions(2);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].utterance, '巴马康养旅居线路怎么安排');
    assert.equal(recent[1].utterance, '老人血压偏高有什么风险');
    assert.equal(recent[1].candidates[0].scene_key, 'health_risk_warning');
    assert.ok(getRecentSceneDecisions(200).length >= before + 2);
  } finally {
    if (prev === undefined) delete process.env.FLAT_TALK_ROUTE_LOG;
    else process.env.FLAT_TALK_ROUTE_LOG = prev;
  }
});
