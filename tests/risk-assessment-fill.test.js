import test from 'node:test';
import assert from 'node:assert/strict';
import { fillHealthDrilldownCard } from '../src/core/model-runtime/extra-template-fills.js';

test('risk_assessment_card tolerates string dietary.avoid_foods (no .map crash)', () => {
  const result = fillHealthDrilldownCard({
    selectedTemplateId: 'risk_assessment_card',
    business_data: { elder_name: '测试老人' },
  });
  assert.ok(result, 'fill should succeed against real shezhen structured report');
  assert.equal(result.template_id, 'risk_assessment_card');
  const items = result.data?.contraindications?.[0]?.items;
  assert.ok(Array.isArray(items));
  assert.ok(items.length >= 1);
  assert.ok(items.every((i) => typeof i.content === 'string' && i.content.length > 0));
  assert.equal(JSON.stringify(result).includes('[object Object]'), false);
});
