import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnvelope } from '../../contracts/envelope.js';
import { composeInteractions, loadStaticFollowups } from '../interaction-composer.js';
import { classifyIntent } from '../intent-classifier/index.js';
import { fillTemplateSlots, fillTravelWeatherRisk, fillTravelWeatherRiskCard } from '../model-service.js';
import { extractCities } from '../city-extractor/index.js';
import { renderTemplateCardResult } from '../render/template-card-renderer.js';
import { identifyScene } from '../scene-router/index.js';
import { resolveTemplateId } from '../scene-router/intent-template-map.js';
import { createDataService } from '../../services/data-service.js';
import { createRagService } from '../../services/rag-service.js';
import { describeLibrary, discoverTemplates } from '../../template-card/index.js';
import { getTraceLogger } from '../observability/trace-logger.js';
import { getJialuFacilities, getJialuCenter } from '../../data/jialu_kangyang_center/index.js';
import { enrich as nearbyEnrich } from '../../services/nearby-resource/nearby-augmentor.js';
import {
  loadActionResourceMap,
  getActionResource,
  buildFallbackActionPrompt,
  buildFallbackContext,
  SPECIAL_CASE_ACTION_KEYS,
} from '../actions/fallback-prompt-builder.js';
import { decideTransition, TRANSITION_TYPE } from '../scene-router/scene-transition-manager.js';
import { resolveAmbiguity } from '../scene-router/ambiguity-resolver.js';
import { buildSnapshot } from '../../core/conversation/context-snapshot.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../../..');
const skillsRoot = path.join(projectRoot, 'src', 'skills');

