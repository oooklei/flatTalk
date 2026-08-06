#!/usr/bin/env node
/**
 * Nightly refresh of FlyAI KB docs — re-fetch live data and upsert when content_hash changes.
 *
 * Cron (daily at midnight):
 * 0 0 * * * cd /path/to/flatTalk && node scripts/flyai-nightly-refresh.mjs
 *
 * Usage:
 *   node scripts/flyai-nightly-refresh.mjs
 *   node scripts/flyai-nightly-refresh.mjs --dry-run
 *   node scripts/flyai-nightly-refresh.mjs --only=bama_5d4n
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
const SUMMARY_PATH = path.join(__dirname, 'test-output/flyai-probe/nightly-last.json');

export function parseArgs(argv) {
  const opts = { dryRun: false, only: null };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length).trim() || null;
  }
  return opts;
}

export function loadSeedsMap(seedsPath = SEEDS_PATH) {
  const seedsFile = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
  const seeds = Array.isArray(seedsFile.seeds) ? seedsFile.seeds : [];
  return new Map(seeds.map((seed) => [seed.linked_route_id, seed]));
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

export function shouldSkipRefresh(previousHash, nextHash) {
  return Boolean(previousHash && nextHash && previousHash === nextHash);
}

export async function refreshOneDoc({
  client,
  store,
  existingDoc,
  seed,
  dryRun = false,
}) {
  const started = Date.now();
  const linked_route_id = existingDoc?.linked_route_id;

  if (!linked_route_id) {
    return {
      linked_route_id: null,
      ok: false,
      error: 'missing_linked_route_id',
      ms: Date.now() - started,
    };
  }

  if (!seed) {
    return {
      linked_route_id,
      ok: false,
      error: 'seed_not_found',
      ms: Date.now() - started,
    };
  }

  const { destination, city_name, keywords, query } = seed;
  const searchQuery = query || existingDoc.query || keywords?.[0] || destination || '';

  const [aiRes, poiRes, kwRes] = await Promise.all([
    client.aiSearch(searchQuery),
    client.searchPoi({
      keyword: destination || existingDoc.destination || keywords?.[0] || '',
      cityName: city_name || existingDoc.city_name,
    }),
    client.keywordSearch(searchQuery),
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
    query: searchQuery,
    aiMarkdown,
    poiList,
    products,
    keywords: keywords || existingDoc.keywords,
  });
  doc.destination = destination || existingDoc.destination;
  doc.city_name = city_name || existingDoc.city_name;

  const previousHash = existingDoc.content_hash;
  const contentHash = doc.content_hash;

  if (shouldSkipRefresh(previousHash, contentHash)) {
    return {
      linked_route_id,
      ok: true,
      action: 'skipped',
      content_hash: contentHash,
      dry_run: dryRun,
      partial_errors: failures.length ? failures : undefined,
      ms: Date.now() - started,
    };
  }

  if (dryRun) {
    return {
      linked_route_id,
      ok: true,
      action: 'would_update',
      content_hash: contentHash,
      previous_hash: previousHash || null,
      dry_run: true,
      partial_errors: failures.length ? failures : undefined,
      ms: Date.now() - started,
    };
  }

  const written = store.upsertDoc(doc);
  return {
    linked_route_id,
    ok: true,
    action: 'updated',
    content_hash: contentHash,
    previous_hash: previousHash || null,
    path: written.path,
    dry_run: false,
    partial_errors: failures.length ? failures : undefined,
    ms: Date.now() - started,
  };
}

export async function runNightlyRefresh({
  dryRun = false,
  only = null,
  seedsPath = SEEDS_PATH,
  summaryPath = SUMMARY_PATH,
  store = createFlyaiKbStore({ baseDir: path.join(PROJECT_ROOT, 'data/flyai-kb') }),
  client = createFlyaiClient({ apiKey: loadApiKey() }),
} = {}) {
  const seedsMap = loadSeedsMap(seedsPath);
  let docs = store.listDocs();

  if (only) {
    docs = docs.filter((doc) => doc.linked_route_id === only);
    if (docs.length === 0) {
      const summary = {
        ok: false,
        error: `doc_not_found:${only}`,
        dry_run: dryRun,
        only,
        total: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        updated: 0,
        results: [],
        finished_at: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
      fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
      return summary;
    }
  }

  const results = [];
  for (const existingDoc of docs) {
    const seed = seedsMap.get(existingDoc.linked_route_id);
    try {
      const row = await refreshOneDoc({ client, store, existingDoc, seed, dryRun });
      results.push(row);
    } catch (err) {
      results.push({
        linked_route_id: existingDoc.linked_route_id,
        ok: false,
        dry_run: dryRun,
        error: err?.message || String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const skipped = results.filter((r) => r.ok && r.action === 'skipped').length;
  const updated = results.filter((r) => r.ok && (r.action === 'updated' || r.action === 'would_update')).length;

  const summary = {
    ok: failed === 0,
    dry_run: dryRun,
    only,
    total: results.length,
    succeeded,
    failed,
    skipped,
    updated,
    results,
    finished_at: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  return summary;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const summary = await runNightlyRefresh(opts);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0 || summary.error) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.log(JSON.stringify({
      ok: false,
      error: err?.message || String(err),
      total: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      updated: 0,
      results: [],
    }, null, 2));
    process.exitCode = 1;
  });
}
