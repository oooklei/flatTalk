import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMentionedName,
  hasSkillAnchor,
  hasTravelSignal,
  isWeakOrChitchatUtterance,
  strongAcceptThreshold,
} from '../src/core/lis/utterance-guards.js';

describe('utterance-guards', () => {
  it('detects chitchat and punctuation', () => {
    assert.equal(isWeakOrChitchatUtterance('你是谁'), true);
    assert.equal(isWeakOrChitchatUtterance('你好'), true);
    assert.equal(isWeakOrChitchatUtterance('？？？！！'), true);
    assert.equal(isWeakOrChitchatUtterance('今天天气如何'), false);
    assert.equal(isWeakOrChitchatUtterance('我想去桂林旅游'), false);
  });

  it('skill anchors', () => {
    assert.equal(hasTravelSignal('今天天气如何'), true);
    assert.equal(hasSkillAnchor('我要减肥', 'meal_plan'), true);
    assert.equal(hasSkillAnchor('你是谁', 'travel_route'), false);
  });

  it('extracts self-reported names', () => {
    assert.equal(extractMentionedName('我叫吴桂花，今年72岁'), '吴桂花');
    assert.equal(extractMentionedName('你好'), '');
  });

  it('strong accept threshold default 0.7', () => {
    assert.equal(strongAcceptThreshold({}), 0.7);
    assert.equal(strongAcceptThreshold({ LIS_STRONG_ACCEPT_THRESHOLD: '0.65' }), 0.65);
  });
});
