import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnvelope } from '../../contracts/envelope.js';
import { composeInteractions } from '../interaction-composer.js';
import { classifyIntent } from '../intent-classifier/index.js';
import { fillTemplateSlots, fillTravelWeatherRisk } from '../model-service.js';
import { renderTemplateCardResult } from '../render/template-card-renderer.js';
import { identifyScene } from '../scene-router/index.js';
import { createDataService } from '../../services/data-service.js';
import { createRagService } from '../../services/rag-service.js';
import { describeLibrary, discoverTemplates } from '../../template-card/index.js';
import { getTraceLogger } from '../observability/trace-logger.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../../..');
const skillsRoot = path.join(projectRoot, 'src', 'skills');

// 从上下文/业务数据中解析天气查询的城市名（优先 action 传入的目的地）
function resolveWeatherCity(request = {}, businessData = {}) {
  const params = request.context?.action_params || {};
  const fromParams = params.city || request.context?.city;
  if (fromParams && String(fromParams).trim()) return String(fromParams).trim();
  const bd = businessData || {};
  const jtd = bd.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);
  const route = bd.route || (Array.isArray(bd.routes) ? bd.routes[0] : null);
  return String(product?.destination || product?.city || route?.destination || bd.destination || '防城港').trim();
}

export function createChatOrchestrator(options = {}) {
  const dataService = options.dataService ?? createDataService(options.dataServiceOptions ?? {});
  const ragService = options.ragService ?? createRagService({ knowledgeData: dataService.knowledgeData });
  const modelService = options.modelService ?? { fillTemplateSlots };
  const weatherService = options.weatherService ?? null;

  return {
    async run(request = {}) {
      const t0 = Date.now();
      const stages = [];
      const mark = (stage, label, detail) => {
        stages.push({ stage, label, ms: Date.now() - t0, detail: detail == null ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)) });
      };
      const traceQuestion = (typeof request.message === 'string' && request.message)
        ? request.message
        : (request.action ? ('动作:' + request.action) : (request.text || '(空消息)'));
      const traceKind = request.action ? 'action' : 'chat';
      try {
        const sceneInput = normalizeRequest(request);
        mark('intent', '意图识别', { text_len: sceneInput.text.length });
        const intentContext = await loadIntentContext(sceneInput, options);
        const sceneDecision = identifyScene({ ...sceneInput, intent_context: intentContext }, options.sceneOptions ?? {});
        mark('scene_route', '场景路由', { scene_key: sceneDecision?.scene_key, decision: sceneDecision?.decision, confidence: sceneDecision?.confidence });
        const acceptedScene = acceptScene(request, sceneDecision);
        const skillKey = acceptedScene?.scene_key || 'common';
        const skillTemplates = resolveSkillTemplates(skillKey);
        const knowledge = acceptedScene
          ? await retrieveMultiKnowledge(ragService, {
              skill_keys: Array.from(new Set([skillKey, ...(acceptedScene.required_knowledge || [])])),
              query: sceneInput.text,
              limit: 3,
              filters: {
                elder_id: request.elder_id || request.context?.elder_id || request.elderScope || '',
                role_key: request.role || request.roleKey || '',
              },
            })
          : { source: 'scene_rejected', status: 'skipped', matches: [] };
        mark('knowledge', '知识检索', { status: knowledge.status, source: knowledge.source, local_status: knowledge.local_status, remote_status: knowledge.remote_status, local_count: knowledge.local_count, remote_count: knowledge.remote_count });
        const businessData = await loadBusinessData({ sceneDecision: acceptedScene || sceneDecision, request, dataService });
        mark('business_data', '业务数据', { loaded: !!(businessData && Object.keys(businessData).length) });
        const routedTemplateId = selectRoutedTemplateId(acceptedScene);
        // 天气风险动作：结合上下文城市，调用腾讯天气接口，由模型合成天气风险卡片
        const weatherActionCity = (acceptedScene?.scene_key === 'travel_route' && request.context?.action_key === 'travel_route.check_weather_risk')
          ? resolveWeatherCity(request, businessData)
          : null;
        let modelResult;
        if (weatherActionCity) {
          const weather = weatherService ? await weatherService.getWeather(weatherActionCity).catch(() => null) : null;
          modelResult = fillTravelWeatherRisk({ city: weatherActionCity, weather, business_data: businessData });
          mark('model', '天气风险研判', { city: weatherActionCity, weather_ok: !!(weather && weather.ok), source: weather?.source || 'none' });
        } else {
          modelResult = await modelService.fillTemplateSlots({
            message: sceneInput.text,
            skill_key: skillKey,
            intent_context: intentContext,
            template_id: request.template_id || request.templateId || routedTemplateId,
            default_template_id: skillTemplates.defaultTemplateId,
            template_library: skillTemplates.library,
            evidence: knowledge.matches,
            business_data: businessData,
          });
          mark('model', '模板填充', { model: modelResult.model_used, status: modelResult.model_status, template_id: modelResult.template_id });
        }
        const interactions = composeInteractions({ sceneDecision, modelResult });
        const renderResult = renderTemplateCardResult({
          templateDir: skillTemplates.templateDir,
          modelResult,
          actions: interactions.actions,
          followupSuggestions: interactions.followup_suggestions,
        });
        mark('render', '卡片渲染', { status: renderResult.render_status, template_id: renderResult.card?.templateId });
        const templateId = renderResult.card.templateId || modelResult.template_id || skillTemplates.defaultTemplateId;

        const envelope = buildEnvelope({
          request_id: request.request_id,
          conversation_id: request.conversation_id,
          turn_id: request.turn_id,
          skill_key: skillKey,
          intent: acceptedScene?.intent || 'common.chat',
          template_id: templateId,
          template_key: templateId,
          answer_text: modelResult.answer_text,
          data: modelResult.data,
          actions: interactions.actions,
          followup_suggestions: interactions.followup_suggestions,
          evidence: Array.isArray(knowledge.matches) ? knowledge.matches : [],
          route: {
            source: 'flatTalk.chat_orchestrator',
            scene_key: acceptedScene?.scene_key || 'common',
            decision: sceneDecision?.decision || 'reject',
            confidence: sceneDecision?.confidence || 0,
            routed: sceneDecision?.routed === true,
            template_reason: renderResult.card.reason,
            render_status: renderResult.render_status,
            knowledge_status: knowledge.status || 'skipped',
            knowledge_source: knowledge.source || '',
            knowledge_local_status: knowledge.local_status || '',
            knowledge_remote_status: knowledge.remote_status || '',
            knowledge_error: knowledge.remote_error || null,
            intent_context: intentContext,
            model_used: modelResult.model_used || '',
            model_error: modelResult.model_error || null,
          },
        });
        mark('done', '响应封装', { scene_key: envelope.route.scene_key, routed: envelope.route.routed, intent: envelope.intent });
        const traceLevel = (envelope.route.decision === 'reject' || envelope.route.knowledge_status === 'error' || envelope.route.model_error || envelope.route.render_status === 'error') ? 'warn' : 'ok';
        try {
          getTraceLogger().write({
            level: traceLevel, kind: traceKind, question: traceQuestion,
            conversation_id: request.conversation_id, turn_id: request.turn_id, request_id: request.request_id,
            route: envelope.route, stages,
          });
        } catch {}

        return {
          ...envelope,
          answer: envelope.answer_text,
          llm: renderResult.llm,
          card: renderResult.card,
          rendered_html: renderResult.rendered_html,
          html_fallback: renderResult.html_fallback,
          debug: {
            scene_confidence: sceneDecision?.confidence || 0,
            knowledge_status: knowledge.status || (Array.isArray(knowledge.matches) && knowledge.matches.length ? 'hit' : 'empty'),
            knowledge_source: knowledge.source || '',
            knowledge_error: knowledge.remote_error || null,
            intent_context: intentContext,
            model_status: modelResult.model_status || 'ok',
            model_used: modelResult.model_used || '',
            model_error: modelResult.model_error || null,
            render_status: renderResult.render_status,
          },
        };
      } catch (err) {
        try { mark('error', '异常', { message: err.message }); } catch {}
        try {
          getTraceLogger().write({
            level: 'error', kind: traceKind, question: traceQuestion,
            conversation_id: request.conversation_id, turn_id: request.turn_id, request_id: request.request_id,
            route: undefined, stages,
            error: err.message, stack: String(err.stack || '').split('\n').slice(0, 4).join(' | '),
          });
        } catch {}
        throw err;
      }
    },
  };
}

