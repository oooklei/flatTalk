import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

import { runLocalSkill } from '../src/runtime/local-skill-runtime.js';
import { dispatchAction } from '../src/core/actions/action-dispatcher.js';
import { getTraceLogger } from '../src/core/observability/trace-logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'docs', 'flatTalk模板配置语义手册_v1.0_测试脚本.txt');
const OUT_DIR = path.join(ROOT, 'docs', 'reports');

const RUN_ID = `template-audit-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const text = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const cases = parseCases(text);
  const startedAt = new Date();
  runCases(cases)
    .then((rows) => {
      const endedAt = new Date();
      const logs = collectLogs(rows);
      const coverage = buildCoverage(text, rows);
      const summary = buildSummary(rows, logs, startedAt, endedAt);
      const assessment = buildAssessment(rows, logs, coverage);
      const xlsxPath = path.join(OUT_DIR, `${RUN_ID}.xlsx`);
      const jsonPath = path.join(OUT_DIR, `${RUN_ID}.json`);
      const mdPath = path.join(OUT_DIR, `${RUN_ID}-评估意见.md`);
      writeWorkbook(xlsxPath, { summary, rows, logs, coverage, assessment });
      fs.writeFileSync(jsonPath, JSON.stringify({ run_id: RUN_ID, summary, rows, logs, coverage, assessment }, null, 2), 'utf8');
      fs.writeFileSync(mdPath, renderMarkdown(summary, assessment), 'utf8');
      console.log(JSON.stringify({ ok: true, run_id: RUN_ID, cases: rows.length, xlsx: xlsxPath, json: jsonPath, markdown: mdPath }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

function parseCases(text) {
  const lines = text.split(/\r?\n/);
  const cases = [];
  let moduleName = '';
  let current = null;

  const flush = () => {
    if (!current) return;
    normalizeCase(current);
    cases.push(current);
    current = null;
  };

  for (const line of lines) {
    const moduleMatch = line.match(/^#\s*模块[^：:]*[：:]\s*(.+)$/);
    if (moduleMatch) moduleName = moduleMatch[1].replace(/#+/g, '').trim();

    const caseMatch = line.match(/^【([^】]+)】(.+)$/);
    if (caseMatch) {
      flush();
      current = {
        id: caseMatch[1].trim(),
        title: caseMatch[2].trim(),
        module: moduleName,
        input: '',
        action_key: '',
        expected_skill: '',
        expected_intent: '',
        expected_template: '',
        expected_output: '',
        checks: [],
        raw: [line],
      };
      continue;
    }
    if (!current) continue;
    current.raw.push(line);
    const trimmed = line.trim();
    if (/^输入[：:]/.test(trimmed) && !current.input) current.input = trimmed.replace(/^输入[：:]\s*/, '').trim();
    if (/^(点击|动作)[：:]/.test(trimmed) && !current.action_key) {
      current.action_key = extractActionKey(trimmed);
    }
    if (/action_key\s*[:：]\s*([a-zA-Z0-9_.-]+)/.test(trimmed) && !current.action_key) {
      current.action_key = extractActionKey(trimmed);
    }
    if (/^预期[：:]/.test(trimmed)) {
      const expected = trimmed.replace(/^预期[：:]\s*/, '').trim();
      current.expected_output = appendText(current.expected_output, expected);
      current.expected_skill = pickAssign(expected, 'skill_key') || current.expected_skill;
      current.expected_intent = pickAssign(expected, 'intent') || current.expected_intent;
      current.expected_template = pickAssign(expected, 'template_id') || current.expected_template;
      current.expected_result_type = pickAssign(expected, 'result_type') || current.expected_result_type || '';
      current.negative_expectation = inferNegativeExpectation(expected);
    }
    if (/^检查[：:]/.test(trimmed)) current.checks.push(trimmed.replace(/^检查[：:]\s*/, '').trim());
  }
  flush();
  return cases.filter((item) => item.input || item.action_key || item.expected_skill || item.expected_template);
}

function normalizeCase(item) {
  if (!item.action_key) item.action_key = extractActionKey(item.raw.join('\n'));
  if (!item.expected_template && item.expected_output) {
    const template = item.expected_output.match(/template_id\s*=\s*([a-zA-Z0-9_]+)/);
    if (template) item.expected_template = template[1];
  }
  if (!item.expected_skill && item.expected_output) {
    const skill = item.expected_output.match(/skill_key\s*=\s*([a-zA-Z0-9_]+)/);
    if (skill) item.expected_skill = skill[1];
  }
  item.kind = item.input ? 'chat' : 'action';
}

function extractActionKey(text) {
  return (String(text || '').match(/action_key\s*[:：]\s*([a-zA-Z0-9_.-]+)/) || [])[1] || '';
}

function pickAssign(text, key) {
  const re = new RegExp(`${key}\\s*=\\s*([a-zA-Z0-9_.-]+)`);
  return (String(text || '').match(re) || [])[1] || '';
}

function inferNegativeExpectation(text) {
  if (/不应命中\s*nearby_resource/.test(text)) return 'not_nearby_resource';
  if (/不应.*travel_route|不应强行当旅居规划/.test(text)) return 'not_strong_travel_route';
  if (/不能返回\s*diet_card/.test(text)) return 'not_diet_card';
  return '';
}

async function runCases(cases) {
  const rows = [];
  for (const [index, item] of cases.entries()) {
    const conversationId = `${RUN_ID}-${item.id}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
    const requestId = `req-${RUN_ID}-${index + 1}`;
    const turnId = `turn-${RUN_ID}-${index + 1}`;
    const started = performance.now();
    let result;
    let error = '';
    try {
      if (item.kind === 'action') {
        result = await dispatchAction({
          action_key: item.action_key,
          params: {},
          conversation_id: conversationId,
          request_id: requestId,
          turn_id: turnId,
        }, { runSkill: runLocalSkill });
      } else {
        result = await runLocalSkill({
          message: item.input,
          conversation_id: conversationId,
          request_id: requestId,
          turn_id: turnId,
          context: item.action_key ? { action_key: item.action_key, action_params: {}, followup_source: 'script_inline_action' } : {},
        }, {});
      }
    } catch (err) {
      error = err?.stack || err?.message || String(err);
    }
    const elapsedMs = Math.round(performance.now() - started);
    const envelope = item.kind === 'action' ? result?.envelope : result;
    const actual = normalizeActual(item, result, envelope, elapsedMs, error, conversationId);
    rows.push({
      序号: index + 1,
      测试编号: item.id,
      模块: item.module,
      标题: item.title,
      类型: item.kind,
      输入或动作: item.input || item.action_key,
      action_key: item.action_key,
      预期skill_key: item.expected_skill,
      实际skill_key: actual.skill_key,
      预期intent: item.expected_intent,
      实际intent: actual.intent,
      预期template_id: item.expected_template,
      实际template_id: actual.template_id,
      预期输出检查: [item.expected_output, ...item.checks].filter(Boolean).join('；'),
      实际输出摘要: actual.answer,
      路由是否正确: judgeRoute(item, actual),
      模板是否正确: judgeTemplate(item, actual),
      输出是否合理: judgeOutput(item, actual),
      动作是否同场景: judgeSameSceneActions(actual),
      渲染是否正常: actual.render_ok ? '通过' : '不通过',
      result_type: actual.result_type,
      route_source: actual.route_source,
      route_decision: actual.route_decision,
      route_confidence: actual.route_confidence,
      model_used: actual.model_used,
      model_status: actual.model_status,
      knowledge_status: actual.knowledge_status,
      耗时ms: elapsedMs,
      conversation_id: conversationId,
      错误: error,
      备注: buildRemark(item, actual, error),
    });
  }
  return rows;
}

