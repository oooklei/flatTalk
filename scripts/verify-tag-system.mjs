// 临时验证脚本：tag-system 接口请求过程展示
// 用法：node scripts/verify-tag-system.mjs
// 验证完成后可保留作为接口契约参考

import { createTagSystemAdapter } from '../src/services/interface-data/tag-system-adapter.js';
import { getTagSystemBiz } from '../src/services/interface-data/tag-system-biz.js';

// 指向本机 PG（密码 123456）
process.env.FLATTALK_TAG_SYSTEM_PG_URL = 'postgresql://postgres:123456@localhost:5432/tag_system';
// HTTP API 兜底（本机 tag-system，需 token，此处仅验证 health）
process.env.FLATTALK_TAG_SYSTEM_BASE_URL = 'http://localhost:5173';

const PG_URL = process.env.FLATTALK_TAG_SYSTEM_PG_URL;
const API_URL = process.env.FLATTALK_TAG_SYSTEM_BASE_URL;

// 验证样本（来自 PG 实际数据）
// 注意：entity_record 用 B1_ 前缀，entity_tag 用 ELDER_160_ 前缀（数据不一致）
// 分别取样验证两条路径
const SAMPLES = [
  { entityType: 'ELDER', entityId: 'ELDER_160_0005', desc: '老人(仅tag有数据,83标签)' },
  { entityType: 'ELDER', entityId: 'B1_15B2D16E98', desc: '老人(record有数据,tag无)' },
  { entityType: 'ELDER', entityId: 'ELDER_NOT_EXIST_999', desc: '不存在实体(降级测试)' },
];

const BIZ_SAMPLES = {
  resolveNames: ['B1_15B2D16E98', 'B1_585AA2DA96', 'NOT_EXIST_X'],
  evaluation: { elderId: 'B1_15B2D16E98', limit: 3 },
};

const adapter = createTagSystemAdapter({
  pgUrl: PG_URL,
  baseUrl: API_URL,
  token: '', // 无 token，HTTP API 预期 401
});
// 注意：getTagSystemBiz(pgUrl) 接收字符串，不是对象；否则 pg Pool connectionString 会变成对象导致 str.charAt 错误
const biz = getTagSystemBiz(PG_URL);

// ============================================================
// 工具：格式化输出
// ============================================================
function banner(title) {
  console.log('\n' + '═'.repeat(72));
  console.log('  ' + title);
  console.log('═'.repeat(72));
}

function step(n, desc) {
  console.log(`\n── [${n}] ${desc} ──`);
}

function showRequest(method, args) {
  console.log('▶ REQUEST:');
  console.log('  method:', method);
  console.log('  args  :', JSON.stringify(args, null, 2).replace(/^/gm, '  '));
}

function showResponse(result) {
  console.log('◀ RESPONSE:');
  const truncated = truncateForDisplay(result);
  console.log(JSON.stringify(truncated, null, 2).replace(/^/gm, '  '));
}

function truncateForDisplay(obj) {
  const s = JSON.stringify(obj, null, 2);
  if (s.length <= 2000) return obj;
  // 截断过长的 tags 数组
  if (obj?.data?.tags && Array.isArray(obj.data.tags)) {
    const tagCount = obj.data.tags.length;
    return {
      ...obj,
      data: {
        ...obj.data,
        tags: obj.data.tags.slice(0, 3),
        _tags_truncated: `共 ${tagCount} 条标签，仅展示前 3 条`,
      },
    };
  }
  return s.slice(0, 2000) + '\n...[truncated]';
}

