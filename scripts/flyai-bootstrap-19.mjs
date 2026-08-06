#!/usr/bin/env node
/**
 * Bootstrap FlyAI KB docs for sojourn-map seeds.
 *
 * Usage:
 *   node scripts/flyai-bootstrap-19.mjs
 *   node scripts/flyai-bootstrap-19.mjs --only=bama_5d4n
 *   node scripts/flyai-bootstrap-19.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createFlyaiClient } from '../src/services/flyai/flyai-client.js';
import { normalizeFlyaiDoc } from '../src/services/flyai/normalize-flyai-doc.js';
import { createFlyaiKbStore } from '../src/services/flyai/flyai-kb-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SEEDS_PATH = path.join(PROJECT_ROOT, 'data/flyai-kb/seeds.json');

function parseArgs(argv) {
  const opts = { dryRun: false, only: null };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length).trim() || null;
  }
  return opts;
}

function loadApiKey() {
  if (process.env.FLYAI_API_KEY) return process.env.FLYAI_API_KEY;
  const cfgPath = path.join(os.homedir(), '.flyai', 'config.json');
  if (!fs.existsSync(cfgPath)) return '';
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return cfg.FLYAI_API_KEY || cfg.apiKey || cfg.api_key || '';
  } catch {
    return '';
  }
}

function asMarkdown(data) {
  if (typeof data === 'string') return data;
  if (data == null) return '';
  if (typeof data.markdown === 'string') return data.markdown;
  if (typeof data.content === 'string') return data.content;
  if (typeof data.result === 'string') return data.result;
  return '';
}

function asItemList(data) {
  if (!data) return [];
  if (Array.isArray(data.itemList)) return data.itemList;
  if (Array.isArray(data)) return data;
  return [];
}

async function bootstrapOne(client, store, seed, { dryRun }) {
  const started = Date.now();
  const { linked_route_id, destination, city_name, keywords, query } = seed;

  const [aiRes, poiRes, kwRes] = await Promise.all([
    client.aiSearch(query),
    client.searchPoi({ keyword: destination, cityName: city_name }),
    client.keywordSearch(query),
  ]);

  const failures = [];
  if (!aiRes.ok) failures.push(`aiSearch:${aiRes.error || 'failed'}`);
  if (!poiRes.ok) failures.push(`searchPoi:${poiRes.error || 'failed'}`);
  if (!kwRes.ok) failures.push(`keywordSearch:${kwRes.error || 'failed'}`);

  const aiMarkdown = asMarkdown(aiRes.data);
  const poiList = asItemList(poiRes.data);
  const products = asItemList(kwRes.data);

  if (!aiMarkdown && failures.length === 3) {
    throw new Error(failures.join('; '));
  }

  const doc = normalizeFlyaiDoc({
    linked_route_id,
    query,
    aiMarkdown,
    poiList,
    products,
    keywords,
  });
  doc.destination = destination;
  doc.city_name = city_name;

  let written = null;
  if (!dryRun) {
    written = store.upsertDoc(doc);
  }

  return {
    linked_route_id,
    ok: true,
    dry_run: dryRun,
    waypoints: doc.waypoints?.length || 0,
    products: doc.products?.length || 0,
    content_hash: doc.content_hash,
    path: written?.path || null,
    partial_errors: failures.length ? failures : undefined,
    ms: Date.now() - started,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seedsFile = JSON.parse(fs.readFileSync(SEEDS_PATH, 'utf8'));
  let seeds = Array.isArray(seedsFile.seeds) ? seedsFile.seeds : [];

  if (opts.only) {
    seeds = seeds.filter((s) => s.linked_route_id === opts.only);
    if (seeds.length === 0) {
      const summary = {
        ok: false,
        error: `seed_not_found:${opts.only}`,
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  const apiKey = loadApiKey();
  const client = createFlyaiClient({ apiKey });
  const store = createFlyaiKbStore({
    baseDir: path.join(PROJECT_ROOT, 'data/flyai-kb'),
  });

  const results = [];
  for (const seed of seeds) {
    try {
      const row = await bootstrapOne(client, store, seed, opts);
      results.push(row);
    } catch (err) {
      results.push({
        linked_route_id: seed.linked_route_id,
        ok: false,
        dry_run: opts.dryRun,
        error: err?.message || String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const summary = {
    ok: failed === 0,
    dry_run: opts.dryRun,
    only: opts.only,
    total: results.length,
    succeeded,
    failed,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.log(JSON.stringify({
    ok: false,
    error: err?.message || String(err),
    total: 0,
    succeeded: 0,
    failed: 0,
    results: [],
  }, null, 2));
  process.exitCode = 1;
});