function normalizeActual(item, result, envelope, elapsedMs, error, conversationId) {
  const actual = {
    skill_key: envelope?.skill_key || '',
    intent: envelope?.intent || envelope?.route?.intent || '',
    template_id: envelope?.template_id || envelope?.card?.templateId || '',
    answer: compact(envelope?.answer_text || envelope?.answer || envelope?.message || result?.error || error, 240),
    result_type: result?.result_type || (item.kind === 'chat' ? 'chat_envelope' : ''),
    route_source: envelope?.route?.source || '',
    route_decision: envelope?.route?.decision || '',
    route_confidence: envelope?.route?.confidence ?? '',
    model_used: envelope?.route?.model_used || envelope?.llm?.model_used || '',
    model_status: envelope?.llm?.model_status || '',
    knowledge_status: envelope?.route?.knowledge_status || '',
    render_ok: Boolean(envelope?.rendered_html || envelope?.card?.renderStatus === 'ok' || envelope?.route?.render_status === 'ok'),
    actions: Array.isArray(envelope?.actions) ? envelope.actions : [],
    followups: Array.isArray(envelope?.followup_suggestions) ? envelope.followup_suggestions : [],
    elapsedMs,
    error,
    conversationId,
  };
  if (item.kind === 'action' && !envelope) {
    actual.skill_key = '';
    actual.template_id = '';
    actual.result_type = result?.result_type || '';
    actual.answer = compact(result?.error || error || JSON.stringify(result || {}), 240);
  }
  return actual;
}