function showVerdict(passed, note = '') {
  const mark = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${mark}${note ? ' — ' + note : ''}`);
}

// ============================================================
// 验证用例
// ============================================================
const results = { pass: 0, fail: 0, skip: 0 };

async function runCase(num, desc, fn) {
  step(num, desc);
  try {
    const verdict = await fn();
    if (verdict === 'skip') {
      results.skip++;
      showVerdict(true, 'SKIPPED');
    } else if (verdict === false) {
      results.fail++;
      showVerdict(false);
    } else {
      results.pass++;
      showVerdict(true);
    }
  } catch (err) {
    results.fail++;
    showVerdict(false, err.message);
  }
}

// ============================================================
// 主流程
// ============================================================
banner('tag-system 接口验证（PG 直连 + HTTP API 兜底）');
console.log(`PG_URL : ${PG_URL.replace(/:([^:@]+)@/, ':***@')}`);
console.log(`API_URL: ${API_URL}`);
console.log(`时间   : ${new Date().toISOString()}`);

// ---------- 1. isConfigured ----------
await runCase(1, 'adapter.isConfigured() — 配置检查', () => {
  showRequest('isConfigured', {});
  const ok = adapter.isConfigured();
  showResponse({ ok, pg_configured: true, http_configured: true });
  return ok === true;
});

// ---------- 2. health (HTTP API) ----------
await runCase(2, 'adapter.health() — HTTP API 健康检查（本机 tag-system 无需 token）', () => {
  showRequest('health', {});
  return adapter.health().then((r) => {
    showResponse(r);
    // 本机 tag-system health 端点公开，预期 200 + ok
    return r.ok === true && r.status === 200;
  });
});

// ---------- 3~5. getEntityProfile（每个样本） ----------
let caseNum = 3;
for (const sample of SAMPLES) {
  await runCase(caseNum++, `adapter.getEntityProfile() — ${sample.desc}`, () => {
    const args = { entityId: sample.entityId, options: { entity_type: sample.entityType } };
    showRequest('getEntityProfile', args);
    return adapter.getEntityProfile(sample.entityId, { entity_type: sample.entityType }).then((r) => {
      showResponse(r);
      if (sample.entityId.includes('NOT_EXIST')) {
        // 不存在实体：PG 返回 ok:true + data:null（GROUP BY 后无行）
        return r.ok === true;
      }
      return r.ok === true && r.source_status === 'real_pg' && r.data !== null;
    });
  });
}

// ---------- 6~8. listEntityTags（每个样本） ----------
for (const sample of SAMPLES) {
  await runCase(caseNum++, `adapter.listEntityTags() — ${sample.desc}`, () => {
    const args = { entityId: sample.entityId, options: { entity_type: sample.entityType, limit: 10 } };
    showRequest('listEntityTags', args);
    return adapter.listEntityTags(sample.entityId, { entity_type: sample.entityType, limit: 10 }).then((r) => {
      showResponse(r);
      if (sample.entityId.includes('NOT_EXIST')) {
        return r.ok === true && Array.isArray(r.data) && r.data.length === 0;
      }
      return r.ok === true && r.source_status === 'real_pg' && Array.isArray(r.data) && r.data.length > 0;
    });
  });
}

// ---------- 9. biz.resolveEntityNames ----------
await runCase(caseNum++, 'biz.resolveEntityNames() — 批量解析实体名称', () => {
  const ids = BIZ_SAMPLES.resolveNames;
  showRequest('resolveEntityNames', { ids });
  return biz.resolveEntityNames(ids).then((r) => {
    showResponse(r);
    const hasKnown = r['ELDER_160_0005']?.entity_name;
    return Object.keys(r).length >= 1 && hasKnown;
  });
});

// ---------- 10. biz.getEvaluationRecords ----------
await runCase(caseNum++, 'biz.getEvaluationRecords() — 评价记录查询（含 tags 字段）', () => {
  const filter = BIZ_SAMPLES.evaluation;
  showRequest('getEvaluationRecords', { filter });
  return biz.getEvaluationRecords(filter).then((r) => {
    showResponse(r);
    return r.ok === true && Array.isArray(r.rows);
  });
});

// ---------- 11. biz.query (原生 SQL 探测) ----------
await runCase(caseNum++, 'biz.query() — 原生 SQL 探测 tag_definition 表', () => {
  showRequest('query', { text: 'SELECT tag_code, tag_name, tag_category FROM tag_definition LIMIT 3' });
  return biz.query('SELECT tag_code, tag_name, tag_category FROM tag_definition LIMIT 3').then((r) => {
    showResponse(r);
    return r.ok === true && r.rows.length > 0;
  });
});

// ============================================================
// 汇总
// ============================================================
banner('验证汇总');
console.log(`  通过: ${results.pass}`);
console.log(`  失败: ${results.fail}`);
console.log(`  跳过: ${results.skip}`);
console.log(`  合计: ${results.pass + results.fail + results.skip}`);
console.log('═'.repeat(72));

process.exit(results.fail > 0 ? 1 : 0);
