import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import XLSX from 'xlsx';

import { createApp } from '../src/app.js';

const DOC_PATH = path.join(process.cwd(), 'docs', 'flatTalk模板配置语义手册_v1.0_测试脚本.txt');
const OUT_XLSX = path.join(process.cwd(), 'docs', 'flatTalk模板配置语义手册_v1.1_模拟测试结果.xlsx');
const OUT_JSON = path.join(process.cwd(), 'docs', 'flatTalk模板配置语义手册_v1.1_模拟测试结果.json');

const TEXT_CASE_RE = /^【(.+?)】(.+)?$/;
const MODULE_RE = /^# 模块.+?：?(.+)$/;
const SERVER_ACTION_PREFIXES = [
  'meal_plan.',
  'travel_route.',
  'health_risk_warning.',
  'find_service.',
  'dispatch_manage.',
  'nearby_resource.',
  'sos.',
];

const doc = fs.readFileSync(DOC_PATH, 'utf8');
const cases = parseCases(doc);
const { baseUrl, close } = await startServer();

const rows = [];
try {
  for (let i = 0; i < cases.length; i += 1) {
    const item = cases[i];
    const started = Date.now();
    const row = await runCase(item, i + 1, baseUrl).catch((error) => ({
      场景: item.scene,
      输入或点击: item.kind,
      内容: item.content || item.title,
      输出结果: '',
      耗时: Date.now() - started,
      是否达到预期: '否',
      什么链路: item.link || '异常',
      是否错误: '是',
      错误原因: error?.stack || error?.message || String(error),
      解决方案: suggestFix(item, null, error),
      测试编号: item.id,
      预期: item.expectedText,
    }));
    rows.push(row);
    console.log(`[${i + 1}/${cases.length}] ${row.是否达到预期} ${item.id} ${row.输出结果}`);
  }
} finally {
  await close();
}

writeWorkbook(rows);
fs.writeFileSync(OUT_JSON, JSON.stringify(rows, null, 2), 'utf8');

console.log(`Excel 已生成：${OUT_XLSX}`);
console.log(`JSON 明细已生成：${OUT_JSON}`);

function parseCases(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let currentModule = '';
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.includes('# 模板覆盖清单') || line.includes('# 测试结果记录模板')) {
      break;
    }
    const moduleMatch = line.trim().match(MODULE_RE);
    if (moduleMatch) {
      currentModule = moduleMatch[1].replace(/#+/g, '').trim();
      continue;
    }

    const caseMatch = line.match(TEXT_CASE_RE);
    if (caseMatch) {
      if (current) result.push(finalizeCase(current));
      current = {
        id: caseMatch[1],
        title: String(caseMatch[2] || '').trim(),
        scene: sceneFromId(caseMatch[1], currentModule),
        module: currentModule,
        lines: [],
      };
      continue;
    }

    if (current) current.lines.push(line);
  }
  if (current) result.push(finalizeCase(current));
  return result.filter((item) => item.runnable && isExecutableCaseId(item.id));
}

function finalizeCase(item) {
  const body = item.lines.join('\n');
  const inputs = [];
  const inputMatches = body.matchAll(/输入\d*(?:（[^）]*）)?：([^\n]+)/g);
  for (const match of inputMatches) inputs.push(cleanContent(match[1]));
  const opMatch = body.match(/操作：([^\n]+)/);
  const actionKey = extractActionKey(body);
  const clickLabel = extractClickLabel(body);
  const expectedText = (body.match(/预期：([\s\S]*?)(?:\n\s*(?:检查|点击|输入|操作|或 动作|或 点击|【|$))/)?.[1] || '').trim();
  const expectedSkill = firstMatch(expectedText, /skill_key=([a-z_]+)/) || inferExpectedSkill(expectedText);
  const expectedIntent = firstMatch(expectedText, /intent=([a-zA-Z0-9_.]+)/);
  const expectedTemplates = parseExpectedTemplates(expectedText);
  const expectsNoError = /不报错|不异常|无 500|不能空白|友好|不崩溃/.test(expectedText + body);
  const expectsAvoid = parseAvoids(expectedText);

  let kind = '输入';
  let content = inputs[0] || '';
  let link = 'chat/message';
  let runnable = Boolean(content);

  if (actionKey && (!content || /点击|动作/.test(body))) {
    kind = body.includes('execute_action=false') || item.id === 'fallback-P0-01'
      ? 'reenter'
      : '点击';
    content = actionKey;
    link = kind === 'reenter' ? 'chat/followup(reenter)' : 'chat/action';
    runnable = true;
  } else if (inputs.length > 1) {
    kind = body.includes('reenter_chat=true') ? 'reenter多轮' : '多轮输入';
    content = inputs.join(' -> ');
    link = kind === 'reenter多轮' ? 'chat/followup(reenter)' : 'chat/message x2';
    runnable = true;
  } else if (opMatch) {
    kind = '操作';
    content = cleanContent(opMatch[1]);
    link = operationLink(content);
    runnable = link !== 'manual';
  }

  return {
    ...item,
    kind,
    content,
    inputs,
    actionKey,
    clickLabel,
    expectedText,
    expectedSkill,
    expectedIntent,
    expectedTemplates,
    expectsNoError,
    expectsAvoid,
    link,
    runnable,
  };
}

