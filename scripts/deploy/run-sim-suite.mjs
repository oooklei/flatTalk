#!/usr/bin/env node
/**
 * 端到端用户仿真套件 —— 对已部署的 flatTalk(5301) + LIS(8100) 跑一轮完整用例。
 * 覆盖：膳食 / 旅居 / 健康风险 / 找服务 / 派单 / 质量评估 / 政策 / 澄清兜底
 */
import fs from 'node:fs';
import path from 'node:path';

const FT = process.env.FT_BASE || 'http://192.168.1.2:5301';
const LIS = process.env.LIS_BASE || 'http://192.168.1.2:8100';
const OUT = path.resolve('build', 'gxy-sim-report.json');

const CASES = [
  { id: 'meal-01', skill: 'meal_plan', text: '今天吃什么好', expect_skill: 'meal_plan' },
  { id: 'meal-02', skill: 'meal_plan', text: '糖尿病饮食建议', expect_skill: 'meal_plan' },
  { id: 'meal-03', skill: 'meal_plan', text: '一周食谱', expect_skill: 'meal_plan' },
  { id: 'travel-01', skill: 'travel_route', text: '帮我规划巴马旅居路线', expect_skill: 'travel_route' },
  { id: 'travel-02', skill: 'travel_route', text: '防城港三日游多少钱', expect_skill: 'travel_route' },
  { id: 'health-01', skill: 'health_risk_warning', text: '综合风险评估', expect_skill: 'health_risk_warning' },
  { id: 'health-02', skill: 'health_risk_warning', text: '舌诊详情', expect_skill: 'health_risk_warning' },
  { id: 'health-03', skill: 'health_risk_warning', text: '我的体质怎么样', expect_skill: 'health_risk_warning' },
  { id: 'fs-01', skill: 'find_service', text: '帮我找上门护理服务', expect_skill: 'find_service' },
  { id: 'fs-02', skill: 'find_service', text: '查看全部养老服务目录', expect_skill: 'find_service' },
  { id: 'fs-03', skill: 'find_service', text: '服务详情', expect_skill: 'find_service' },
  { id: 'fs-04', skill: 'find_service', text: '预约确认', expect_skill: 'find_service' },
  { id: 'dispatch-01', skill: 'dispatch_manage', text: '我的派单列表', expect_skill: 'dispatch_manage' },
  { id: 'dispatch-02', skill: 'dispatch_manage', text: '确认接单', expect_skill: 'dispatch_manage' },
  { id: 'sqe-01', skill: 'service_quality_eval', text: '机构质量排名报告', expect_template: 'org_quality_ranking' },
  { id: 'sqe-02', skill: 'service_quality_eval', text: '机构质量评估报告', expect_template: 'institution_quality_report' },
  { id: 'policy-01', skill: 'common', text: '高龄津贴怎么申请', expect_skill: 'common' },
  { id: 'clarify-01', skill: 'common', text: '嗯', expect_any: true },
];

async function postJson(url, body, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

async function health(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function pick(obj, paths) {
  for (const p of paths) {
    const parts = p.split('.');
    let cur = obj;
    for (const part of parts) {
      if (cur == null) break;
      cur = cur[part];
    }
    if (cur != null && cur !== '') return cur;
  }
  return null;
}

async function runCase(c) {
  const lis = await postJson(`${LIS}/v1/sort`, { utterance: c.text, top_k: 3 });
  const lisIntent = pick(lis.data, ['intents.0.intent_id', 'routing_ticket.primary_intent_id']);
  const lisTpl = pick(lis.data, ['intents.0.template_id']);
  const lisSkill = pick(lis.data, ['intents.0.skill_key', 'routing_ticket.domain']);

  const chat = await postJson(`${FT}/api/chat/message`, {
    message: c.text,
    conversationId: `sim_${c.id}_${Date.now()}`,
    roleKey: 'elder_family',
    channel: 'sim',
    elder_id: 'sim-elder-001',
  }, 45000);

  const skill = pick(chat.data, ['skill_key', 'agent_key', 'envelope.skill_key', 'data.skill_key']);
  const template = pick(chat.data, [
    'template_id', 'template_key', 'envelope.template_id',
    'card.templateId', 'render.card.templateId', 'data.template_id',
  ]);
  const answer = pick(chat.data, ['answer_text', 'answer', 'envelope.answer_text']) || '';
  const catalogLen = pick(chat.data, [
    'business_data.service_catalog.length',
    'data.service_catalog.length',
    'data.total',
    'data.services.length',
  ]);

  let pass = chat.ok && chat.status < 500;
  const reasons = [];
  if (c.expect_skill && skill && skill !== c.expect_skill && lisSkill !== c.expect_skill) {
    // soft: LIS skill match counts
    if (lisSkill !== c.expect_skill) {
      pass = false;
      reasons.push(`skill want=${c.expect_skill} got=${skill||lisSkill}`);
    }
  }
  if (c.expect_template) {
    const got = template || lisTpl;
    if (got !== c.expect_template) {
      pass = false;
      reasons.push(`template want=${c.expect_template} got=${got}`);
    }
  }
  if (!lis.ok) reasons.push(`lis_http=${lis.status}`);
  if (!chat.ok) reasons.push(`chat_http=${chat.status}`);

  return {
    id: c.id,
    text: c.text,
    pass,
    reasons,
    lis: { status: lis.status, intent: lisIntent, template: lisTpl, skill: lisSkill },
    chat: { status: chat.status, skill, template, answer_preview: String(answer).slice(0, 80), catalogLen },
  };
}

async function main() {
  const report = {
    at: new Date().toISOString(),
    targets: { FT, LIS },
    health: {
      ft: await health(`${FT}/api/health`),
      lis: await health(`${LIS}/health`),
      tag: await health('http://192.168.1.2:8011/api/v1/health'),
      kb: await health('http://192.168.1.2:9016/health'),
    },
    results: [],
  };

  for (const c of CASES) {
    process.stdout.write(`run ${c.id} ... `);
    try {
      const r = await runCase(c);
      report.results.push(r);
      console.log(r.pass ? 'PASS' : `FAIL ${r.reasons.join(';')}`);
    } catch (e) {
      report.results.push({ id: c.id, text: c.text, pass: false, reasons: [e.message] });
      console.log('ERR', e.message);
    }
  }

  const passed = report.results.filter((r) => r.pass).length;
  report.summary = { total: report.results.length, passed, failed: report.results.length - passed };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(report.summary));
  console.log('health', JSON.stringify(report.health));
  console.log('saved', OUT);
  process.exit(report.summary.failed ? 1 : 0);
}

main();
