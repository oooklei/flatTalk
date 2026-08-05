import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchPublishedPackages } from '../src/core/scene-router/publish-index.js';

test('publish.json shape from workshop is matchable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-pub-'));
  const routeId = 'workshop_route_1';
  const pkg = path.join(dir, routeId);
  fs.mkdirSync(pkg);
  fs.writeFileSync(path.join(pkg, 'route_data.json'), JSON.stringify({ route_id: routeId, destination: '防城港' }));
  const publish = {
    route_id: routeId,
    status: 'published',
    destination: ['防城港'],
    keywords: ['三日游', '滨海'],
    product_type: 'coastal',
    title: '工坊发布测',
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pkg, 'publish.json'), JSON.stringify(publish, null, 2));
  const hits = matchPublishedPackages('防城港滨海三日游', { baseDir: dir });
  assert.equal(hits[0].route_id, routeId);
});