function judgeRoute(item, actual) {
  if (item.negative_expectation === 'not_nearby_resource') return actual.skill_key !== 'nearby_resource' ? '通过' : '不通过';
  if (item.negative_expectation === 'not_strong_travel_route') {
    return actual.skill_key !== 'travel_route' || actual.route_decision !== 'accept' ? '通过' : '不通过';
  }
  if (!item.expected_skill) return actual.error ? '不通过' : '人工复核';
  return actual.skill_key === item.expected_skill ? '通过' : '不通过';
}

function judgeTemplate(item, actual) {
  if (item.negative_expectation === 'not_diet_card') return actual.template_id !== 'diet_card' ? '通过' : '不通过';
  if (!item.expected_template) return actual.render_ok ? '人工复核' : '不通过';
  const expected = item.expected_template.split(/\s*或\s*|\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  return expected.includes(actual.template_id) ? '通过' : '不通过';
}

function judgeOutput(item, actual) {
  if (actual.error) return '不通过';
  if (!actual.answer || /^抱歉，我暂时无法处理/.test(actual.answer)) {
    if (/友好|兜底|补充|不能作确定诊断|权限不足/.test(item.expected_output)) return '通过';
    return '不通过';
  }
  if (!actual.render_ok && item.kind !== 'action') return '不通过';
  return '通过';
}

function judgeSameSceneActions(actual) {
  const skill = actual.skill_key;
  if (!skill) return '不适用';
  const keys = [
    ...actual.actions.map((a) => a.action_key || a.key || ''),
    ...actual.followups.map((a) => a.action_key || a.key || ''),
  ].filter(Boolean);
  if (!keys.length) return '不适用';
  const allowed = skill === 'find_service'
    ? (key) => key.startsWith('find_service.') || key.startsWith('sos.')
    : (key) => key.startsWith(`${skill}.`);
  return keys.every(allowed) ? '通过' : '不通过';
}

function buildRemark(item, actual, error) {
  if (error) return compact(error, 180);
  const parts = [];
  if (judgeRoute(item, actual) === '不通过') parts.push(`路由偏差: expected ${item.expected_skill || item.negative_expectation}, actual ${actual.skill_key}`);
  if (judgeTemplate(item, actual) === '不通过') parts.push(`模板偏差: expected ${item.expected_template || item.negative_expectation}, actual ${actual.template_id}`);
  if (judgeOutput(item, actual) === '不通过') parts.push('输出为空、兜底或渲染异常');
  return parts.join('；');
}

function collectLogs(rows) {
  const ids = new Set(rows.map((r) => r.conversation_id));
  const traceRows = getTraceLogger().list({ limit: 5000 })
    .filter((entry) => ids.has(entry.conversation_id))
    .map((entry) => ({
      ts_bj: entry.ts_bj,
      level: entry.level,
      kind: entry.kind,
      conversation_id: entry.conversation_id,
      question: compact(entry.question, 160),
      scene_key: entry.route?.scene_key || '',
      intent: entry.route?.intent_context?.intent_type || '',
      decision: entry.route?.decision || '',
      confidence: entry.route?.confidence ?? '',
      template: lastStageTemplate(entry.stages),
      total_ms: lastStageMs(entry.stages),
      knowledge_status: entry.route?.knowledge_status || '',
      knowledge_remote_status: entry.route?.knowledge_remote_status || '',
      model_used: entry.route?.model_used || '',
      stages: (entry.stages || []).map((s) => `${s.stage}:${s.ms}ms`).join(' | '),
    }));
  return {
    traceRows,
    runtimeTail: readJsonlTail(path.join(ROOT, 'data', 'runtime.log'), 160),
    eventTail: readJsonlTail(path.join(ROOT, 'data', 'runtime-events.log'), 160),
  };
}

function lastStageMs(stages = []) {
  return stages.length ? stages[stages.length - 1].ms : '';
}

function lastStageTemplate(stages = []) {
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    const detail = safeJson(stages[index].detail);
    if (detail?.template_id) return detail.template_id;
  }
  return '';
}