async function loadIntentContext(sceneInput, options) {
  if (options.intentClassifier) {
    return options.intentClassifier.classifyIntent(sceneInput, options.intentOptions ?? {});
  }
  return classifyIntent(sceneInput, options.intentOptions ?? {});
}

function normalizeRequest(request) {
  return {
    ...request,
    text: request.message || request.text || request.query || '',
  };
}

function acceptScene(request, sceneDecision) {
  const forcedSceneKey = normalizeForcedSkillKey(request.skill_key || request.skillKey);
  if (forcedSceneKey) {
    return {
      scene_key: forcedSceneKey,
      intent: request.intent || `${forcedSceneKey}.forced`,
      decision: 'accept',
      confidence: 1,
      routed: true,
      forced: true,
    };
  }

  const previousSceneKey = request.context?.previous_turn_id
    ? normalizeForcedSkillKey(request.context?.previous_scene)
    : '';
  if (previousSceneKey && request.context?.reenter_chat !== true && sceneDecision?.decision === 'reject') {
    return {
      scene_key: previousSceneKey,
      intent: `${previousSceneKey}.followup`,
      decision: 'accept',
      confidence: Math.max(sceneDecision?.confidence || 0, 0.86),
      routed: true,
      continued: true,
    };
  }

  return sceneDecision?.decision === 'accept' ? sceneDecision : null;
}

