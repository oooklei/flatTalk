#!/usr/bin/env node
/**
 * 对照 Tag-System API 文档验证全部接口（密钥从 .env 读取，不在命令行暴露）。
 * 文档: Tag-System/docs/标签系统API接口文档.md
 *
 * 用法: node scripts/verify-tag-system-api.mjs
 */
import 'dotenv/config';
import { HttpClient } from '../src/services/interface-data/http-client.js';
import { createTagSystemAdapter } from '../src/services/interface-data/tag-system-adapter.js';

const BASE = process.env.FLATTALK_TAG_SYSTEM_BASE_URL || 'http://127.0.0.1:8010';
const API_KEY = process.env.FLATTALK_TAG_SYSTEM_API_KEY
  || process.env.FLATTALK_TAG_SYSTEM_TOKEN
  || process.env.TAG_SYSTEM_CLIENT_KEY
  || '';

const VERIFY_ID = `FT_VERIFY_${Date.now().toString(36)}`;
const ENTITY_TYPE = 'ELDER';

const results = [];

function record(name, method, path, res, expectOk = true) {
  const pass = expectOk ? Boolean(res?.ok) : !res?.ok;
  const row = {
    name,
    method,
    path,
    status: res?.status ?? 0,
    ok: Boolean(res?.ok),
    pass,
    error: res?.error || (res?.ok ? '' : summarize(res?.data)),
  };
  results.push(row);
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${method} ${path} → ${row.status} ${row.error || ''}`.trim());
  return res;
}

function summarize(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data.slice(0, 120);
  if (data.detail) return String(data.detail).slice(0, 160);
  if (data.message) return String(data.message).slice(0, 160);
  try {
    return JSON.stringify(data).slice(0, 160);
  } catch {
    return '';
  }
}

async function main() {
  if (!API_KEY) {
    console.error('缺少 FLATTALK_TAG_SYSTEM_API_KEY（请写入 flatTalk/.env）');
    process.exit(2);
  }

  console.log(`Base: ${BASE}`);
  console.log(`API Key: ${API_KEY.slice(0, 12)}…${API_KEY.slice(-4)} (len=${API_KEY.length})`);
  console.log(`Verify entity: ${ENTITY_TYPE}/${VERIFY_ID}`);
  console.log('---');

  const authed = new HttpClient({
    baseUrl: BASE,
    timeoutMs: 20000,
    defaultHeaders: { 'X-API-Key': API_KEY },
  });
  const anon = new HttpClient({ baseUrl: BASE, timeoutMs: 10000 });

  // 1 health
  record('health', 'GET', '/api/v1/health', await anon.get('/api/v1/health'));

  // auth negative
  record('definitions_no_key', 'GET', '/api/v1/tags/definitions', await anon.get('/api/v1/tags/definitions'), false);

  // Bearer JWT 槽位塞 API Key 应失败（文档要求 X-API-Key）
  const bearerWrong = new HttpClient({
    baseUrl: BASE,
    timeoutMs: 10000,
    defaultHeaders: { Authorization: `Bearer ${API_KEY}` },
  });
  record(
    'definitions_bearer_api_key',
    'GET',
    '/api/v1/tags/definitions',
    await bearerWrong.get('/api/v1/tags/definitions'),
    false,
  );

  // 2 definitions
  const defs = record('definitions', 'GET', '/api/v1/tags/definitions', await authed.get('/api/v1/tags/definitions?status=ACTIVE'));
  const defList = Array.isArray(defs?.data) ? defs.data : [];
  // 优先选适用于 ELDER 的标签，避免一体化写入因实体类型不匹配 500
  const elderTag = defList.find((d) => Array.isArray(d.entity_types) && d.entity_types.includes('ELDER'))
    || defList.find((d) => d.tag_code === 'HEALTH_STATUS')
    || defList[0];
  const firstCode = elderTag?.tag_code || 'HEALTH_STATUS';
  console.log(`Using tag_code=${firstCode} for write tests`);
  record('definition_one', 'GET', `/api/v1/tags/definitions/${firstCode}`, await authed.get(`/api/v1/tags/definitions/${encodeURIComponent(firstCode)}`));

  // 4.1 upsert entity with tags (setup for later GETs)
  const upsert = record(
    'upsert_with_tags',
    'POST',
    `/api/v1/entities/${ENTITY_TYPE}/upsert-with-tags`,
    await authed.post(`/api/v1/entities/${ENTITY_TYPE}/upsert-with-tags`, {
      entity_id: VERIFY_ID,
      entity_name: 'flatTalk接口校验',
      basic_info: { gender: 'M', age: 70, source: 'verify' },
      tags: [
        { tag_code: firstCode, tag_value: 'TRUE', source: 'MANUAL' },
      ],
    }),
  );

  // 4.2 batch upsert
  record(
    'batch_upsert_with_tags',
    'POST',
    `/api/v1/entities/${ENTITY_TYPE}/batch-upsert-with-tags`,
    await authed.post(`/api/v1/entities/${ENTITY_TYPE}/batch-upsert-with-tags`, {
      items: [
        {
          entity_id: `${VERIFY_ID}_B`,
          entity_name: 'flatTalk批量校验',
          tags: [{ tag_code: firstCode, tag_value: 'TRUE', source: 'EXTERNAL' }],
        },
      ],
    }),
  );

  // 3 entity reads
  record('entity_by_type', 'GET', `/api/v1/entities/${ENTITY_TYPE}/${VERIFY_ID}`, await authed.get(`/api/v1/entities/${ENTITY_TYPE}/${encodeURIComponent(VERIFY_ID)}`));
  record('entity_by_id', 'GET', `/api/v1/entities/by-id/${VERIFY_ID}`, await authed.get(`/api/v1/entities/by-id/${encodeURIComponent(VERIFY_ID)}`));
  record('entity_full', 'GET', `/api/v1/entities/by-id/${VERIFY_ID}/full`, await authed.get(`/api/v1/entities/by-id/${encodeURIComponent(VERIFY_ID)}/full`));
  record('entity_check', 'GET', `/api/v1/entities/by-id/${VERIFY_ID}/check`, await authed.get(`/api/v1/entities/by-id/${encodeURIComponent(VERIFY_ID)}/check?tag_code=${encodeURIComponent(firstCode)}`));

  // 5 tags ops
  record('list_entity_tags', 'GET', `/api/v1/tags/entities/${ENTITY_TYPE}/${VERIFY_ID}/tags`, await authed.get(`/api/v1/tags/entities/${ENTITY_TYPE}/${encodeURIComponent(VERIFY_ID)}/tags`));

  const writeTagCode = `FT_TMP_${Date.now().toString(36).toUpperCase()}`;
  // 单标签写入可能因 tag_code 未在定义表而失败——仍记录结果
  record(
    'create_entity_tag',
    'POST',
    `/api/v1/tags/entities/${ENTITY_TYPE}/${VERIFY_ID}/tags`,
    await authed.post(`/api/v1/tags/entities/${ENTITY_TYPE}/${encodeURIComponent(VERIFY_ID)}/tags`, {
      tag_code: firstCode,
      tag_value: 'UPDATED',
      source: 'EXTERNAL',
    }),
  );
  record(
    'batch_entity_tags',
    'POST',
    `/api/v1/tags/entities/${ENTITY_TYPE}/${VERIFY_ID}/tags/batch`,
    await authed.post(`/api/v1/tags/entities/${ENTITY_TYPE}/${encodeURIComponent(VERIFY_ID)}/tags/batch`, {
      tags: [{ tag_code: firstCode, tag_value: 'BATCH', source: 'EXTERNAL' }],
    }),
  );
  record(
    'batch_multi_entities_tags',
    'POST',
    '/api/v1/tags/entities/batch-tags',
    await authed.post('/api/v1/tags/entities/batch-tags', {
      items: [
        {
          entity_type: ENTITY_TYPE,
          entity_id: VERIFY_ID,
          tags: [{ tag_code: firstCode, tag_value: 'MULTI', source: 'EXTERNAL' }],
        },
      ],
    }),
  );
  record(
    'update_entity_tag',
    'PUT',
    `/api/v1/tags/entities/${ENTITY_TYPE}/${VERIFY_ID}/tags/${firstCode}`,
    await authed.put(`/api/v1/tags/entities/${ENTITY_TYPE}/${encodeURIComponent(VERIFY_ID)}/tags/${encodeURIComponent(firstCode)}`, {
      tag_value: 'PUT_OK',
      source: 'EXTERNAL',
    }),
  );
  record(
    'search_entities',
    'POST',
    '/api/v1/tags/entities/search',
    await authed.post('/api/v1/tags/entities/search', {
      entity_type: ENTITY_TYPE,
      conditions: [{ tag_code: firstCode }],
      limit: 5,
    }),
  );

  // 6 business data — may be empty but auth+route should work (200 or 404)
  const bd1 = await authed.get(`/api/v1/business-data/by-entity/${ENTITY_TYPE}/${encodeURIComponent(VERIFY_ID)}/service_order`);
  results.push({
    name: 'business_by_entity',
    method: 'GET',
    path: `/api/v1/business-data/by-entity/${ENTITY_TYPE}/${VERIFY_ID}/service_order`,
    status: bd1.status,
    ok: bd1.ok,
    pass: bd1.status === 200 || bd1.status === 404 || bd1.status === 422,
    error: bd1.ok ? '' : summarize(bd1.data) || bd1.error || '',
  });
  console.log(`[${results.at(-1).pass ? 'PASS' : 'FAIL'}] GET business-data/by-entity → ${bd1.status}`);

  const bd2 = await authed.get('/api/v1/business-data/service_order?limit=5');
  results.push({
    name: 'business_list',
    method: 'GET',
    path: '/api/v1/business-data/service_order',
    status: bd2.status,
    ok: bd2.ok,
    pass: bd2.status === 200 || bd2.status === 404 || bd2.status === 422,
    error: bd2.ok ? '' : summarize(bd2.data) || bd2.error || '',
  });
  console.log(`[${results.at(-1).pass ? 'PASS' : 'FAIL'}] GET business-data/list → ${bd2.status}`);

  // delete tag (cleanup attempt)
  record(
    'delete_entity_tag',
    'DELETE',
    `/api/v1/tags/entities/${ENTITY_TYPE}/${VERIFY_ID}/tags/${firstCode}`,
    await authed.delete(`/api/v1/tags/entities/${ENTITY_TYPE}/${encodeURIComponent(VERIFY_ID)}/tags/${encodeURIComponent(firstCode)}`),
  );

  // adapter smoke
  const adapter = createTagSystemAdapter({ baseUrl: BASE, apiKey: API_KEY, preferHttp: true });
  const profile = await adapter.getEntityProfile(VERIFY_ID, { entityType: ENTITY_TYPE });
  results.push({
    name: 'adapter_getEntityProfile',
    method: 'ADAPTER',
    path: 'getEntityProfile',
    status: profile.http_status || (profile.ok ? 200 : 0),
    ok: profile.ok,
    pass: Boolean(profile.ok),
    error: profile.error || '',
  });
  console.log(`[${profile.ok ? 'PASS' : 'FAIL'}] adapter.getEntityProfile → ${profile.source_status}`);

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log('---');
  console.log(`Summary: ${passed}/${results.length} pass`);
  if (failed.length) {
    console.log('Failures:');
    for (const f of failed) {
      console.log(` - ${f.name}: ${f.status} ${f.error}`);
    }
  }

  // 不把密钥写入报告
  const report = {
    base: BASE,
    api_key_prefix: `${API_KEY.slice(0, 12)}…`,
    verify_entity_id: VERIFY_ID,
    upsert_ok: Boolean(upsert?.ok),
    passed,
    total: results.length,
    results: results.map(({ name, method, path, status, ok, pass, error }) => ({
      name, method, path, status, ok, pass, error,
    })),
  };
  const outPath = new URL('./_out_tag_api_verify.json', import.meta.url);
  const fs = await import('node:fs');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${outPath.pathname || outPath}`);

  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
