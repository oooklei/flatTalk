/**
 * LIS 扩容前后基线对比
 *
 * 流程：
 *   1. 备份当前 LIS 意图库
 *   2. 用 27 条真实用例测「9 条意图」基线
 *   3. 灌入 87 条候选意图
 *   4. 同样用例测「87 条意图」表现
 *   5. 输出对比表；--restore 可还原
 *
 * 只调 /admin/* 与 /v1/sort，不触碰 flatTalk 运行时。
 */
import fs from 'node:fs';

const LIS = process.env.LIS_BASE_URL || 'http://127.0.0.1:8100';
const CAND = 'd:\\GuiCare\\flatTalk\\docs\\LIS-System\\intent-kb.candidates.json';
const BACKUP = 'd:\\GuiCare\\flatTalk\\docs\\LIS-System\\intent-kb.backup.json';

/** utterance → 期望 domain */
const CASES = [
  ['附近有什么好吃的', 'nearby_resource'],
  ['周边有医院吗', 'nearby_resource'],
  ['附近住宿推荐', 'nearby_resource'],
  ['周围有什么景点', 'nearby_resource'],
  ['帮我规划巴马5天旅居', 'travel_route'],
  ['旅居预算大概多少', 'travel_route'],
  ['今天天气怎么样适合出行吗', 'travel_route'],
  ['有哪些康养基地', 'travel_route'],
  ['交通怎么安排', 'travel_route'],
  ['我头晕血压高怎么办', 'health_risk_warning'],
  ['帮我看看舌苔', 'health_risk_warning'],
  ['最近失眠严重', 'health_risk_warning'],
  ['我的健康报告', 'health_risk_warning'],
  ['看看养老机构', 'find_service'],
  ['护工上门多少钱', 'find_service'],
  ['我要下单', 'find_service'],
  ['服务目录看一下', 'find_service'],
  ['订单状态查询', 'find_service'],
  ['给我做个一周食谱', 'meal_plan'],
  ['糖尿病吃什么好', 'meal_plan'],
  ['早餐建议', 'meal_plan'],
  ['派单列表看一下', 'dispatch_manage'],
  ['我要接单', 'dispatch_manage'],
  ['工单进度', 'dispatch_manage'],
  ['养老补贴政策', 'common'],
  ['高龄津贴怎么申请', 'common'],
  ['机构服务质量排名', 'service_quality_eval'],
];

const LOG = 'd:\\GuiCare\\flatTalk\\docs\\LIS-System\\baseline-report.txt';
const _lines = [];
function log(s = '') {
  const t = String(s);
  _lines.push(t);
  console.log(t);
  try { fs.writeFileSync(LOG, _lines.join('\n'), 'utf8'); } catch { /* ignore */ }
}

async function jf(url, opts = {}) {
  // 灌库时 LIS 会重建向量索引并持写锁，需要较长超时
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(process.env.REQ_TIMEOUT_MS || 60000));
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : {};
  } finally {
    clearTimeout(timer);
  }
}

const listIntents = () => jf(`${LIS}/admin/intents`);

async function putIntents(entries, existingIds = new Set()) {
  let ok = 0; let skip = 0; const errs = [];
  for (const e of entries) {
    if (existingIds.has(String(e.intent_id))) { skip += 1; continue; }
    try {
      await jf(`${LIS}/admin/intents`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent_id: e.intent_id,
          domain: e.domain,
          description: e.description,
          anchors: e.anchors,
          enabled: e.enabled !== false,
        }),
      });
      ok += 1;
      if (ok % 10 === 0) log(`  ...已灌入 ${ok} 条`);
    } catch (err) { errs.push(`${e.intent_id}: ${err.message}`); }
  }
  return { ok, skip, errs };
}

