import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectDialogueView, projectBizHints } from '../src/core/lis/context-projector.js';

describe('context-projector', () => {
  it('projects last N turns into DialogueView', () => {
    const session = {
      conversation_id: 'conv_1',
      active_agent: 'travel_route',
      turns: [
        {
          turn_id: 't1',
          envelope: { skill_key: 'travel_route', intent: 'travel_route_plan', template_id: 'route_svg' },
          user_text: '三日游',
          assistant_text: 'ok',
        },
        {
          turn_id: 't2',
          envelope: { skill_key: 'travel_route' },
          user_text: '天气',
          assistant_text: '晴',
        },
      ],
    };
    const view = projectDialogueView(session, { ticket: null, limit: 8 });
    assert.equal(view.schema_version, '1.0');
    assert.equal(view.conversation_id, 'conv_1');
    // 每条 session turn 拆成 user+assistant 两条；不足 3 条时不伪造（gate 会改走 SORT）
    assert.ok(view.turns.length >= 2);
    assert.equal(view.turns[0].role, 'user');
  });

  it('projects BizHints from request and snapshot', () => {
    const hints = projectBizHints({
      request: {
        elder_id: 'E1',
        role: 'family',
        context: { location: { city: '防城港' }, action_key: '' },
      },
      snapshot: {
        scene: 'travel_route',
        intent: 'travel_route_plan',
        route_id: 'R1',
        city: '防城港',
      },
      catalogIntentIds: ['travel_route_plan'],
    });
    assert.equal(hints.schema_version, '1.0');
    assert.equal(hints.user.elder_id, 'E1');
    assert.equal(hints.entity_lock.route_id, 'R1');
    assert.deepEqual(hints.catalog_intent_ids, ['travel_route_plan']);
    assert.equal(hints.scene.skill_key, 'travel_route');
  });

  it('BizHints.scene ignores Supervisor request.skill_key', () => {
    const hints = projectBizHints({
      request: {
        skill_key: 'dispatch_manage',
        context: { previous_scene: 'health_risk_warning' },
      },
      snapshot: { scene: 'health_risk_warning', intent: 'health_risk_warning.tongue' },
      catalogIntentIds: [],
    });
    assert.equal(hints.scene.skill_key, 'health_risk_warning');
    assert.notEqual(hints.scene.skill_key, 'dispatch_manage');
  });
});