async function runCase(item, index, baseUrl) {
  const started = Date.now();
  const conversationId = `doc_${slug(item.id)}_${index}`;
  let payload;
  let status = 200;

  if (item.kind === '操作') {
    ({ payload, status } = await runOperation(item, baseUrl));
  } else if (item.kind === '点击') {
    await seedConversationIfNeeded(baseUrl, conversationId, item.scene);
    ({ payload, status } = await postJson(baseUrl, '/api/chat/action', {
      conversation_id: conversationId,
      action_key: item.actionKey,
      user_prompt: item.clickLabel || item.actionKey,
      role: roleForScene(item.scene),
    }));
  } else if (item.kind === 'reenter') {
    await seedConversationIfNeeded(baseUrl, conversationId, item.scene);
    ({ payload, status } = await postJson(baseUrl, '/api/chat/followup', {
      conversation_id: conversationId,
      user_prompt: reenterPrompt(item),
      action_key: item.actionKey,
      unsupported_action_key: item.actionKey,
      execute_action: false,
      reenter_chat: true,
      role: roleForScene(item.scene),
    }));
  } else if (item.inputs.length > 1) {
    if (item.kind === 'reenter多轮') {
      await postJson(baseUrl, '/api/chat/message', {
        conversation_id: conversationId,
        message: item.inputs[0],
        role: roleForScene(item.scene),
      });
      ({ payload, status } = await postJson(baseUrl, '/api/chat/followup', {
        conversation_id: conversationId,
        user_prompt: item.inputs[item.inputs.length - 1],
        action_key: item.id === 'router-P0-05' ? 'community.activity.lookup' : '',
        unsupported_action_key: item.id === 'router-P0-05' ? 'community.activity.lookup' : '',
        execute_action: false,
        reenter_chat: true,
        role: roleForScene(item.scene),
      }));
    } else {
      for (const input of item.inputs) {
        ({ payload, status } = await postJson(baseUrl, '/api/chat/message', {
          conversation_id: conversationId,
          message: input,
          role: roleForScene(item.scene),
        }));
      }
    }
  } else {
    ({ payload, status } = await postJson(baseUrl, '/api/chat/message', {
      conversation_id: conversationId,
      message: item.content,
      role: roleForScene(item.scene),
    }));
  }

  const envelope = payload?.envelope || payload;
  const actualSkill = envelope?.skill_key || '';
  const actualTemplate = envelope?.template_id || envelope?.card?.templateId || '';
  const actualIntent = envelope?.intent || '';
  const ok = payload?.ok !== false && envelope?.ok !== false && status < 500;
  const error = !ok || status >= 400;
  const pass = judgeCase(item, { status, payload, envelope, actualSkill, actualTemplate, actualIntent, error });

  return {
    场景: item.scene,
    输入或点击: item.kind,
    内容: item.content || item.title,
    输出结果: summarizeOutput({ status, payload, envelope, actualSkill, actualTemplate, actualIntent }),
    耗时: Date.now() - started,
    是否达到预期: pass.ok ? '是' : '否',
    什么链路: buildLink(item, payload, envelope),
    是否错误: error ? '是' : '否',
    错误原因: pass.reason || errorReason(status, payload, envelope),
    解决方案: pass.ok ? '' : suggestFix(item, { status, payload, envelope, actualSkill, actualTemplate, actualIntent }),
    测试编号: item.id,
    预期: item.expectedText,
  };
}

async function runOperation(item, baseUrl) {
  if (item.link === 'api/health') return getJson(baseUrl, '/api/health');
  if (item.link === 'api/client-config') return getJson(baseUrl, '/api/client-config');
  return { status: 0, payload: { ok: true, note: 'manual operation skipped' } };
}

async function seedConversationIfNeeded(baseUrl, conversationId, scene) {
  const seeds = {
    meal_plan: '我爷爷有糖尿病，今天三餐应该怎么吃比较好',
    travel_route: '帮老人规划广西巴马康养旅居路线',
    health_risk_warning: '老人最近血压偏高，帮我做健康风险预警',
    find_service: '帮我找一位有经验的上门护理护工',
    dispatch_manage: '帮我看看今天待处理的派单列表',
    nearby_resource: '嘉路康养中心周边15公里有什么资源',
    common: '老人有什么补贴政策可以申请的',
  };
  const message = seeds[scene] || '你好';
  await postJson(baseUrl, '/api/chat/message', {
    conversation_id: conversationId,
    message,
    role: roleForScene(scene),
  });
}