function readJsonlTail(file, limit) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => {
    const item = safeJson(line) || { raw: line };
    return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : value]));
  });
}

function buildCoverage(text, rows) {
  const templateCoverage = [];
  const coverageSection = text.split('################################################################\n# 模板覆盖清单')[1] || '';
  const lines = coverageSection.split(/\r?\n/);
  let skill = '';
  for (const line of lines) {
    const skillMatch = line.match(/^【([^】]+)】/);
    if (skillMatch) {
      skill = skillMatch[1];
      continue;
    }
    const item = line.trim().match(/^([a-zA-Z0-9_]+)[^：:]*[：:](.+)$/);
    if (!item || !skill) continue;
    const template = item[1];
    const refs = item[2].split(/[、,，\s]+/).filter(Boolean);
    const actualHits = rows.filter((row) => row.实际template_id === template).length;
    templateCoverage.push({
      技能: skill,
      模板: template,
      脚本引用: refs.join(' '),
      本轮实际命中次数: actualHits,
      覆盖状态: actualHits > 0 ? '已覆盖' : '脚本未执行或未命中',
    });
  }
  return templateCoverage;
}

function buildSummary(rows, logs, startedAt, endedAt) {
  const total = rows.length;
  const routePass = count(rows, '路由是否正确', '通过');
  const templatePass = count(rows, '模板是否正确', '通过');
  const outputPass = count(rows, '输出是否合理', '通过');
  const allPass = rows.filter((row) => row.路由是否正确 === '通过' && row.模板是否正确 === '通过' && row.输出是否合理 === '通过').length;
  const avg = total ? Math.round(rows.reduce((sum, row) => sum + Number(row.耗时ms || 0), 0) / total) : 0;
  const p95 = percentile(rows.map((row) => Number(row.耗时ms || 0)), 0.95);
  return [
    { 指标: 'run_id', 值: RUN_ID },
    { 指标: '开始时间', 值: startedAt.toLocaleString('zh-CN', { hour12: false }) },
    { 指标: '结束时间', 值: endedAt.toLocaleString('zh-CN', { hour12: false }) },
    { 指标: '可执行用例数', 值: total },
    { 指标: '全项通过', 值: `${allPass}/${total}` },
    { 指标: '路由通过', 值: `${routePass}/${total}` },
    { 指标: '模板通过', 值: `${templatePass}/${total}` },
    { 指标: '输出通过', 值: `${outputPass}/${total}` },
    { 指标: '平均耗时ms', 值: avg },
    { 指标: 'P95耗时ms', 值: p95 },
    { 指标: '本轮后台trace条数', 值: logs.traceRows.length },
  ];
}

function buildAssessment(rows, logs, coverage) {
  const failed = rows.filter((row) => row.路由是否正确 === '不通过' || row.模板是否正确 === '不通过' || row.输出是否合理 === '不通过');
  const byModule = groupRows(rows, '模块').map(([module, items]) => ({
    类型: '模块统计',
    对象: module || '未分类',
    结论: `${items.filter((r) => r.路由是否正确 === '通过' && r.模板是否正确 === '通过' && r.输出是否合理 === '通过').length}/${items.length} 全项通过`,
    证据: items.filter((r) => r.备注).map((r) => `${r.测试编号}:${r.备注}`).slice(0, 5).join('；'),
    建议: items.some((r) => r.路由是否正确 === '不通过') ? '优先修正场景词、冲突词和 intent-template-map。' : '保持回归覆盖。',
  }));
  const slow = rows.filter((row) => Number(row.耗时ms) >= 6000).map((row) => ({
    类型: '性能',
    对象: row.测试编号,
    结论: `耗时 ${row.耗时ms}ms`,
    证据: `${row.实际skill_key}/${row.实际template_id}`,
    建议: '检查远程知识库、云诊同步、Tavily/地图富化是否需要缓存或异步化。',
  }));
  const uncovered = coverage.filter((row) => row.覆盖状态 !== '已覆盖').slice(0, 40).map((row) => ({
    类型: '模板覆盖',
    对象: `${row.技能}/${row.模板}`,
    结论: row.覆盖状态,
    证据: row.脚本引用,
    建议: '补充明确输入或 action 用例，避免只在覆盖清单中出现。',
  }));
  const failures = failed.map((row) => ({
    类型: '失败用例',
    对象: row.测试编号,
    结论: `${row.路由是否正确}/${row.模板是否正确}/${row.输出是否合理}`,
    证据: row.备注 || row.实际输出摘要,
    建议: suggestFix(row),
  }));
  const logFindings = [
    {
      类型: '日志',
      对象: 'query-trace.log',
      结论: logs.traceRows.length ? `本轮采集 ${logs.traceRows.length} 条后端追踪` : '未采集到本轮 trace',
      证据: logs.traceRows.slice(0, 3).map((x) => `${x.conversation_id}:${x.scene_key}/${x.template}`).join('；'),
      建议: logs.traceRows.length ? '继续保留 trace 作为回归证据。' : '检查 trace logger 异步写入或运行路径。',
    },
  ];
  return [...failures, ...byModule, ...slow, ...uncovered, ...logFindings];
}

