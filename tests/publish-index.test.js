import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  matchPublishedPackages,
  PRODUCT_TYPE_TO_ROUTE_TEMPLATE,
} from '../src/core/scene-router/publish-index.js';

test('matchPublishedPackages prefers published destination+keywords over draft', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-idx-'));
  for (const id of ['fixture_fcg_coastal', 'fixture_draft_only']) {
    const pkg = path.join(dir, id);
    fs.mkdirSync(pkg);
    const status = id.includes('draft') ? 'draft' : 'published';
    fs.writeFileSync(path.join(pkg, 'publish.json'), JSON.stringify({
      route_id: id,
      status,
      destination: ['防城港'],
      keywords: ['三日游', '滨海'],
      product_type: 'coastal',
      title: id,
      updated_at: '2026-08-01T00:00:00.000Z',
    }));
  }
  const hits = matchPublishedPackages('防城港三日游滨海', { baseDir: dir });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].route_id, 'fixture_fcg_coastal');
  assert.equal(PRODUCT_TYPE_TO_ROUTE_TEMPLATE.coastal, 'route_coastal');
});