function judgeCase(item, actual) {
  const { status, payload, envelope, actualSkill, actualTemplate, actualIntent, error } = actual;
  if (status >= 500) return { ok: false, reason: `HTTP ${status}` };
  if (item.expectsNoError && error && !(item.id === 'fallback-P0-01' && status === 400)) {
    return { ok: false, reason: '预期友好兜底，但出现错误响应' };
  }
  if (item.expectedSkill && actualSkill && actualSkill !== item.expectedSkill) {
    return { ok: false, reason: `skill_key 不符：期望 ${item.expectedSkill}，实际 ${actualSkill}` };
  }
  if (item.expectedIntent && actualIntent && actualIntent !== item.expectedIntent) {
    return { ok: false, reason: `intent 不符：期望 ${item.expectedIntent}，实际 ${actualIntent}` };
  }
  if (item.expectedTemplates.length && actualTemplate && !item.expectedTemplates.includes(actualTemplate)) {
    return { ok: false, reason: `template_id 不符：期望 ${item.expectedTemplates.join('/')}，实际 ${actualTemplate}` };
  }
  if (item.expectsAvoid.skills.includes(actualSkill) || item.expectsAvoid.templates.includes(actualTemplate)) {
    return { ok: false, reason: `命中了预期应避免的结果：${actualSkill}/${actualTemplate}` };
  }
  if (payload?.ok === false && item.id !== 'fallback-P0-01') {
    return { ok: false, reason: payload.error || 'payload.ok=false' };
  }
  if (envelope && !String(envelope.answer_text || envelope.answer || '').trim() && !['api/health', 'api/client-config'].includes(item.link)) {
    return { ok: false, reason: 'answer_text 为空' };
  }
  return { ok: true, reason: '' };
}

function writeWorkbook(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '模拟测试结果');

  const byScene = new Map();
  for (const row of rows) {
    const key = row.场景 || 'unknown';
    const stat = byScene.get(key) || { 场景: key, 总数: 0, 通过: 0, 失败: 0, 平均耗时: 0 };
    stat.总数 += 1;
    if (row.是否达到预期 === '是') stat.通过 += 1;
    else stat.失败 += 1;
    stat.平均耗时 += Number(row.耗时 || 0);
    byScene.set(key, stat);
  }
  const summary = Array.from(byScene.values()).map((item) => ({
    ...item,
    通过率: `${Math.round((item.通过 / item.总数) * 100)}%`,
    平均耗时: Math.round(item.平均耗时 / item.总数),
  }));
  summary.push({
    场景: '总计',
    总数: rows.length,
    通过: rows.filter((row) => row.是否达到预期 === '是').length,
    失败: rows.filter((row) => row.是否达到预期 !== '是').length,
    通过率: `${Math.round((rows.filter((row) => row.是否达到预期 === '是').length / rows.length) * 100)}%`,
    平均耗时: Math.round(rows.reduce((sum, row) => sum + Number(row.耗时 || 0), 0) / rows.length),
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '统计汇总');

  const failures = rows.filter((row) => row.是否达到预期 !== '是');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(failures.length ? failures : [{ 结论: '全部通过' }]), '问题清单');
  XLSX.writeFile(wb, OUT_XLSX);
}

