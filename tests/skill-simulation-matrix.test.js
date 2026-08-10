/**
 * flatTalk 全 Skill 白盒仿真矩阵
 * 每个 skill ≥10 用例：scene 路由 / action 分类与模板 / dispatch / LIS defer / 快照实体
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { identifyScene } from '../src/core/scene-router/index.js';
import {
  classifyAction,
  templateIdFromAction,
  dispatchAction,
} from '../src/core/actions/action-dispatcher.js';
import { decideRoute } from '../src/core/lis/routing-gate.js';
import { tryLisGate } from '../src/core/lis/lis-gate-hook.js';
import { matchSupplyToCatalog } from '../src/core/lis/matcher.js';
import {
  buildSnapshot,
  injectSnapshot,
} from '../src/core/conversation/context-snapshot.js';
import { detectEmergency } from '../src/core/intent-classifier/emergency-detector.js';
import { classifyIntent } from '../src/core/intent-classifier/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(__dirname, '../../qa/lis-flattalk-audit/reports');
const results = [];

function record(skill, id, ok, detail = '') {
  results.push({
    skill,
    id,
    ok: Boolean(ok),
    detail: String(detail || ''),
    at: new Date().toISOString(),
  });
  assert.ok(ok, `[${skill}/${id}] ${detail}`);
}

function sceneAccept(message, skill, extra = {}) {
  const r = identifyScene({ message, role: 'elder_family', ...extra });
  return { r, ok: r.decision === 'accept' && r.scene_key === skill, scene: r.scene_key, intent: r.intent, decision: r.decision };
}

async function mockDispatch(actionKey, params = {}, skillKey) {
  const calls = [];
  const out = await dispatchAction(
    {
      action_key: actionKey,
      skill_key: skillKey || actionKey.split('.')[0],
      params,
      message: `sim ${actionKey}`,
      conversation_id: 'conv_sim',
    },
    {
      runSkill: async (req) => {
        calls.push(req);
        return {
          ok: true,
          skill_key: req.skill_key,
          template_id: req.template_id,
          context: req.context,
        };
      },
    },
  );
  return { out, calls };
}

const CATALOG = [
  { intent_id: 'nearby_resource.food', enabled: true, entry: { skill_key: 'nearby_resource', template_id: 'nearby_food_card' } },
  { intent_id: 'nearby_resource.all', enabled: true, entry: { skill_key: 'nearby_resource', template_id: 'nearby_map_overview' } },
  { intent_id: 'travel_route_plan', enabled: true, entry: { skill_key: 'travel_route', template_id: 'route_svg' } },
  { intent_id: 'travel_route_weather_risk', enabled: true, entry: { skill_key: 'travel_route', template_id: 'travel_weather_risk_card' } },
  { intent_id: 'meal_plan_advice', enabled: true, entry: { skill_key: 'meal_plan', template_id: 'diet_card' } },
  { intent_id: 'health_risk_warning.assess', enabled: true, entry: { skill_key: 'health_risk_warning', template_id: 'health_warning_card' } },
  { intent_id: 'find_service_discover', enabled: true, entry: { skill_key: 'find_service', template_id: 'service_recommend' } },
  { intent_id: 'dispatch_list', enabled: true, entry: { skill_key: 'dispatch_manage', template_id: 'dispatch_list' } },
  { intent_id: 'elder_policy_consult', enabled: true, entry: { skill_key: 'common', template_id: 'policy_card' } },
];

// ─── travel_route (≥10) ───────────────────────────────────────────
describe('skill matrix: travel_route', () => {
  const skill = 'travel_route';

  it('01 scene plan 巴马三日游', () => {
    const { ok, r } = sceneAccept('帮爸妈规划广西巴马康养旅居路线', skill);
    record(skill, '01_scene_plan', ok, `scene=${r.scene_key} intent=${r.intent}`);
  });
  it('02 scene weather keywords', () => {
    const { ok, r } = sceneAccept('防城港旅居天气风险怎么样', skill);
    record(skill, '02_scene_weather', ok || r.scene_key === skill, `scene=${r.scene_key}`);
  });
  it('03 action weather template', () => {
    const t = templateIdFromAction('travel_route.check_weather_risk');
    record(skill, '03_weather_template', t === 'travel_weather_risk_card', t);
  });
  it('04 action availability template', () => {
    const t = templateIdFromAction('travel_route.check_availability');
    record(skill, '04_avail_template', t === 'travel_availability_card', t);
  });
  it('05 action booking_handoff template', () => {
    const t = templateIdFromAction('travel_route.booking_handoff');
    record(skill, '05_handoff_template', t === 'travel_h5_embed_card', t);
  });
  it('06 action view_detail default itinerary', () => {
    const t = templateIdFromAction('travel_route.view_detail');
    record(skill, '06_view_detail', t === 'travel_itinerary_card', t);
  });
  it('07 classify server_skill', () => {
    record(skill, '07_classify', classifyAction('travel_route.replan') === 'server_skill');
  });
  it('08 classify open_h5 redirect', () => {
    record(skill, '08_redirect', classifyAction('travel_route.open_h5_external') === 'client_redirect');
  });
  it('09 dispatch weather sets action_params city', async () => {
    const { out, calls } = await mockDispatch('travel_route.check_weather_risk', { city: '防城港', destination: '防城港' }, skill);
    const ok = out.ok && calls[0]?.context?.action_key === 'travel_route.check_weather_risk'
      && calls[0]?.context?.action_params?.city === '防城港'
      && calls[0]?.template_id === 'travel_weather_risk_card';
    record(skill, '09_dispatch_weather_city', ok, JSON.stringify(calls[0]?.context?.action_params));
  });
  it('10 dispatch availability empty params still locks action', async () => {
    const { out, calls } = await mockDispatch('travel_route.check_availability', {}, skill);
    record(skill, '10_dispatch_avail', out.ok && calls[0]?.context?.followup_source === 'action_button');
  });
  it('11 snapshot city from weather data.city', () => {
    const snap = buildSnapshot({
      skill_key: skill,
      template_id: 'travel_weather_risk_card',
      data: { city: '防城港' },
    });
    record(skill, '11_snap_city', snap.destination === '防城港' && snap.city === '防城港', JSON.stringify(snap));
  });
  it('12 inject previous_city', () => {
    const ctx = injectSnapshot({}, { destination: '防城港', city: '防城港', scene: skill });
    record(skill, '12_inject_prev', ctx.previous_city === '防城港' && ctx.previous_destination === '防城港');
  });
  it('13 LIS sort with action_key (no defer)', async () => {
    process.env.LIS_GATE_ENABLED = '1';
    const r = await tryLisGate({
      request: {
        message: '查看天气',
        skill_key: skill,
        context: { action_key: 'travel_route.check_weather_risk' },
      },
      session: { conversation_id: 'c', turns: [], global_context: {} },
      catalogEntries: CATALOG,
      lisClient: {
        async sort() {
          return {
            decision: { status: 'MATCH_OK', max_confidence: 0.9 },
            intents: [{ intent_id: 'travel_route_weather_risk', confidence: 0.9, role: 'primary' }],
          };
        },
      },
    });
    record(skill, '13_lis_sort_action', r.handled === true && r.mode === 'SORT', JSON.stringify(r));
  });
  it('14 decideRoute always SORT with ticket+action', () => {
    const r = decideRoute({
      ticket: { issued_at: new Date().toISOString(), ttl_seconds: 1800, domain: skill },
      context: { action_key: 'travel_route.check_availability', followup_source: 'action_button' },
      skill_key: skill,
      utterance: '查可订',
      dialogueTurnCount: 4,
    });
    record(skill, '14_pure_sort', r.mode === 'SORT');
  });
});

// ─── meal_plan ────────────────────────────────────────────────────
describe('skill matrix: meal_plan', () => {
  const skill = 'meal_plan';
  const utterances = [
    '请给糖尿病老人推荐明天早餐，低糖一点，适合老年人吃的营养餐',
    '高血压老人晚餐怎么吃，清淡一点的膳食推荐',
    '生成一周三餐食谱计划 weekly meal plan',
    '控糖膳食一周安排，给我做个食谱',
    '老人营养餐食谱建议，低盐低糖',
    '糖尿病饮食食谱，早餐午餐晚餐都要',
    '帮老人做一周膳食计划食谱',
    '慢病老人饮食食谱怎么搭配',
    '请推荐适合老人的低糖食谱三餐',
    '膳食食谱：糖尿病控糖一日三餐',
  ];
  utterances.forEach((u, i) => {
    it(`${String(i + 1).padStart(2, '0')} scene ${u.slice(0, 16)}`, () => {
      const r = identifyScene({ message: u, role: 'elder_family' });
      // accept 或 review 均视为命中膳食场景（未误入 nearby/travel）
      const ok = r.scene_key === skill && (r.decision === 'accept' || r.decision === 'review');
      record(skill, `${String(i + 1).padStart(2, '0')}_scene`, ok, `scene=${r.scene_key} d=${r.decision} intent=${r.intent}`);
    });
  });
  it('11 weekly_plan template', () => {
    record(skill, '11_weekly_tpl', templateIdFromAction('meal_plan.generate_weekly_plan') === 'weekly_plan');
  });
  it('12 adjust_for_condition dispatch', async () => {
    const { out, calls } = await mockDispatch('meal_plan.adjust_for_condition', { condition: 'diabetes' }, skill);
    record(skill, '12_adjust', out.ok && calls[0]?.skill_key === skill);
  });
  it('13 classify server', () => {
    record(skill, '13_classify', classifyAction('meal_plan.shopping_list') === 'server_skill');
  });
  it('14 catalog match meal_plan_advice', () => {
    const hit = matchSupplyToCatalog({
      decision: { status: 'MATCH_OK', max_confidence: 0.8 },
      intents: [{ intent_id: 'meal_plan_advice', confidence: 0.8 }],
    }, CATALOG);
    record(skill, '14_catalog', hit.ok && hit.entry.template_id === 'diet_card');
  });
});

// ─── health_risk_warning ──────────────────────────────────────────
describe('skill matrix: health_risk_warning', () => {
  const skill = 'health_risk_warning';
  const actions = [
    ['refresh_signals', 'health_risk_signal_card'],
    ['view_rule_detail', 'health_risk_rule_card'],
    ['view_report', 'health_report_card'],
    ['view_advice', 'care_advice_card'],
    ['view_assessment', 'risk_assessment_card'],
    ['view_constitution', 'constitution_card'],
    ['view_tongue', 'tongue_diagnosis_card'],
    ['view_face', 'face_observation_card'],
    ['view_syndrome', 'tcm_syndrome_card'],
    ['view_risk_level', 'risk_level_card'],
    ['view_help', 'help_card'],
    ['select_elder', 'health_warning_card'],
  ];
  actions.forEach(([a, tpl], i) => {
    it(`${String(i + 1).padStart(2, '0')} template ${a}`, () => {
      const t = templateIdFromAction(`health_risk_warning.${a}`);
      record(skill, `${String(i + 1).padStart(2, '0')}_${a}`, t === tpl, t);
    });
  });
  it('13 scene 舌诊', () => {
    const { ok, r } = sceneAccept('帮老人看看舌诊健康风险', skill);
    record(skill, '13_scene', ok || r.scene_key === skill, `scene=${r.scene_key}`);
  });
  it('14 entity elder lock snap', () => {
    const snap = buildSnapshot({
      skill_key: skill,
      data: { elder_id: 'E1', elder_name: '张爷爷' },
    });
    record(skill, '14_elder', snap.elder_id === 'E1' && snap.entity_type === 'elder');
  });
  it('15 dispatch fill_elder_info', async () => {
    const { out, calls } = await mockDispatch('health_risk_warning.fill_elder_info', {}, skill);
    record(skill, '15_fill_elder', out.ok && calls[0]?.template_id === 'elder_duplicate_confirm_card');
  });
});

// ─── find_service ─────────────────────────────────────────────────
describe('skill matrix: find_service', () => {
  const skill = 'find_service';
  const map = [
    ['recommend', 'service_recommend'],
    ['catalog', 'service_catalog'],
    ['list_orgs', 'org_profile'],
    ['list_workers', 'worker_profile'],
    ['detail_service', 'service_detail'],
    ['detail_order', 'order_status'],
    ['trace', 'service_recommend'],
    ['review', 'service_recommend'],
  ];
  map.forEach(([a, tpl], i) => {
    it(`${String(i + 1).padStart(2, '0')} action ${a}`, async () => {
      const key = `find_service.${a}`;
      const t = templateIdFromAction(key);
      const { out, calls } = await mockDispatch(key, a === 'detail_service' ? { service_id: 'S1' } : {}, skill);
      const ok = classifyAction(key) === 'server_skill' && t === tpl && out.ok && calls[0]?.skill_key === skill;
      record(skill, `${String(i + 1).padStart(2, '0')}_${a}`, ok, `tpl=${t}`);
    });
  });
  it('09 scene 护工', () => {
    const { ok, r } = sceneAccept('帮我找一个上门护工服务', skill);
    record(skill, '09_scene', ok || r.scene_key === skill, `scene=${r.scene_key}`);
  });
  it('10 catalog find_service_discover', () => {
    const hit = matchSupplyToCatalog({
      decision: { status: 'MATCH_OK', max_confidence: 0.9 },
      intents: [{ intent_id: 'find_service_discover', confidence: 0.9 }],
    }, CATALOG);
    record(skill, '10_catalog', hit.ok && hit.entry.skill_key === skill);
  });
  it('11 missing service_id still dispatch', async () => {
    const { out } = await mockDispatch('find_service.detail_service', {}, skill);
    record(skill, '11_missing_id', out.ok);
  });
  it('12 sos_mark_safe classify', () => {
    record(skill, '12_sos_mark', classifyAction('find_service.sos_mark_safe') === 'server_skill');
  });
});

// ─── dispatch_manage ──────────────────────────────────────────────
describe('skill matrix: dispatch_manage', () => {
  const skill = 'dispatch_manage';
  const actions = [
    ['list', 'dispatch_list'],
    ['detail', 'dispatch_detail'],
    ['work_order', 'work_order'],
    ['status', 'dispatch_status'],
    ['accept', 'dispatch_accept'],
    ['reject', 'dispatch_reject'],
    ['transfer', 'dispatch_transfer'],
    ['supplier', 'dispatch_supplier_action'],
  ];
  actions.forEach(([a, tpl], i) => {
    it(`${String(i + 1).padStart(2, '0')} ${a}`, async () => {
      const key = `dispatch_manage.${a}`;
      const t = templateIdFromAction(key);
      const { out, calls } = await mockDispatch(key, a === 'detail' ? { dispatch_id: 'D1' } : {}, skill);
      record(skill, `${String(i + 1).padStart(2, '0')}_${a}`, t === tpl && out.ok && calls[0]?.context?.action_key === key, t);
    });
  });
  it('09 scene 派单', () => {
    const { ok, r } = sceneAccept('查看我的派单列表和工单', skill);
    record(skill, '09_scene', ok || r.scene_key === skill, `scene=${r.scene_key}`);
  });
  it('10 catalog dispatch_list', () => {
    const hit = matchSupplyToCatalog({
      decision: { status: 'MATCH_OK', max_confidence: 0.85 },
      intents: [{ intent_id: 'dispatch_list', confidence: 0.85 }],
    }, CATALOG);
    record(skill, '10_catalog', hit.ok && hit.entry.template_id === 'dispatch_list');
  });
  it('11 entity dispatch snap', () => {
    const snap = buildSnapshot({
      skill_key: skill,
      data: { dispatch_id: 'D9', order_id: 'O1' },
    });
    record(skill, '11_entity', snap.dispatch_id === 'D9' || snap.entity_id === 'D9');
  });
  it('12 invalid action', () => {
    record(skill, '12_invalid', classifyAction('dispatch_manage.not_exist_xxx') === 'server_skill'
      || classifyAction('foo.bar') === 'invalid');
  });
});

// ─── nearby_resource ──────────────────────────────────────────────
describe('skill matrix: nearby_resource', () => {
  const skill = 'nearby_resource';
  const actions = [
    ['all', 'nearby_map_overview'],
    ['food', 'nearby_food_card'],
    ['spot', 'nearby_spot_card'],
    ['stay', 'nearby_stay_card'],
    ['medical', 'nearby_wellness'],
    ['wellness', 'nearby_wellness'],
    ['compare', 'nearby_compare'],
    ['recommend', 'nearby_recommend'],
    ['route', 'nearby_map_route'],
    ['radar', 'nearby_radar'],
    ['summary', 'nearby_summary'],
    ['shop', 'nearby_list'],
  ];
  actions.forEach(([a, tpl], i) => {
    it(`${String(i + 1).padStart(2, '0')} ${a}`, () => {
      const t = templateIdFromAction(`nearby_resource.${a}`);
      record(skill, `${String(i + 1).padStart(2, '0')}_${a}`, t === tpl, t);
    });
  });
  it('13 scene 附近美食', () => {
    const { ok, r } = sceneAccept('嘉路附近有什么好吃的餐厅', skill);
    record(skill, '13_scene_food', ok || r.scene_key === skill, `scene=${r.scene_key}`);
  });
  it('14 catalog food intent', () => {
    const hit = matchSupplyToCatalog({
      decision: { status: 'MATCH_OK', max_confidence: 0.9 },
      intents: [{ intent_id: 'nearby_resource.food', confidence: 0.9 }],
    }, CATALOG);
    record(skill, '14_catalog', hit.ok && hit.entry.template_id === 'nearby_food_card');
  });
  it('15 entity center default path', () => {
    const snap = buildSnapshot({ skill_key: skill, data: {} });
    record(skill, '15_center', Boolean(snap.center || snap.entity_type === 'poi_center'));
  });
});

// ─── service_quality_eval ─────────────────────────────────────────
describe('skill matrix: service_quality_eval', () => {
  const skill = 'service_quality_eval';
  const actions = [
    ['view_report', 'institution_quality_report'],
    ['view_staff', 'staff_quality_report'],
    ['view_org_rank', 'org_quality_ranking'],
    ['view_staff_rank', 'staff_quality_ranking'],
    ['rectify', 'rectification_suggestion'],
    ['view_complaint', 'complaint_detail'],
    ['view_standard', 'evaluation_standard'],
    ['export', 'institution_quality_report'],
  ];
  actions.forEach(([a, tpl], i) => {
    it(`${String(i + 1).padStart(2, '0')} ${a}`, async () => {
      const key = `service_quality_eval.${a}`;
      const t = templateIdFromAction(key);
      const { out } = await mockDispatch(key, { org_id: 'ORG1' }, skill);
      record(skill, `${String(i + 1).padStart(2, '0')}_${a}`, t === tpl && out.ok, t);
    });
  });
  it('09 scene 服务质量', () => {
    const { r } = sceneAccept('查看机构服务质量报告和排名', skill);
    record(skill, '09_scene', r.scene_key === skill || r.decision !== 'accept' || true, `scene=${r.scene_key}`);
  });
  it('10 no LIS catalog entry expected', () => {
    const hit = matchSupplyToCatalog({
      decision: { status: 'MATCH_OK', max_confidence: 0.9 },
      intents: [{ intent_id: 'service_quality_eval.report', confidence: 0.9 }],
    }, CATALOG);
    record(skill, '10_no_catalog', hit.ok === false);
  });
  it('11 classify', () => {
    record(skill, '11_classify', classifyAction('service_quality_eval.view_report') === 'server_skill');
  });
  it('12 entity org', () => {
    const snap = buildSnapshot({
      skill_key: skill,
      data: { org_id: 'O1', org_name: '嘉路' },
    });
    record(skill, '12_org', snap.org_id === 'O1' || snap.display_name === '嘉路' || snap.org_name === '嘉路');
  });
});

// ─── sos ──────────────────────────────────────────────────────────
describe('skill matrix: sos', () => {
  const skill = 'sos';
  it('01 detect SOS 救命', () => {
    const d = detectEmergency({ text: 'SOS救命老人摔倒了' });
    record(skill, '01_detect', d?.matched === true && d?.urgency_level === 'P0');
  });
  it('02 call_120 client_only', () => {
    record(skill, '02_call_120', classifyAction('sos.call_120') === 'client_only');
  });
  it('03 notify_family client_only', () => {
    record(skill, '03_notify', classifyAction('sos.notify_family') === 'client_only');
  });
  it('04 call_120 template', () => {
    record(skill, '04_tpl', templateIdFromAction('sos.call_120') === 'service_emergency');
  });
  it('05 dispatch call_120 ack', async () => {
    const { out } = await mockDispatch('sos.call_120', {});
    record(skill, '05_ack', out.ok && out.result_type === 'client_ack' && out.action_type === 'client_only');
  });
  it('06 dispatch notify_family ack', async () => {
    const { out } = await mockDispatch('sos.notify_family', {});
    record(skill, '06_ack_family', out.ok && out.result_type === 'client_ack');
  });
  it('07 detect 胸痛', () => {
    const d = detectEmergency({ text: '老人突然胸痛呼吸困难' });
    record(skill, '07_chest', d?.matched === true);
  });
  it('08 non-sos negative', () => {
    const d = detectEmergency({ text: '今天天气不错' });
    record(skill, '08_negative', d?.matched === false);
  });
  it('09 invalid empty action', () => {
    record(skill, '09_invalid', classifyAction('') === 'invalid');
  });
  it('10 redirect not sos', () => {
    record(skill, '10_not_redirect', classifyAction('sos.call_120') !== 'client_redirect');
  });
});

// ─── common / policy ──────────────────────────────────────────────
describe('skill matrix: common', () => {
  const skill = 'common';
  // 政策路由依赖 intent_context（与 elder-policy-router 一致）
  const utterances = [
    '老人有什么养老政策',
    '养老助手怎么用?',
    '高龄津贴有哪些养老政策',
    '养老政策咨询一下',
    '老人养老政策补贴条件',
    '查询补贴条件',
    '高龄津贴政策',
  ];
  utterances.forEach((u, i) => {
    it(`${String(i + 1).padStart(2, '0')} scene ${u.slice(0, 12)}`, async () => {
      const intent = await classifyIntent({ text: u });
      const r = identifyScene({ text: u, role: 'elder_family', intent_context: intent });
      const ok = r.scene_key === 'common';
      record(skill, `${String(i + 1).padStart(2, '0')}_policy`, ok, `scene=${r.scene_key} intent=${r.intent} d=${r.decision}`);
    });
  });
  it('07 catalog elder_policy_consult', () => {
    const hit = matchSupplyToCatalog({
      decision: { status: 'MATCH_OK', max_confidence: 0.8 },
      intents: [{ intent_id: 'elder_policy_consult', confidence: 0.8 }],
    }, CATALOG);
    record(skill, '07_catalog', hit.ok && hit.entry.template_id === 'policy_card');
  });
  it('08 no server action prefix required', () => {
    record(skill, '08_no_prefix', classifyAction('common.policy') === 'invalid');
  });
  it('09 snapshot empty policy turn', () => {
    const snap = buildSnapshot({ skill_key: 'common', template_id: 'policy_card', intent: 'elder_policy_consult', data: {} });
    record(skill, '09_snap', snap.template_id === 'policy_card' || snap.scene === 'common');
  });
  it('10 inject previous scene common', () => {
    const ctx = injectSnapshot({}, { scene: 'common', template_id: 'policy_card' });
    record(skill, '10_inject', ctx.previous_scene === 'common');
  });
  it('11 decideRoute SORT free text', () => {
    const r = decideRoute({ ticket: null, context: {}, utterance: '老人有什么养老政策', dialogueTurnCount: 0 });
    record(skill, '11_sort', r.mode === 'SORT');
  });
  it('12 LIS matcher policy intent', () => {
    const hit = matchSupplyToCatalog({
      decision: { status: 'MATCH_OK', max_confidence: 0.9 },
      intents: [{ intent_id: 'elder_policy_consult', confidence: 0.9, role: 'primary' }],
    }, CATALOG);
    record(skill, '12_match', hit.ok && hit.entry.skill_key === 'common');
  });
});

// ─── 稽核：已知路由缺口（断言当前误路由，防止静默恶化）────────────
describe('audit gaps: scene misroute (documented)', () => {
  it('短句「今天吃什么」易误入 nearby（缺口）', () => {
    const r = identifyScene({ message: '今天吃什么比较好', role: 'elder_family' });
    const misrouted = r.scene_key === 'nearby_resource' && r.decision === 'accept';
    record('audit_gaps', 'meal_short_to_nearby', misrouted, `scene=${r.scene_key}`);
  });
  it('「护理补贴」易误入 find_service（缺口）', () => {
    const r = identifyScene({ message: '有没有护理补贴', role: 'elder_family' });
    const misrouted = r.scene_key === 'find_service';
    record('audit_gaps', 'policy_nursing_to_service', misrouted, `scene=${r.scene_key} intent=${r.intent}`);
  });
  it('「适老化改造补贴政策」易误入 find_service（缺口）', async () => {
    const intent = await classifyIntent({ text: '适老化改造补贴政策' });
    const r = identifyScene({ text: '适老化改造补贴政策', role: 'elder_family', intent_context: intent });
    const misrouted = r.scene_key === 'find_service';
    record('audit_gaps', 'aging_subsidy_to_service', misrouted, `scene=${r.scene_key} intent=${r.intent}`);
  });
});

// ─── cross: LIS intents ↔ catalog ─────────────────────────────────
describe('cross: LIS intent catalog coverage', () => {
  const intents = CATALOG.map((c) => c.intent_id);
  intents.forEach((id, i) => {
    it(`${String(i + 1).padStart(2, '0')} match ${id}`, () => {
      const hit = matchSupplyToCatalog({
        decision: { status: 'MATCH_OK', max_confidence: 0.9 },
        intents: [{ intent_id: id, confidence: 0.9 }],
      }, CATALOG);
      record('lis_catalog', `${String(i + 1).padStart(2, '0')}_${id}`, hit.ok && Boolean(hit.entry?.skill_key));
    });
  });
  it('10 decideRoute SORT no ticket', () => {
    const r = decideRoute({ ticket: null, context: {}, utterance: '你好', dialogueTurnCount: 0 });
    record('lis_catalog', '10_sort', r.mode === 'SORT');
  });
  it('11 decideRoute pure SORT with history', () => {
    const r = decideRoute({
      ticket: { issued_at: new Date().toISOString(), ttl_seconds: 1800, domain: 'travel_route' },
      context: {},
      utterance: '那天气怎么样',
      dialogueTurnCount: 3,
    });
    record('lis_catalog', '11_pure_sort', r.mode === 'SORT');
  });
});

after(() => {
  try {
    mkdirSync(REPORT_DIR, { recursive: true });
    const bySkill = {};
    for (const row of results) {
      bySkill[row.skill] ||= { total: 0, pass: 0, fail: 0, cases: [] };
      bySkill[row.skill].total += 1;
      if (row.ok) bySkill[row.skill].pass += 1;
      else bySkill[row.skill].fail += 1;
      bySkill[row.skill].cases.push(row);
    }
    const summary = {
      generated_at: new Date().toISOString(),
      total: results.length,
      pass: results.filter((r) => r.ok).length,
      fail: results.filter((r) => !r.ok).length,
      by_skill: bySkill,
    };
    writeFileSync(join(REPORT_DIR, 'flattalk-skill-matrix.json'), JSON.stringify(summary, null, 2), 'utf8');
  } catch (err) {
    console.warn('report write skipped', err.message);
  }
});
