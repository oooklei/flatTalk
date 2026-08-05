import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { identifyScene } from '../src/core/scene-router/index.js';
import {
  matchPublishedPackages,
  getPublishedPackageById,
} from '../src/core/scene-router/publish-index.js';

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

test('golden publish_match: published package wins over draft', () => {
  for (const pm of cases.publish_match) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-pub-'));
    for (const fx of pm.fixtures) {
      const pkg = path.join(dir, fx.route_id);
      fs.mkdirSync(pkg);
      fs.writeFileSync(path.join(pkg, 'publish.json'), JSON.stringify(fx));
    }
    const hits = matchPublishedPackages(pm.message, { baseDir: dir });
    assert.equal(hits[0]?.route_id, pm.expect_route_id);
    assert.ok(hits.every((h) => h.meta.status === 'published' || h.route_id === pm.expect_route_id));
  }
});

test('golden live_publish: real sojourn-maps packages match', () => {
  const live = cases.live_publish || [];
  if (!live.length) return;
  const failures = [];
  for (const c of live) {
    const hits = matchPublishedPackages(c.message);
    const top = hits[0]?.route_id || '';
    const ok = c.expect_route_id
      ? top === c.expect_route_id
      : Boolean(c.expect_route_id_prefix && top.startsWith(c.expect_route_id_prefix));
    if (!ok) failures.push({ id: c.id, got: top, expect: c.expect_route_id || c.expect_route_id_prefix });
  }
  assert.equal(failures.length, 0, JSON.stringify(failures));
});

test('scene gate module does not import publish-index', () => {
  const indexPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/core/scene-router/index.js'
  );
  const src = fs.readFileSync(indexPath, 'utf8');
  assert.ok(!/publish-index/.test(src), 'identifyScene path must not read publish index');
});

test('getPublishedPackageById only returns published packages', () => {
  const hit = getPublishedPackageById('fcg_route_001');
  assert.ok(hit);
  assert.equal(hit.route_id, 'fcg_route_001');
  assert.equal(hit.meta.status, 'published');
  assert.equal(getPublishedPackageById('definitely_not_a_route_xyz'), null);
  assert.equal(getPublishedPackageById('jtd_mock_bama_001'), null); // draft
});