async function startServer() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = http.createServer(createApp({ runtimeMode: 'test' }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    if (!isFetchBlockedPort(port)) {
      return {
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
      };
    }
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  throw new Error('failed to allocate fetch-safe test port');
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function getJson(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function buildLink(item, payload, envelope) {
  const route = envelope?.route || {};
  const resultType = payload?.result_type ? ` -> ${payload.result_type}` : '';
  const source = route.source ? ` -> ${route.source}` : '';
  const scene = route.scene_key ? ` -> ${route.scene_key}` : '';
  const intent = envelope?.intent ? ` -> ${envelope.intent}` : '';
  return `${item.link}${resultType}${source}${scene}${intent}`;
}

function summarizeOutput({ status, payload, envelope, actualSkill, actualTemplate, actualIntent }) {
  if (payload?.result_type === 'skill_run' && payload.envelope) {
    return `HTTP ${status}; result_type=skill_run; skill_key=${actualSkill}; intent=${actualIntent}; template_id=${actualTemplate}`;
  }
  if (payload?.ok !== undefined && !envelope?.schema) {
    return `HTTP ${status}; ok=${payload.ok}; ${payload.error ? `error=${payload.error}` : ''}`;
  }
  return `HTTP ${status}; skill_key=${actualSkill}; intent=${actualIntent}; template_id=${actualTemplate}`;
}

function errorReason(status, payload, envelope) {
  if (status >= 400) return `HTTP ${status}: ${payload?.error || payload?.message || ''}`.trim();
  if (payload?.ok === false) return payload.error || 'payload.ok=false';
  if (envelope?.route?.model_error) return envelope.route.model_error;
  return '';
}

function suggestFix(item, actual, thrown) {
  if (thrown) return '检查脚本执行异常、接口启动状态或用例解析格式。';
  if (!actual) return '补充可自动执行的输入/动作，或标记为人工测试。';
  if (actual.status >= 500) return '查看服务端日志，补齐异常捕获与友好兜底。';
  if (item.expectedSkill && actual.actualSkill !== item.expectedSkill) return '调整 scene-router/Supervisor 关键词、冲突惩罚或 reenter/followup 边界。';
  if (item.expectedTemplates.length && !item.expectedTemplates.includes(actual.actualTemplate)) return '检查 intent-template-map、显式 template_id、模板 manifest 与模型 fallback 是否一致。';
  if (actual.status >= 400) return '若是未知 action，应走 reenter chat 或前端友好提示；若是服务端 action，应补 action dispatcher/resource map。';
  return '复核预期描述是否需要拆分为可判定字段，并补充自动化断言。';
}

function sceneFromId(id, moduleName) {
  const prefix = String(id).split('-')[0];
  const map = {
    meal_plan: 'meal_plan',
    travel_route: 'travel_route',
    health: 'health_risk_warning',
    service: 'find_service',
    dispatch: 'dispatch_manage',
    nearby: 'nearby_resource',
    common: 'common',
    SOS: 'SOS',
    router: 'router',
    fallback: 'fallback',
    前置: 'precheck',
  };
  return map[prefix] || moduleName || 'unknown';
}

function isExecutableCaseId(id) {
  return /^前置-\d+/.test(id) || /^[A-Za-z0-9_]+-P\d/.test(id) || /^router-P\d/.test(id) || /^fallback-P\d/.test(id);
}

function inferExpectedSkill(text) {
  if (/SOS\s*优先/.test(text)) return 'find_service';
  if (/health_risk_warning\s*优先/.test(text)) return 'health_risk_warning';
  if (/不应继续\s*meal_plan/.test(text)) return 'common';
  return '';
}

function roleForScene(scene) {
  if (scene === 'health_risk_warning') return 'care_worker';
  if (scene === 'dispatch_manage') return 'care_worker';
  if (scene === 'precheck') return 'elder_family';
  return 'elder_family';
}

function reenterPrompt(item) {
  const text = item.lines.join('\n');
  const input = firstMatch(text, /输入：([^\n]+)/) || firstMatch(text, /输入2[^：]*：([^\n]+)/);
  return cleanContent(input || '今天社区活动几点开始');
}

function operationLink(content) {
  if (/health|api\/health/i.test(content)) return 'api/health';
  if (/登录|SSO|dev SSO|client-config/.test(content)) return 'api/client-config';
  return 'manual';
}

function extractActionKey(text) {
  const paren = firstMatch(text, /action_key:\s*([a-zA-Z0-9_.]+)/);
  if (paren) return paren;
  const action = firstMatch(text, /动作：\s*([a-zA-Z0-9_.]+)/);
  if (action) return action;
  return '';
}

function extractClickLabel(text) {
  return firstMatch(text, /点击：([^（\n]+)/) || '';
}

function parseExpectedTemplates(text) {
  const raw = firstMatch(text, /template_id=([a-zA-Z0-9_./ 或]+?)(?:，|；|。|$)/);
  if (!raw) return [];
  return raw
    .split(/或|\/|,|，/)
    .map((item) => item.trim())
    .filter((item) => /^[a-zA-Z0-9_]+$/.test(item));
}

function parseAvoids(text) {
  const skills = [];
  const templates = [];
  const avoidSkill = firstMatch(text, /不应.*?(?:命中|继续|接管|抢走|返回)\s*([a-z_]+)/);
  if (avoidSkill && SERVER_ACTION_PREFIXES.every((prefix) => !avoidSkill.startsWith(prefix))) skills.push(avoidSkill);
  const avoidTemplate = firstMatch(text, /不能返回\s*([a-z_]+_card|answer|weekly_plan|route_card|diet_card)/);
  if (avoidTemplate) templates.push(avoidTemplate);
  return { skills, templates };
}

function cleanContent(value = '') {
  return String(value)
    .replace(/（.*?）/g, '')
    .replace(/，?不能.*$/g, '')
    .trim();
}

function firstMatch(text, regex) {
  return String(text || '').match(regex)?.[1]?.trim() || '';
}

function slug(value) {
  return String(value).replace(/[^\w]+/g, '_').slice(0, 40);
}

function isFetchBlockedPort(port) {
  return new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
    87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
    139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
    540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
    1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
    6669, 6697, 10080,
  ]).has(Number(port));
}
