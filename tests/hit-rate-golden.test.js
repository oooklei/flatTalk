import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { identifyScene } from '../src/core/scene-router/index.js';

const cases = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'docs/hit-rate-golden-cases.json'), 'utf8')
);

test('golden crosstalk: scene gate baseline/target', () => {
  let pass = 0;
  const failures = [];
  for (const c of cases.crosstalk) {
    const r = identifyScene({ text: c.message, message: c.message });
    const ok = r?.scene_key === c.expect_scene && r?.scene_key !== c.not_scene;
    if (ok) pass += 1;
    else failures.push({ id: c.id, got: r?.scene_key, expect: c.expect_scene });
  }
  const rate = pass / cases.crosstalk.length;
  console.log('[hit-rate] crosstalk pass_rate=', rate, 'failures=', failures);
  assert.ok(rate >= 0.9, `crosstalk pass_rate ${rate} < 0.9: ${JSON.stringify(failures)}`);
});