// 从上下文/业务数据中解析天气查询的城市（优先 action 传入的目的地，返回数组以支持多城市）
function resolveWeatherCity(request = {}, businessData = {}) {
  const params = request.context?.action_params || {};
  const fromParams = params.city || request.context?.city;
  if (fromParams && String(fromParams).trim()) return [String(fromParams).trim()];
  // 从预提取结果读取
  const cities = businessData?.cities;
  if (Array.isArray(cities) && cities.length) return cities;
  const bd = businessData || {};
  const jtd = bd.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);
  const route = bd.route || (Array.isArray(bd.routes) ? bd.routes[0] : null);
  const fallback = String(product?.destination || product?.city || route?.destination || bd.primary_city || bd.destination || '').trim();
  return fallback ? [fallback] : [];
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
        mark('intent', '意图识别完成', { intent_type: intentContext?.intent_type, confidence: intentContext?.confidence });

        // ★ SOS 紧急短路：检测到 SOS/P0 意图时跳过场景评分，直接路由到应急流程
        if (intentContext?.intent_type === 'SOS' || intentContext?.urgency_level === 'P0') {
          mark('sos_bypass', 'SOS紧急短路', { keywords: intentContext?.keyword_match });
          const sosSkillKey = 'find_service';
          const sosTemplateId = 'service_emergency';
          const sosSkillTemplates = resolveSkillTemplates(sosSkillKey);
          const sosModelResult = modelService.fillTemplateSlots({
            message: sceneInput.text,
            skill_key: sosSkillKey,
            intent_context: intentContext,
            template_id: sosTemplateId,
            default_template_id: sosSkillTemplates.defaultTemplateId,
            template_library: sosSkillTemplates.library,
            evidence: [],
            business_data: {},
          });
          const sosInteractions = composeInteractions({ sceneDecision: { scene_key: sosSkillKey, intent: 'SOS', decision: 'accept', confidence: 0.95 }, modelResult: sosModelResult, staticFollowups: loadStaticFollowups(sosSkillKey, sosTemplateId) });
          const sosRenderResult = renderTemplateCardResult({
            templateDir: sosSkillTemplates.templateDir,
            modelResult: sosModelResult,
            actions: sosInteractions.actions,
            followupSuggestions: sosInteractions.followup_suggestions,
            compactFollowups: sosInteractions.compact_followups,
          });
          mark('sos_render', 'SOS卡片渲染', { status: sosRenderResult.render_status });
          const sosEnvelope = buildEnvelope({
            request_id: request.request_id,
            conversation_id: request.conversation_id,
            turn_id: request.turn_id,
            answer_text: sosModelResult.answer_text || '检测到紧急情况，请立即拨打120或点击下方按钮求助。',
            intent: 'SOS',
            skill_key: sosSkillKey,
            agent_key: request.context?.agent_key || sosSkillKey,
            agent_switched: request.context?.agent_switched || false,
            scene_key: sosSkillKey,
            template_id: sosTemplateId,
            routed: true,
            confidence: 0.95,
            route_extras: {
              source: 'flatTalk.sos_emergency_bypass',
              sos_keywords: intentContext?.keyword_match || [],
              urgency_level: 'P0',
              template_reason: sosRenderResult.card.reason,
              render_status: sosRenderResult.render_status,
              intent_context: intentContext,
            },
          });
          return {
            ...sosEnvelope,
            answer: sosEnvelope.answer_text,
            llm: sosRenderResult.llm,
            card: sosRenderResult.card,
            rendered_html: sosRenderResult.rendered_html,
            html_fallback: sosRenderResult.html_fallback,
            debug: { sos_bypass: true, sos_keywords: intentContext?.keyword_match || [] },
          };
        }

        // ★ 轻量追问短路：followup 按钮触发且 skill_key 已知时，跳过意图/场景/知识检索，
        //    直接走 模板解析→业务数据→本地模板填充→渲染，避免完整 16 步流水线
        console.log('[bypass-check]', {
          has_followup_source: !!request.context?.followup_source,
          followup_source: request.context?.followup_source,
          skill_key: request.skill_key,
          reenter_chat: request.context?.reenter_chat,
          action_key: request.context?.action_key,
        });
        if (request.context?.followup_source && request.skill_key && !request.context?.reenter_chat) {
          mark('followup_bypass', '轻量追问', { skill_key: request.skill_key, action_key: request.context?.action_key });
          const fSkillKey = request.skill_key;
          const fSkillTemplates = resolveSkillTemplates(fSkillKey);
          const fTemplateId = request.template_id || request.templateId || fSkillTemplates.defaultTemplateId;
          // 仅加载业务数据（轻量，按场景查询本地表）
          const fBusinessData = await loadBusinessData({
            sceneDecision: { scene_key: fSkillKey, decision: 'accept', confidence: 1 },
            request,
            dataService,
          });
          mark('followup_data', '追问业务数据', { loaded: !!(fBusinessData && Object.keys(fBusinessData).length) });
          // 本地确定性模板填充（不走 LLM）
          const fModelResult = await fillTemplateSlots({
            message: sceneInput.text,
            template_id: fTemplateId,
            default_template_id: fSkillTemplates.defaultTemplateId,
            template_library: fSkillTemplates.library,
            business_data: fBusinessData,
            intent_context: { intent: `${fSkillKey}.followup`, action_key: request.context?.action_key, action_params: request.context?.action_params },
          });
          mark('followup_fill', '追问模板填充', { template_id: fModelResult.template_id });
          const fStaticFollowups = loadStaticFollowups(fSkillKey, fModelResult.template_id || fTemplateId);
          const fInteractions = composeInteractions({
            sceneDecision: { scene_key: fSkillKey, intent: `${fSkillKey}.followup`, decision: 'accept', confidence: 1 },
            modelResult: fModelResult,
            staticFollowups: fStaticFollowups,
          });
          const fRenderResult = renderTemplateCardResult({
            templateDir: fSkillTemplates.templateDir,
            modelResult: fModelResult,
            actions: fInteractions.actions,
            followupSuggestions: fInteractions.followup_suggestions,
            compactFollowups: fInteractions.compact_followups,
          });
          mark('followup_render', '追问卡片渲染', { status: fRenderResult.render_status });
          const fTemplateIdFinal = fRenderResult.card.templateId || fModelResult.template_id || fTemplateId;
          const fEnvelope = buildEnvelope({
            request_id: request.request_id,
            conversation_id: request.conversation_id,
            turn_id: request.turn_id,
            skill_key: fSkillKey,
            intent: `${fSkillKey}.followup`,
            template_id: fTemplateIdFinal,
            template_key: fTemplateIdFinal,
            answer_text: fModelResult.answer_text,
            data: fModelResult.data,
            actions: fInteractions.actions,
            followup_suggestions: fInteractions.followup_suggestions,
            evidence: [],
            route: {
              source: 'flatTalk.followup_bypass',
              scene_key: fSkillKey,
              decision: 'accept',
              confidence: 1,
              routed: true,
              template_reason: fRenderResult.card.reason,
              render_status: fRenderResult.render_status,
            },
          });
          mark('done', '追问响应封装', { scene_key: fEnvelope.route.scene_key });
          try {
            getTraceLogger().write({
              level: 'ok', kind: 'followup', question: traceQuestion,
              conversation_id: request.conversation_id, turn_id: request.turn_id, request_id: request.request_id,
              route: fEnvelope.route, stages,
            });
          } catch {}
          return {
            ...fEnvelope,
            answer: fEnvelope.answer_text,
            llm: fRenderResult.llm,
            card: fRenderResult.card,
            rendered_html: fRenderResult.rendered_html,
            html_fallback: fRenderResult.html_fallback,
            debug: { followup_bypass: true, skill_key: fSkillKey, template_id: fTemplateIdFinal },
          };
        }

        // 加载 per-skill 场景阈值（来自 skill_configs 表），使各技能可独立调节 accept/review 门槛
        let thresholdsByScene = options.thresholdsByScene ?? null;
        if (!thresholdsByScene && typeof dataService.tableData?.getSkillConfigs === 'function') {
          try {
            const skillConfigs = await dataService.tableData.getSkillConfigs();
            thresholdsByScene = {};
            for (const [key, cfg] of Object.entries(skillConfigs)) {
              if (cfg?.scene_thresholds) thresholdsByScene[key] = cfg.scene_thresholds;
            }
          } catch { thresholdsByScene = null; }
        }
        const sceneDecision = identifyScene(
          { ...sceneInput, intent_context: intentContext },
          { ...(options.sceneOptions ?? {}), ...(thresholdsByScene ? { thresholdsByScene } : {}) },
        );
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
        // 城市预提取（仅 travel_route 场景）：从消息+业务数据中提取城市，注入 business_data
        if (skillKey === 'travel_route') {
          try {
            const cityResult = await extractCities({
              message: request.message || sceneInput.text,
              business_data: businessData,
              conversation_history: request.history,
            });
            if (cityResult?.primary) {
              businessData.primary_city = cityResult.primary;
              businessData.cities = cityResult.cities;
            }
            mark('city_extract', '城市提取', { primary: cityResult?.primary, cities: cityResult?.cities, source: cityResult?.source });
          } catch (e) {
            mark('city_extract', '城市提取', { error: e.message });
          }
        }
        const availableTemplateIds = (skillTemplates.library || []).map(t => t.id);
        const routedTemplateId = selectRoutedTemplateId(acceptedScene, availableTemplateIds);
        // 天气风险动作：结合上下文城市，调用腾讯天气接口，由模型合成天气风险卡片
        const weatherActionCities = (acceptedScene?.scene_key === 'travel_route' && request.context?.action_key === 'travel_route.check_weather_risk')
          ? resolveWeatherCity(request, businessData)
          : [];
        let modelResult;
        const fallbackActionKey = request.context?.action_key
          && !SPECIAL_CASE_ACTION_KEYS.includes(request.context.action_key)
          ? request.context.action_key
          : null;
        const actionResourceMap = options.actionResourceMap ?? loadActionResourceMap();

        if (weatherActionCities.length > 0) {
          // 并行查询多城市天气
          const weatherResults = await Promise.all(
            weatherActionCities.map((city) =>
              weatherService ? weatherService.getWeather(city).catch(() => null) : null
            )
          );
          const primaryCity = weatherActionCities[0];
          const primaryWeather = weatherResults[0];
          modelResult = fillTravelWeatherRisk({
            city: primaryCity,
            weather: primaryWeather,
            business_data: businessData,
            all_cities: weatherActionCities.length > 1
              ? weatherActionCities.map((city, i) => ({ city, weather: weatherResults[i] })).filter((c) => c.weather?.ok)
              : null,
          });
          mark('model', '天气风险研判', {
            cities: weatherActionCities,
            primary_ok: !!(primaryWeather && primaryWeather.ok),
            source: primaryWeather?.source || 'none',
          });
        } else if (fallbackActionKey) {
          // 通用兜底：未被特例白名单覆盖的按钮动作，生成五要素提示词 → 调大模型 → 渲染。
          const resource = getActionResource(fallbackActionKey, actionResourceMap);
          const skillResources = Array.isArray(actionResourceMap?.actions)
            ? actionResourceMap.actions.filter((a) => a.skill_key === (resource?.skill_key || skillKey))
            : [];
          let fallbackEvidence = [];
          if (resource && resource.target === 'knowledge') {
            const ev = await retrieveMultiKnowledge(ragService, {
              skill_keys: [skillKey, resource.skill_key].filter(Boolean),
              query: resource.label || fallbackActionKey,
              limit: 3,
            }).catch(() => ({ matches: [] }));
            fallbackEvidence = ev.matches || [];
          }
          const fallbackPrompt = buildFallbackActionPrompt(
            resource || { action_key: fallbackActionKey, label: fallbackActionKey, target: 'bff', endpoint: '（未知资源）', params_schema: {}, param_sources: {} },
            buildFallbackContext(businessData, request),
            skillResources,
            { evidence: fallbackEvidence.map((m) => `[${m.collection || '知识库'}] ${m.text || ''}`).join('\n') },
          );
          if (typeof modelService.fillFallback === 'function') {
            modelResult = await modelService.fillFallback({
              prompt: fallbackPrompt,
              label: resource?.label || fallbackActionKey,
              endpoint: resource?.endpoint || '',
              template_id: resource?.next_template_id,
              business_data: businessData,
            });
          } else {
            // 兼容未实现 fillFallback 的模型服务（如默认桩）：退化为模板填充，
            // 仍按该动作的 next_template_id（缺省 routedTemplateId）渲染，保证不崩。
            modelResult = await modelService.fillTemplateSlots({
              message: fallbackPrompt,
              skill_key: skillKey,
              intent_context: intentContext,
              template_id: resource?.next_template_id || routedTemplateId,
              default_template_id: skillTemplates.defaultTemplateId,
              template_library: skillTemplates.library,
              evidence: knowledge.matches,
              business_data: businessData,
            });
          }
          mark('model', '按钮动作通用兜底', { action_key: fallbackActionKey, target: resource?.target, model: modelResult.model_used, status: modelResult.model_status });
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
        const staticFollowups = loadStaticFollowups(skillKey, modelResult.template_id || routedTemplateId);
        const interactions = composeInteractions({ sceneDecision, modelResult, staticFollowups });
        const renderResult = renderTemplateCardResult({
          templateDir: skillTemplates.templateDir,
          modelResult,
          actions: interactions.actions,
          followupSuggestions: interactions.followup_suggestions,
          compactFollowups: interactions.compact_followups,
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
          context_snapshot: buildSnapshot(envelope),
          answer: envelope.answer_text,
          llm: renderResult.llm,
          card: renderResult.card,
          rendered_html: renderResult.rendered_html,
          html_fallback: renderResult.html_fallback,
          stages,
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
  // 如果请求中已携带 intent（如 followup 按钮），优先使用
  const requestIntent = sceneInput.intent || sceneInput.intent_context?.intent;
  if (requestIntent) {
    return { intent: requestIntent, source: 'request_override' };
  }
  if (options.intentClassifier) {
    return options.intentClassifier.classifyIntent(sceneInput, options.intentOptions ?? {});
  }
  return classifyIntent(sceneInput, options.intentOptions ?? {});
}

function normalizeRequest(request) {
  return {
    ...request,
    text: request.message || request.text || request.query || '',
    intent: request.intent || request.intent_context?.intent || '',
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

  // ★ SceneTransitionManager：统一决策
  const candidates = sceneDecision?.candidates || [];
  const transition = decideTransition(candidates, {
    previous_scene: request.previous_scene || request.context?.previous_scene,
    message: request.message || request.text || '',
  });

  // AMBIGUOUS：消歧追问
  if (transition.type === TRANSITION_TYPE.AMBIGUOUS) {
    return resolveAmbiguity(transition.candidates, request);
  }

  // FALLBACK：answer 兜底
  if (transition.type === TRANSITION_TYPE.FALLBACK) {
    return null; // 返回 null，让上游走 common/answer
  }

  // CONTINUE：延续旧场景
  if (transition.type === TRANSITION_TYPE.CONTINUE) {
    return transition.scene;
  }

  // ROUTE：直接路由（accept 或 review 均可路由）
  if (transition.type === TRANSITION_TYPE.ROUTE && transition.scene) {
    return transition.scene;
  }

  return sceneDecision?.decision === 'accept' ? sceneDecision : null;
}

function selectRoutedTemplateId(sceneDecision, availableIds = []) {
  if (!sceneDecision || sceneDecision.decision !== 'accept') return '';

  const sceneKey = sceneDecision.scene_key;
  const intent = sceneDecision.intent || '';

  // 通过 intent-template-map 查找
  const templateId = resolveTemplateId(sceneKey, intent, availableIds);
  if (templateId) return templateId;

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

  if (sceneDecision?.scene_key === 'find_service' && typeof dataService.tableData.getFindServiceTables === 'function') {
    return dataService.tableData.getFindServiceTables();
  }

  if (sceneDecision?.scene_key === 'dispatch_manage' && typeof dataService.tableData.getDispatchManageTables === 'function') {
    return dataService.tableData.getDispatchManageTables();
  }

  if (sceneDecision?.scene_key === 'nearby_resource') {
    // 拉取全量周边配套，分类/半径过滤与模板选择交由 fillNearbyResourceCard 按意图与语义完成
    const facilities = getJialuFacilities({ type: '', maxDistance: 0, limit: 0 });
    const requestLocation = request.context?.location || request.location;
    const center = (requestLocation && typeof requestLocation.lat === 'number')
      ? { lat: requestLocation.lat, lng: requestLocation.lng }
      : getJialuCenter();

    // ★ 三层富化：静态数据 + 腾讯地图补充 + Tavily 富化
    const intent = request.context?.intent || request.context?.action_key || 'all';
    let enrichedFacilities = facilities;
    let enrichStats = null;
    try {
      const enrichResult = await nearbyEnrich(facilities, center, intent);
      enrichedFacilities = enrichResult.facilities;
      enrichStats = enrichResult.stats;
    } catch (err) {
      console.warn('[orchestrator] nearby enrichment failed, using raw facilities:', err.message);
    }

    return {
      jialu_facilities: enrichedFacilities,
      jialu_center: center,
      _enrich_stats: enrichStats,
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