async function runSuite(label) {
  let hit = 0; let clarify = 0;
  const miss = [];
  for (const [utt, want] of CASES) {
    try {
      const j = await jf(`${LIS}/v1/sort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utterance: utt }),
      });
      const top = (j.intents || [])[0];
      const got = top?.domain_hint || '';
      const st = j.decision?.status || '';
      if (st === 'NEED_CLARIFY') clarify += 1;
      if (got === want) hit += 1;
      else miss.push(`  MISS [${utt}] want=${want} got=${got || '空'}/${top?.intent_id || '-'} conf=${(top?.confidence ?? 0).toFixed(2)} ${st}`);
    } catch (err) { miss.push(`  ERR  [${utt}] ${err.message}`); }
  }
  log(`\n===== ${label} =====`);
  log(`domain 命中: ${hit}/${CASES.length}  (${(hit / CASES.length * 100).toFixed(0)}%)   NEED_CLARIFY: ${clarify}`);
  if (miss.length) { log('未命中明细:'); miss.forEach((m) => log(m)); }
  return { hit, total: CASES.length, clarify };
}

// ---- main ----
const mode = process.argv[2] || '';

if (mode === '--restore') {
  if (!fs.existsSync(BACKUP)) { console.error('无备份文件'); process.exit(1); }
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  const cur = await listIntents();
  for (const e of cur.intents || []) {
    await fetch(`${LIS}/admin/intents/${encodeURIComponent(e.intent_id)}`, { method: 'DELETE' });
  }
  const { ok, errs } = await putIntents(bak.intents || []);
  log(`已还原 ${ok} 条意图` + (errs.length ? `，失败 ${errs.length}` : ''));
  process.exit(0);
}

const before = await listIntents();
const beforeCount = before.intents?.length || 0;
log(`当前 LIS 意图库: ${beforeCount} 条`);

if (!fs.existsSync(BACKUP)) {
  fs.writeFileSync(BACKUP, JSON.stringify(before, null, 2), 'utf8');
  log(`已备份 → ${BACKUP}`);
} else {
  log(`备份已存在（保留首次的 9 条基线）: ${BACKUP}`);
}

const cand = JSON.parse(fs.readFileSync(CAND, 'utf8'));
const existing = new Set((before.intents || []).map((e) => String(e.intent_id)));

// 仅在意图库仍为原始基线规模时跑基线用例；已部分灌入则跳过（基线数据取自备份记录）
const bakCount = JSON.parse(fs.readFileSync(BACKUP, 'utf8')).intents?.length || 0;
let base = null;
if (beforeCount <= bakCount) {
  base = await runSuite(`基线：${beforeCount} 条意图`);
} else {
  log(`\n[跳过基线用例] 意图库已从 ${bakCount} 扩至 ${beforeCount} 条（上次运行中断），直接续灌。`);
}

log(`\n续灌候选意图（共 ${cand.intents.length} 条，已存在 ${existing.size} 条将跳过）...`);
const { ok, skip, errs } = await putIntents(cand.intents, existing);
log(`新灌入 ${ok} 条，跳过 ${skip} 条` + (errs.length ? `，失败 ${errs.length}：\n  ${errs.slice(0, 5).join('\n  ')}` : ''));

const after = await listIntents();
const afterCount = after.intents?.length || 0;
log(`扩容后意图库: ${afterCount} 条`);

const exp = await runSuite(`扩容后：${afterCount} 条意图`);

log('\n########## 对比结论 ##########');
log(`意图库规模   ${bakCount}(备份基线) → ${afterCount}`);
if (base) {
  log(`domain 命中  ${base.hit}/${base.total} → ${exp.hit}/${exp.total}`);
  log(`NEED_CLARIFY ${base.clarify} → ${exp.clarify}`);
  const d = exp.hit - base.hit;
  log(d > 0 ? `\n结论：扩容提升 +${d} 条命中` : d === 0 ? '\n结论：命中数持平' : `\n结论：扩容导致下降 ${d} 条，需细化 anchors`);
} else {
  log(`domain 命中（扩容后）  ${exp.hit}/${exp.total}  (${(exp.hit / exp.total * 100).toFixed(0)}%)`);
  log(`NEED_CLARIFY           ${exp.clarify}`);
  log('\n注：基线数据见本轮之前的 9 条实测（9/10 domain 命中）。');
}
log(`\n报告已写入: ${LOG}`);
log('还原命令: node scripts/lis-baseline-compare.mjs --restore');
