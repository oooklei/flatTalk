#!/usr/bin/env node
/**
 * Context Bus TagCorrector 冒烟：HTTP adapter + applyTagCorrection
 * 用法（在 worktree 或主树均可，需 FLATTALK_TAG_*）:
 *   node scripts/smoke-tag-corrector.mjs
 */
import 'dotenv/config';
import { createTagSystemAdapter } from '../src/services/interface-data/tag-system-adapter.js';
import { applyTagCorrection } from '../src/core/context-bus/tag-corrector.js';

const BASE = process.env.FLATTALK_TAG_SYSTEM_BASE_URL || 'http://127.0.0.1:8010';
const API_KEY = process.env.FLATTALK_TAG_SYSTEM_API_KEY
  || process.env.FLATTALK_TAG_SYSTEM_TOKEN
  || '';
const ENTITY_ID = process.env.SMOKE_TAG_ENTITY_ID || 'FT_PROBE_8010';

async function main() {
  if (!API_KEY) {
    console.error('缺少 FLATTALK_TAG_SYSTEM_API_KEY');
    process.exit(2);
  }
  if (String(process.env.FLATTALK_TAG_CORRECTOR || '').trim() !== '1') {
    console.warn('警告: FLATTALK_TAG_CORRECTOR != 1（生产路径会跳过校正；本脚本仍直接测 corrector）');
  }

  const adapter = createTagSystemAdapter({
    baseUrl: BASE,
    apiKey: API_KEY,
    preferHttp: true,
  });

  console.log(`Base: ${BASE}`);
  console.log(`Entity: ${ENTITY_ID}`);
  console.log(`adapter.hasApiKey=${adapter.hasApiKey()} configured=${adapter.isConfigured()}`);

  const profile = await adapter.getEntityProfile(ENTITY_ID, { entityType: 'ELDER' });
  console.log(`profile: ok=${profile.ok} source=${profile.source_status} tags=${Array.isArray(profile.data?.tags) ? profile.data.tags.length : -1}`);

  const corrected = await applyTagCorrection({
    user_id: ENTITY_ID,
    entity_id: ENTITY_ID,
    entity_type: 'ELDER',
    identity_status: 'provisional',
    identity_source: 'sso',
  }, { tagReader: adapter, timeoutMs: 5000 });

  console.log(`corrector: status=${corrected.identity_status} source=${corrected.identity_source} entity_type=${corrected.entity_type} tags=${Array.isArray(corrected.tags) ? corrected.tags.length : -1}`);

  const pass = Boolean(profile.ok) && corrected.identity_status === 'confirmed';
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