function selectRoutedTemplateId(sceneDecision) {
  if (!sceneDecision || sceneDecision.decision !== 'accept') return '';
  if (sceneDecision.scene_key === 'common' && String(sceneDecision.intent || '').startsWith('elder_')) {
    return 'policy_card';
  }
  if (sceneDecision.intent === 'meal_plan_weekly_plan') return 'weekly_plan';
  if (sceneDecision.scene_key === 'travel_route') {
    return sceneDecision.intent === 'travel_route_plan' ? 'travel_itinerary_card' : 'route_card';
  }
  if (sceneDecision.scene_key === 'meal_plan') return 'diet_card';
  if (sceneDecision.scene_key === 'health_risk_warning') return 'health_warning_card';
  return '';
}

async function retrieveKnowledge(ragService, request) {
  // 各技能统一走「本地知识库优先」检索（retriever 内部已实现：本地命中在前，远程仅作补充）
  if (typeof ragService.retrieveKnowledge === 'function') {
    return ragService.retrieveKnowledge(request);
  }
  return { source: 'knowledge_unavailable', status: 'not_configured', matches: [] };
}

async function retrieveMultiKnowledge(ragService, { skill_keys = [], query, limit = 3, filters = {} } = {}) {
  // 多技能合并时仍保持「本地优先」：本地(origin=local)排前，远程(origin=remote)补后，同类按 score 降序
  const allMatches = [];
  let remoteStatus = 'disabled';
  let remoteError = null;
  for (const skill_key of skill_keys) {
    const r = await retrieveKnowledge(ragService, { skill_key, query, limit, filters });
    if (r && Array.isArray(r.matches)) allMatches.push(...r.matches);
    if (r) {
      const rs = r.remote_status || (r.source === 'remote_knowledge' ? 'remote_hit' : 'disabled');
      if (rs === 'remote_error') remoteStatus = 'remote_error';
      else if (rs !== 'disabled' && remoteStatus !== 'remote_error') remoteStatus = rs;
      if (r.remote_error && !remoteError) remoteError = r.remote_error;
    }
  }
  const seen = new Set();
  const local = [];
  const remote = [];
  for (const m of allMatches) {
    const key = String(m.content || m.text || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    (m.origin === 'remote' ? remote : local).push(m);
  }
  const byScore = (a, b) => (b.score || 0) - (a.score || 0);
  const merged = [...local.sort(byScore), ...remote.sort(byScore)].slice(0, Math.max(1, Number(limit) || 3));
  const localCount = local.length;
  const remoteCount = remote.length;
  let status;
  if (localCount) status = 'local_hit';
  else if (remoteCount) status = 'remote_hit';
  else if (remoteStatus === 'remote_error') status = 'remote_error';
  else status = 'empty';
  return {
    source: 'local_first',
    status,
    local_status: localCount ? 'local_hit' : 'local_empty',
    local_count: localCount,
    remote_status: remoteStatus,
    remote_count: remoteCount,
    remote_error: remoteError,
    matches: merged,
  };
}

async function loadBusinessData({ sceneDecision, request, dataService }) {
  if (sceneDecision?.decision !== 'accept') return {};

  if (sceneDecision?.scene_key === 'meal_plan') {
    return dataService.tableData.getMealPlanTables({
      elder_id: request.elder_id || request.context?.elder_id || 'demo_elder_1',
    });
  }

  if (sceneDecision?.scene_key === 'travel_route' && typeof dataService.tableData.getTravelRouteTables === 'function') {
    const tableData = await dataService.tableData.getTravelRouteTables();
    const jtd = typeof dataService.travelData?.jtd?.buildRouteProductContext === 'function'
      ? await dataService.travelData.jtd.buildRouteProductContext(request)
      : {
          provider: 'jintiaodong',
          required: true,
          source_status: 'unavailable',
          products: [],
          selected_product: null,
          warnings: ['jtd_service_not_configured'],
        };
    return {
      ...tableData,
      jtd,
    };
  }

  if (sceneDecision?.scene_key === 'health_risk_warning' && typeof dataService.tableData.getHealthRiskWarningTables === 'function') {
    const tableData = await dataService.tableData.getHealthRiskWarningTables();
    const remote = typeof dataService.remoteHealth?.buildRiskRemoteContext === 'function'
      ? await dataService.remoteHealth.buildRiskRemoteContext(request)
      : {
          provider: 'yunzhen365',
          required: false,
          source_status: 'unavailable',
          metrics: [],
          warnings: ['remote_health_service_not_configured'],
        };
    return {
      ...tableData,
      remote,
    };
  }

  return {};
}

function normalizeForcedSkillKey(skillKey) {
  if (!skillKey || typeof skillKey !== 'string') return '';
  const skillDir = path.join(skillsRoot, skillKey);
  return fs.existsSync(skillDir) ? skillKey : '';
}

function resolveSkillTemplates(skillKey) {
  const selectedSkillKey = fs.existsSync(path.join(skillsRoot, skillKey)) ? skillKey : 'common';
  const skillRoot = path.join(skillsRoot, selectedSkillKey);
  const htmlRoot = path.join(skillRoot, 'templates', 'html');
  const nestedDefaultDir = path.join(htmlRoot, selectedSkillKey);
  const templateDir = hasHtmlFiles(nestedDefaultDir)
    ? nestedDefaultDir
    : hasHtmlFiles(htmlRoot)
    ? htmlRoot
    : nestedDefaultDir;
  const manifestPath = path.join(skillRoot, 'manifest.json');
  const manifest = readJsonSafe(manifestPath);
  const templates = discoverTemplates(templateDir);
  const defaultTemplateId = manifest.default_template || templates[0]?.id || 'fallback';

  return {
    skillKey: selectedSkillKey,
    templateDir,
    defaultTemplateId,
    library: describeLibrary(templates),
  };
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function hasHtmlFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath).some((file) => file.toLowerCase().endsWith('.html'));
  } catch {
    return false;
  }
}
