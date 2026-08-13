import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadCatalogEntries } from '../src/core/lis/lis-gate-hook.js';

/** 写一个临时 catalog 文件，返回路径 */
function writeCatalog(dir, intents) {
  const p = path.join(dir, 'catalog.json');
  fs.writeFileSync(p, JSON.stringify({ catalog_version: '0.0.1', intents }, null, 2), 'utf8');
  return p;
}

function entry(id) {
  return {
    intent_id: id,
    domain: 'test',
    entry: { kind: 'template', skill_key: 'sk', template_id: 'tpl' },
    enabled: true,
  };
}

describe('loadCatalogEntries', () => {
  it('reads intents from file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lis-cat-'));
    const p = writeCatalog(dir, [entry('a'), entry('b')]);
    assert.equal(loadCatalogEntries(p).length, 2);
  });

  it('caches when file is unchanged (no repeated disk reads)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lis-cat-'));
    const p = writeCatalog(dir, [entry('a')]);
    loadCatalogEntries(p); // 预热

    const orig = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = (...args) => {
      if (String(args[0]) === p) reads += 1;
      return orig.apply(fs, args);
    };
    try {
      for (let i = 0; i < 50; i += 1) loadCatalogEntries(p);
    } finally {
      fs.readFileSync = orig;
    }
    assert.equal(reads, 0, '文件未变时不应重复读盘');
  });

  it('hot-reloads when the file changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lis-cat-'));
    const p = writeCatalog(dir, [entry('a')]);
    assert.equal(loadCatalogEntries(p).length, 1);

    writeCatalog(dir, [entry('a'), entry('b'), entry('c')]);
    assert.equal(loadCatalogEntries(p).length, 3, '改文件后应立即生效，无需重启');
  });

  it('keeps last good value when JSON is corrupt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lis-cat-'));
    const p = writeCatalog(dir, [entry('a'), entry('b')]);
    assert.equal(loadCatalogEntries(p).length, 2);

    fs.writeFileSync(p, '{ not valid json', 'utf8');
    assert.equal(loadCatalogEntries(p).length, 2, 'JSON 损坏时应沿用上次成功结果');
  });

  it('returns array when file is missing', () => {
    const missing = path.join(os.tmpdir(), 'definitely-not-here-lis.json');
    assert.ok(Array.isArray(loadCatalogEntries(missing)));
  });

  it('tolerates missing intents key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lis-cat-'));
    const p = path.join(dir, 'catalog.json');
    fs.writeFileSync(p, JSON.stringify({ catalog_version: '1' }), 'utf8');
    assert.ok(Array.isArray(loadCatalogEntries(p)));
  });

  it('loads the real project catalog with 9 enabled intents', () => {
    const entries = loadCatalogEntries();
    assert.ok(entries.length >= 9, `期望至少 9 条，实际 ${entries.length}`);
    // 每条都应有 intent_id 与 entry.skill_key，否则 matcher 会静默失配
    for (const e of entries) {
      assert.ok(e.intent_id, 'intent_id 缺失');
      assert.ok(e.entry?.skill_key, `${e.intent_id} 的 entry.skill_key 缺失`);
    }
  });
});
