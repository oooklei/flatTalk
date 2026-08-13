import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateCardMessages } from '../src/core/model-runtime/template-card-llm-service.js';

describe('buildTemplateCardMessages', () => {
  it('puts identity in system and splits user blocks', () => {
    const messages = buildTemplateCardMessages({
      message: '帮我看看北海路线',
      skill_key: 'travel_route',
      intent_context: { intent: 'travel' },
      template_id: 'sojourn_route',
      template_library: [{ id: 'sojourn_route' }],
      template_fields: [],
      evidence: [],
      conversation_history: [],
      business_data: {
        profile_scope: 'family_elders',
        user_name: '陈晓梅',
        entity_profiles: [{ entity_type: 'ELDER', name: '黄秀英' }],
        weather: { ok: true, text: '多云' },
        jtd: { products: [{ product_id: 'p1' }] },
      },
    });
    const system = messages.find((m) => m.role === 'system')?.content || '';
    const user = messages.filter((m) => m.role === 'user').at(-1)?.content || '';
    assert.match(system, /【会话身份】/);
    assert.match(system, /陈晓梅/);
    assert.match(system, /黄秀英/);
    assert.match(system, /引用约定/);
    assert.match(user, /【会话画像】/);
    assert.match(user, /【技能业务数据】/);
    assert.match(user, /p1/);
    assert.doesNotMatch(user, /【业务表数据】/);
    const skillSection = user.split('【技能业务数据】')[1] || '';
    assert.doesNotMatch(skillSection, /"entity_profiles"/);
  });
});
