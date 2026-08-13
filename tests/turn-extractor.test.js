import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTurn } from '../src/core/pipeline/turn-extractor.js';

describe('turn-extractor', () => {
  it('parses intents and pending', async () => {
    const out = await extractTurn({
      text: '先看看食谱，顺便推荐桂林旅居',
      login: { elder_binding: { elder_id: 'E1' }, location: null },
      turnPrev: {},
      llmCall: async () => ({
        content: JSON.stringify({
          pronouns: [{ surface: '我', resolved_ref: 'self', confidence: 0.9 }],
          mentioned_entities: [],
          cities: ['桂林'],
          primary_city: '桂林',
          location_intent: false,
          intents: [
            { skill_key: 'meal_plan', confidence: 0.85 },
            { skill_key: 'travel_route', confidence: 0.8 },
          ],
        }),
      }),
    });
    assert.equal(out.intents[0].skill_key, 'meal_plan');
    assert.equal(out.pending_intents.length, 1);
    assert.equal(out.pending_intents[0].skill_key, 'travel_route');
    assert.equal(out.primary_city, '桂林');
  });
  it('sets need_location when location_intent and no login.location', async () => {
    const out = await extractTurn({
      text: '附近有什么',
      login: { location: null },
      llmCall: async () => ({
        content: JSON.stringify({
          pronouns: [],
          mentioned_entities: [],
          cities: [],
          primary_city: null,
          location_intent: true,
          intents: [{ skill_key: 'nearby_resource', confidence: 0.9 }],
        }),
      }),
    });
    assert.equal(out.need_location, true);
  });
});
