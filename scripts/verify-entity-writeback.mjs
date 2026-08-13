// 临时验证：实体回写创建链路 + tag-system HTTP API 创建端点探测
import { getTagSystemBiz } from '../src/services/interface-data/tag-system-biz.js';

const PG_URL = 'postgresql://postgres:123456@localhost:5432/tag_system';
const API_URL = 'http://localhost:5173';
const TEST_ENTITY_ID = 'ELDER_VERIFY_TEST_001';

const biz = getTagSystemBiz(PG_URL);

console.log('\n═══════════════════════════════════════════════════════');
console.log('  实体回写创建链路验证');
console.log('═══════════════════════════════════════════════════════\n');

// ---------- 1. 清理可能残留的测试数据 ----------
console.log('── [1] 清理残留测试数据 ──');
const cleanup = await biz.query("DELETE FROM entity_record WHERE entity_id = $1", [TEST_ENTITY_ID]);
console.log('  结果:', cleanup.ok, '删除:', cleanup.rowCount);

// ---------- 2. INSERT 创建实体 ----------
console.log('\n── [2] INSERT 创建实体 (ELDER_VERIFY_TEST_001) ──');
const insertSql = `
  INSERT INTO entity_record (entity_type, entity_id, entity_name, basic_info, status, tags_count, created_by)
  VALUES ('ELDER', $1, '验证测试老人', '{"source":"flattalk_verify"}'::json, 'ACTIVE', 0, 'flattalk')
  RETURNING id, entity_id, entity_name, status, basic_info
`;
const insertRes = await biz.query(insertSql, [TEST_ENTITY_ID]);
console.log('  请求: INSERT INTO entity_record ... entity_id =', TEST_ENTITY_ID);
console.log('  响应:', JSON.stringify(insertRes, null, 2).replace(/^/gm, '  '));
console.log('  ', insertRes.ok ? '✓ PASS' : '✗ FAIL');

// ---------- 3. 验证写入成功（SELECT 回读） ----------
console.log('\n── [3] SELECT 回读验证 ──');
const selectRes = await biz.query(
  'SELECT id, entity_id, entity_name, status, tags_count FROM entity_record WHERE entity_id = $1',
  [TEST_ENTITY_ID]
);
console.log('  请求: SELECT ... WHERE entity_id =', TEST_ENTITY_ID);
console.log('  响应:', JSON.stringify(selectRes.rows, null, 2).replace(/^/gm, '  '));
console.log('  ', selectRes.ok && selectRes.rows.length === 1 ? '✓ PASS' : '✗ FAIL');

// ---------- 4. 重复 INSERT 应触发唯一约束冲突 ----------
console.log('\n── [4] 重复 INSERT 触发 UNIQUE 约束冲突 ──');
const dupRes = await biz.query(insertSql, [TEST_ENTITY_ID]);
console.log('  响应:', JSON.stringify({ ok: dupRes.ok, error: dupRes.error, code: dupRes.code }, null, 2));
console.log('  ', !dupRes.ok && /unique|duplicate/i.test(dupRes.error || '') ? '✓ PASS (约束生效)' : '✗ FAIL');

// ---------- 5. UPSERT 模式（ON CONFLICT 更新） ----------
console.log('\n── [5] UPSERT 模式 (ON CONFLICT 更新 entity_name) ──');
const upsertSql = `
  INSERT INTO entity_record (entity_type, entity_id, entity_name, basic_info, status, tags_count, created_by)
  VALUES ('ELDER', $1, '验证测试老人_更新', '{"source":"flattalk_verify","v":2}'::json, 'ACTIVE', 0, 'flattalk')
  ON CONFLICT (entity_type, entity_id)
  DO UPDATE SET entity_name = EXCLUDED.entity_name, basic_info = EXCLUDED.basic_info, updated_at = CURRENT_TIMESTAMP
  RETURNING id, entity_id, entity_name, status
`;
const upsertRes = await biz.query(upsertSql, [TEST_ENTITY_ID]);
console.log('  请求: INSERT ... ON CONFLICT (entity_type, entity_id) DO UPDATE ...');
console.log('  响应:', JSON.stringify(upsertRes.rows, null, 2).replace(/^/gm, '  '));
console.log('  ', upsertRes.ok && upsertRes.rows[0]?.entity_name === '验证测试老人_更新' ? '✓ PASS' : '✗ FAIL');

// ---------- 6. tag-system HTTP API 创建端点探测 ----------
console.log('\n── [6] tag-system HTTP API 创建端点探测 (需 token, 预期 401) ──');
const endpoints = [
  { method: 'POST', path: '/api/v1/tags/entities' },
  { method: 'POST', path: '/api/v1/entities' },
  { method: 'POST', path: '/api/v1/tag-system/entities' },
];
for (const ep of endpoints) {
  try {
    const r = await fetch(`${API_URL}${ep.path}`, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'ELDER', entity_id: TEST_ENTITY_ID, entity_name: 'test' }),
      signal: AbortSignal.timeout(3000),
    });
    const body = await r.text().catch(() => '');
    console.log(`  ${ep.method} ${ep.path} → ${r.status} ${body.slice(0, 100)}`);
  } catch (e) {
    console.log(`  ${ep.method} ${ep.path} → ERR ${e.message}`);
  }
}

// ---------- 7. 清理测试数据 ----------
console.log('\n── [7] 清理测试数据 ──');
const finalCleanup = await biz.query("DELETE FROM entity_record WHERE entity_id = $1", [TEST_ENTITY_ID]);
console.log('  删除:', finalCleanup.rowCount, finalCleanup.ok ? '✓' : '✗');

console.log('\n═══════════════════════════════════════════════════════');
console.log('  验证完成');
console.log('═══════════════════════════════════════════════════════\n');

process.exit(0);
