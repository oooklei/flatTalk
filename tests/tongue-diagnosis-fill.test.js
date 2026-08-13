import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillHealthDrilldownCard } from '../src/core/model-runtime/extra-template-fills.js';
import { renderTemplate } from '../src/template-card/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('tongue_diagnosis_card unwraps analysis_table objects (no [object Object])', () => {
  const filled = fillHealthDrilldownCard({ selectedTemplateId: 'tongue_diagnosis_card' });
  assert.equal(filled.template_id, 'tongue_diagnosis_card');
  assert.ok(Array.isArray(filled.data.tongue_indicators));
  assert.ok(filled.data.tongue_indicators.length >= 1);

  const blob = JSON.stringify(filled);
  assert.equal(blob.includes('[object Object]'), false);

  for (const item of filled.data.tongue_indicators) {
    assert.equal(typeof item.value, 'string');
    assert.equal(item.value.includes('[object Object]'), false);
    assert.ok(item.value.length > 0);
  }
  assert.equal(String(filled.data.tongue_summary).includes('[object Object]'), false);

  const htmlPath = path.join(
    ROOT,
    'src/skills/health_risk_warning/templates/html/tongue_diagnosis_card.html',
  );
  const html = fs.readFileSync(htmlPath, 'utf8');
  const rendered = renderTemplate(html, filled.data);
  assert.equal(rendered.includes('[object Object]'), false);
  assert.match(rendered, /舌色|苔色|舌形/);
});