function suggestFix(row) {
  if (row.路由是否正确 === '不通过') return '补充场景 evidence/conflict 词，或调整 Supervisor 边界映射。';
  if (row.模板是否正确 === '不通过') return '检查 intent-template-map、模板 manifest match 和 model-service 填槽分支。';
  if (row.输出是否合理 === '不通过') return '补充业务数据装配或确定性填槽，避免通用抱歉兜底。';
  return '人工复核。';
}

function writeWorkbook(file, { summary, rows, logs, coverage, assessment }) {
  const workbook = XLSX.utils.book_new();
  addSheet(workbook, '汇总', summary);
  addSheet(workbook, '用例明细', rows);
  addSheet(workbook, '后台trace日志', logs.traceRows);
  addSheet(workbook, '前台输入日志', rows.map((r) => ({
    ts: new Date().toLocaleString('zh-CN', { hour12: false }),
    conversation_id: r.conversation_id,
    测试编号: r.测试编号,
    类型: r.类型,
    输入或动作: r.输入或动作,
    action_key: r.action_key,
  })));
  addSheet(workbook, 'runtime日志尾部', logs.runtimeTail);
  addSheet(workbook, 'runtime-events尾部', logs.eventTail);
  addSheet(workbook, '模板覆盖', coverage);
  addSheet(workbook, '评估意见与修改建议', assessment);
  XLSX.writeFile(workbook, file);
}

function addSheet(workbook, name, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 空: '' }]);
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

function renderMarkdown(summary, assessment) {
  const get = (name) => summary.find((item) => item.指标 === name)?.值 || '';
  const failures = assessment.filter((item) => item.类型 === '失败用例');
  const lines = [
    `# flatTalk 模板脚本自动评估报告`,
    '',
    `- Run ID：${get('run_id')}`,
    `- 可执行用例数：${get('可执行用例数')}`,
    `- 全项通过：${get('全项通过')}`,
    `- 路由通过：${get('路由通过')}`,
    `- 模板通过：${get('模板通过')}`,
    `- 输出通过：${get('输出通过')}`,
    `- 平均耗时：${get('平均耗时ms')}ms，P95：${get('P95耗时ms')}ms`,
    '',
    '## 主要问题',
    ...(failures.length ? failures.map((f) => `- ${f.对象}：${f.结论}；${f.证据}；建议：${f.建议}`) : ['- 未发现自动判定失败用例。']),
    '',
    '## 修改建议',
    ...assessment.filter((item) => item.类型 !== '失败用例').slice(0, 20).map((item) => `- ${item.类型}/${item.对象}：${item.结论}。${item.建议}`),
    '',
  ];
  return lines.join('\n');
}

function count(rows, key, value) {
  return rows.filter((row) => row[key] === value).length;
}

function percentile(values, p) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  return nums[Math.min(nums.length - 1, Math.ceil(nums.length * p) - 1)];
}

function groupRows(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key] || '';
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return [...map.entries()];
}

function appendText(left, right) {
  return [left, right].filter(Boolean).join('；');
}

function compact(value, length = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
}

function safeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

main();
