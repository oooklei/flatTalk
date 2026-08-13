import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnvelope } from '../../contracts/envelope.js';
import { composeInteractions, loadStaticFollowups } from '../interaction-composer.js';
import { templateIdFromAction } from '../actions/action-dispatcher.js';
import { classifyIntent } from '../intent-classifier/index.js';
import { fillTemplateSlots, fillTravelWeatherRisk, fillTravelWeatherRiskCard } from '../model-service.js';
import { extractCities } from '../city-extractor/index.js';
import { renderTemplateCardResult } from '../render/template-card-renderer.js';
import { identifyScene } from '../scene-router/index.js';
// intent→template 映射已统一到 config/intent-catalog.json（与 LIS IntentKB 同源）。
// 原 scene-router/intent-template-map.js 是第二份映射表，已删除。
import { matchPublishedPackages, getPublishedPackageById } from '../scene-router/publish-index.js';
import { inferRouteType } from '../scene-router/rules/travel-route.js';
import { createDataService } from '../../services/data-service.js';
import { createRagService } from '../../services/rag-service.js';
import { createOrderService } from '../../services/order/order-service.js';
import { createWorkorderService } from '../../services/workorder/workorder-service.js';
import { describeLibrary, discoverTemplates } from '../../template-card/index.js';
import { getTraceLogger } from '../observability/trace-logger.js';
import { createDataAccessTracer } from '../observability/data-access-tracer.js';
import { recordKeepOk } from '../observability/degradation-monitor.js';
import { getJialuFacilities, getJialuCenter } from '../../data/jialu_kangyang_center/index.js';
import { enrich as nearbyEnrich } from '../../services/nearby-resource/nearby-augmentor.js';
import { TencentMapAdapter } from '../../services/map/tencent-map-adapter.js';
import {
  loadActionResourceMap,
  getActionResource,
  buildFallbackActionPrompt,
  buildFallbackContext,
  SPECIAL_CASE_ACTION_KEYS,
} from '../actions/fallback-prompt-builder.js';
import { decideTransition, TRANSITION_TYPE } from '../scene-router/scene-transition-manager.js';
import { resolveAmbiguity } from '../scene-router/ambiguity-resolver.js';
import { logSceneDecision } from '../scene-router/decision-log.js';
import { buildSnapshot } from '../../core/conversation/context-snapshot.js';
import { understandAndAdapt, emptySemantic, SEMANTIC_SOURCES } from '../semantic/index.js';
import { createSupervisor } from '../agents/supervisor.js';
import { mockElders, getMockUserByToken, isMockEldersAllowed } from '../../services/interface-data/mock-collaboration.js';
import {
  isLisGateEnabled,
  getLisBaseUrl,
  tryLisGate,
  loadCatalogEntries,
} from '../lis/lis-gate-hook.js';
import { createLisClient } from '../lis/lis-client.js';
import { runPreRoute } from '../pipeline/run-pre-route.js';
import { runPostRoute } from '../pipeline/run-post-route.js';
import { mergePendingIntoInteractions } from '../pipeline/pending-intents.js';
import { readBus } from '../context-bus/store.js';
import {
  extractMentionedName,
  hasTravelSignal,
  isWeakOrChitchatUtterance,
} from '../lis/utterance-guards.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../../..');
const skillsRoot = path.join(projectRoot, 'src', 'skills');

const _supervisorForGuard = createSupervisor();

// 从上下文/业务数据中解析天气查询的城市（优先 action 传入的目的地，返回数组以支持多城市）
function resolveWeatherCity(request = {}, businessData = {}) {
  const params = request.context?.action_params || request.params || {};
  const ctx = request.context || {};
  // 按钮 params 常传 destination（天气卡 followup），兼容 city
  const fromParams = firstNonEmpty(
    params.city,
    params.destination,
    ctx.city,
    ctx.destination,
    ctx.previous_city,
    ctx.previous_destination,
  );
  if (fromParams) return [fromParams];
  // 从预提取结果读取
  const cities = businessData?.cities;
  if (Array.isArray(cities) && cities.length) {
    return cities.map((c) => String(c || '').trim()).filter(Boolean);
  }
  const bd = businessData || {};
  const jtd = bd.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);
  const route = bd.route || (Array.isArray(bd.routes) ? bd.routes[0] : null);
  const fallback = firstNonEmpty(
    product?.destination,
    product?.city,
    route?.destination,
    bd.primary_city,
    bd.destination,
    bd.city,
  );
  return fallback ? [fallback] : [];
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export function createChatOrchestrator(options = {}) {
  const dataService = options.dataService ?? createDataService(options.dataServiceOptions ?? {});
  const ragService = options.ragService ?? createRagService({ knowledgeData: dataService.knowledgeData });
  const modelService = options.modelService ?? { fillTemplateSlots };
  const weatherService = options.weatherService ?? null;
  const contextManager = options.contextManager ?? null;
  const smartFallbackHandler = options.smartFallbackHandler ?? null;

  return {
    async run(request = {}) {
      const t0 = Date.now();
      const stages = [];
      const mark = (stage, label, detail) => {
        stages.push({
          stage,
          label,
          ms: Date.now() - t0,
          detail: detail == null ? '' : detail,
        });
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
          const semantic = emptySemantic(SEMANTIC_SOURCES.SKIPPED_ACTION);
          sceneInput.semantic = semantic;
          request.semantic = semantic;
          mark('sos_bypass', 'SOS紧急短路', { keywords: intentContext?.keyword_match });
          const sosSkillKey = 'find_service';
          const sosTemplateId = 'service_emergency';
          const sosSkillTemplates = resolveSkillTemplates(sosSkillKey);
          let sosModelResult;
          try {
            const fillFn = typeof modelService.fillTemplateSlots === 'function'
              ? modelService.fillTemplateSlots
              : fillTemplateSlots;
            sosModelResult = await fillFn({
              message: sceneInput.text,
              skill_key: sosSkillKey,
              intent_context: intentContext,
              template_id: sosTemplateId,
              default_template_id: sosSkillTemplates.defaultTemplateId,
              template_library: sosSkillTemplates.library,
              evidence: [],
              business_data: {},
              conversation_history: [],
            });
          } catch (error) {
            mark('sos_model', 'SOS模型填充失败，使用确定性兜底', { error: error.message });
            sosModelResult = {};
          }
          sosModelResult = normalizeSosModelResult(sosModelResult, intentContext);
          const sosInteractions = composeInteractions({
            sceneDecision: {
              scene_key: 'sos',
              intent: 'SOS',
              decision: 'accept',
              confidence: 0.95,
              actions_allowed: ['sos.*'],
            },
            modelResult: sosModelResult,
            staticFollowups: loadStaticFollowups(sosSkillKey, sosTemplateId),
          });
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
            answer_text: sosModelResult.answer_text,
            data: sosModelResult.data,
            actions: sosInteractions.actions,
            followup_suggestions: sosInteractions.followup_suggestions,
            intent: 'SOS',
            skill_key: sosSkillKey,
            agent_key: request.context?.agent_key || sosSkillKey,
            agent_switched: request.context?.agent_switched || false,
            scene_key: sosSkillKey,
            template_id: sosTemplateId,
            routed: true,
            confidence: 0.95,
            route: {
              source: 'flatTalk.sos_emergency_bypass',
              scene_key: sosSkillKey,
              decision: 'accept',
              confidence: 0.95,
              routed: true,
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
            context_snapshot: buildSnapshot({ ...sosEnvelope, semantic: request.semantic || sceneInput.semantic }),
            stages,
            debug: { sos_bypass: true, sos_keywords: intentContext?.keyword_match || [] },
          };
        }

        const semanticOpts = {};
        if (options.semanticLlmCall) semanticOpts.llmCall = options.semanticLlmCall;
        if (options.semanticTimeoutMs != null) semanticOpts.timeoutMs = options.semanticTimeoutMs;
        // 闲聊/弱输入：跳过语义 LLM，避免固定等 ~1.2s
        let semantic;
        if (isWeakOrChitchatUtterance(sceneInput.text) && !request.context?.action_key) {
          semantic = emptySemantic(SEMANTIC_SOURCES.RULES_FALLBACK);
          semantic.latency_ms = 0;
          mark('semantic', '语义enrichment跳过', { source: 'chitchat_skip', ms: 0 });
        } else {
          semantic = await understandAndAdapt(sceneInput, semanticOpts);
          mark('semantic', '语义enrichment', {
            source: semantic.source,
            category: semantic.adapted?.category || '',
            destination: semantic.adapted?.destination || '',
            ms: semantic.latency_ms,
          });
        }
        sceneInput.semantic = semantic;
        request.semantic = semantic;

        // ★ Context Bus pre-route（默认 ON；FLATTALK_CONTEXT_BUS=0 关闭）
        const contextBusOn = String(process.env.FLATTALK_CONTEXT_BUS ?? '1').trim() !== '0';
        let contextProfile = null;
        let contextExtracted = null;
        if (contextBusOn && options.session && sceneInput.text) {
          const pre = await runPreRoute({
            session: options.session,
            message: sceneInput.text,
            llmCall: options.contextBusLlmCall || null,
            mark,
          });
          if (options.sessionStore?.save) {
            try { await options.sessionStore.save(options.session); } catch { /* best-effort */ }
          }
          if (pre.halt && pre.envelopeHint) {
            const hint = pre.envelopeHint;
            const answerText = hint.message || '';
            const safetyEnvelopeOut = buildEnvelope({
              request_id: request.request_id,
              conversation_id: request.conversation_id,
              turn_id: request.turn_id,
              skill_key: hint.skill_key || 'common',
              agent_key: hint.skill_key || 'common',
              intent: `common.${hint.template_id || 'safety'}`,
              template_id: hint.template_id || 'answer',
              template_key: hint.template_id || 'answer',
              answer_text: answerText,
              data: { safety: pre.safety || null },
              actions: [],
              followup_suggestions: [],
              evidence: [],
              route: {
                source: 'flatTalk.context_bus_safety',
                scene_key: 'common',
                decision: 'halt',
                confidence: 1,
                routed: false,
                intent_context: intentContext,
              },
            });
            mark('safety_halt', '安全门短路', { action: pre.safety?.action });
            return {
              ...safetyEnvelopeOut,
              answer: answerText,
              context_snapshot: buildSnapshot({ ...safetyEnvelopeOut, semantic: request.semantic || sceneInput.semantic }),
              stages,
              debug: { safety: pre.safety },
            };
          }
          if (pre.halt && pre.error) {
            const answerText = pre.error.message || '请将问题控制在500字以内，并分段提问。';
            const errEnvelope = buildEnvelope({
              request_id: request.request_id,
              conversation_id: request.conversation_id,
              turn_id: request.turn_id,
              skill_key: 'common',
              agent_key: 'common',
              intent: 'common.text_too_long',
              template_id: 'answer',
              template_key: 'answer',
              answer_text: answerText,
              data: { normalize_error: pre.error },
              actions: [],
              followup_suggestions: [],
              evidence: [],
              route: {
                source: 'flatTalk.context_bus_normalize',
                scene_key: 'common',
                decision: 'halt',
                confidence: 1,
                routed: false,
                intent_context: intentContext,
              },
            });
            return {
              ...errEnvelope,
              answer: answerText,
              context_snapshot: buildSnapshot({ ...errEnvelope, semantic: request.semantic || sceneInput.semantic }),
              stages,
              debug: { normalize_error: pre.error },
            };
          }
          if (pre.normalized_text) {
            sceneInput.text = pre.normalized_text;
            request.message = pre.normalized_text;
          }
          contextExtracted = pre.extracted || null;
          if (contextExtracted?.intents?.length) {
            mark('intent_extract', '抽取意图(不覆盖路由)', {
              intents: contextExtracted.intents,
              override: String(process.env.FLATTALK_INTENT_EXTRACT_OVERRIDE || '').trim() === '1',
            });
          }
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
        // LIS 关闭时仍可用 action_key 锁定；LIS 开启时一律走纯 SORT，禁止本地 Skill Lock 摆渡。
        const actionLockedSkillKey = (!isLisGateEnabled()
          && request.context?.action_key && request.skill_key
          && !request.context?.reenter_chat)
          ? request.skill_key
          : null;

        let sceneDecision;
        let skillKey;
        let acceptedScene;

        // ★ LIS 纯 SORT 门控（默认开启；LIS_GATE_ENABLED=0 时回退 scene-router）
        let lisGateResult = null;
        let lisSession = null;
        if (isLisGateEnabled()) {
          try {
            const sessionStore = options.sessionStore || null;
            lisSession = options.session
              || (sessionStore && request.conversation_id
                ? await sessionStore.getOrCreate(request.conversation_id)
                : { conversation_id: request.conversation_id || '', turns: [], global_context: {} });
            const lisClient = options.lisClient || createLisClient({ baseUrl: getLisBaseUrl() });
            const catalogEntries = options.catalogEntries || loadCatalogEntries();
            const gc = lisSession?.global_context || {};
            const snapshot = request.context?.context_snapshot
              || {
                scene: gc.lis_locked_scene
                  || request.context?.previous_scene
                  || '',
                intent: gc.lis_locked_intent
                  || request.context?.previous_intent
                  || '',
                template_id: gc.lis_locked_template
                  || request.context?.previous_template
                  || request.context?.last_template
                  || '',
              };
            // 把 LIS 锁定域也注入 context，供 BizHints 投影（禁止 Supervisor skill_key）
            if (gc.lis_locked_scene) {
              request.context = {
                ...(request.context || {}),
                lis_locked_scene: gc.lis_locked_scene,
                lis_locked_intent: gc.lis_locked_intent || '',
                lis_locked_template: gc.lis_locked_template || '',
                previous_scene: request.context?.previous_scene || gc.lis_locked_scene,
              };
            }
            lisGateResult = await tryLisGate({
              request,
              session: lisSession,
              catalogEntries,
              lisClient,
              snapshot,
            });
            if (sessionStore && lisSession?.conversation_id) {
              try { await sessionStore.save(lisSession); } catch { /* session persist best-effort */ }
            }
            mark('lis_gate', 'LIS门控', {
              handled: Boolean(lisGateResult?.handled),
              mode: lisGateResult?.mode || '',
              reason: lisGateResult?.reason || '',
              skill_key: lisGateResult?.skill_key || '',
              need_clarify: Boolean(lisGateResult?.need_clarify),
            });
          } catch (err) {
            lisGateResult = { handled: false, mode: 'SORT', reason: 'lis_unreachable' };
            mark('lis_gate', 'LIS门控异常回退', { error: err?.message || String(err) });
          }
        }

        // LIS NEED_CLARIFY：短路返回澄清选项（复用 ambiguity_options UI）
        if (lisGateResult?.need_clarify && Array.isArray(lisGateResult.ambiguity_options)) {
          const question = lisGateResult.clarify?.question
            || '您更想办理哪一件事？请选择或补充说明。';
          const ambEnvelope = buildEnvelope({
            request_id: request.request_id,
            conversation_id: request.conversation_id,
            turn_id: request.turn_id,
            skill_key: 'common',
            agent_key: 'common',
            intent: 'lis.need_clarify',
            template_id: 'answer',
            template_key: 'answer',
            answer_text: question,
            data: {
              lis_clarify: lisGateResult.clarify || null,
              supply_trace_id: lisGateResult.supply?.trace_id || '',
            },
            actions: [],
            followup_suggestions: [],
            evidence: [],
            route: {
              source: 'lis_clarify',
              scene_key: 'common',
              decision: 'need_clarify',
              confidence: Number(lisGateResult.supply?.decision?.max_confidence) || 0,
              routed: false,
              intent_context: intentContext,
            },
          });
          mark('lis_clarify', 'LIS澄清', {
            option_count: lisGateResult.ambiguity_options.length,
          });
          return {
            ...ambEnvelope,
            ambiguity_options: lisGateResult.ambiguity_options,
            answer: question,
            context_snapshot: buildSnapshot({ ...ambEnvelope, semantic: request.semantic || sceneInput.semantic }),
            stages,
            debug: { lis_clarify: true, option_count: lisGateResult.ambiguity_options.length },
          };
        }

        // LIS 不可达 / 未命中 / 闲聊低置信：common + LLM 兜底（禁止再摆渡业务技能）
        if (isLisGateEnabled() && !lisGateResult?.handled) {
          const unreachable = ['lis_unreachable', 'lis_unavailable', 'lis_client_missing']
            .includes(String(lisGateResult?.reason || ''));
          const fbReason = lisGateResult?.reason || 'unhandled';
          let answerText = unreachable
            ? '网络或系统暂时异常，请稍后重试。如需紧急帮助请拨打 SOS。'
            : '暂时没能准确理解您的需求，您可以换个说法，或直接选择常用服务。';
          let modelUsed = 'static';
          let modelStatus = 'static_fallback';

          // 非网络故障：调 LLM 生成自然语言 answer（技能覆盖不了时的真正兜底）
          if (!unreachable && smartFallbackHandler?.generateNaturalAnswer) {
            try {
              const llmFb = await smartFallbackHandler.generateNaturalAnswer({
                message: sceneInput.text,
                skill_key: 'common',
                conversation_id: request.conversation_id,
                conversation_history: await injectHistory(request, contextManager, 'common'),
              });
              if (llmFb?.answer_text || llmFb?.answer) {
                answerText = String(llmFb.answer_text || llmFb.answer).trim() || answerText;
                modelUsed = llmFb.model_used || 'smart_fallback';
                modelStatus = llmFb.model_status || 'smart_fallback';
              }
            } catch (err) {
              mark('lis_fallback_llm', 'LLM兜底失败用静态文案', { error: err?.message || String(err) });
            }
          }

          const fbEnvelope = buildEnvelope({
            request_id: request.request_id,
            conversation_id: request.conversation_id,
            turn_id: request.turn_id,
            skill_key: 'common',
            agent_key: 'common',
            intent: unreachable ? 'common.lis_unreachable' : 'common.lis_fallback',
            template_id: 'answer',
            template_key: 'answer',
            answer_text: answerText,
            data: { lis_reason: fbReason, title: '桂小养答复', answer_text: answerText },
            actions: [],
            followup_suggestions: [],
            evidence: [],
            route: {
              source: 'lis_common_fallback',
              scene_key: 'common',
              decision: 'fallback',
              confidence: 0,
              routed: false,
              intent_context: intentContext,
              model_used: modelUsed,
              model_status: modelStatus,
              fallback_reason: fbReason,
            },
          });
          mark('lis_fallback', 'LIS兜底common+LLM', {
            reason: fbReason,
            model: modelUsed,
            status: modelStatus,
          });
          const fbTemplates = resolveSkillTemplates('common');
          const fbRender = renderTemplateCardResult({
            templateDir: fbTemplates.templateDir,
            modelResult: {
              template_id: 'answer',
              answer_text: answerText,
              data: fbEnvelope.data,
              model_used: modelUsed,
              model_status: modelStatus,
            },
            actions: [],
            followupSuggestions: [],
            compactFollowups: [],
          });
          try {
            getTraceLogger().write({
              level: 'ok', kind: traceKind, question: traceQuestion,
              conversation_id: request.conversation_id, turn_id: request.turn_id,
              route: fbEnvelope.route, stages,
            });
          } catch { /* trace best-effort */ }
          return {
            ...fbEnvelope,
            answer: answerText,
            llm: fbRender.llm,
            card: fbRender.card,
            rendered_html: fbRender.rendered_html,
            html_fallback: fbRender.html_fallback,
            context_snapshot: buildSnapshot({ ...fbEnvelope, semantic: request.semantic || sceneInput.semantic }),
            stages,
            debug: { lis_common_fallback: true, reason: fbReason, model: modelUsed },
          };
        }

        if (lisGateResult?.handled && lisGateResult.skill_key) {
          skillKey = lisGateResult.skill_key;
          if (lisGateResult.template_id) {
            request.template_id = lisGateResult.template_id;
          }
          const lisSlots = lisGateResult.supply?.slots || {};
          if (lisSlots && typeof lisSlots === 'object') {
            request.context = {
              ...(request.context || {}),
              ...(lisSlots.city ? { city: lisSlots.city, previous_city: lisSlots.city } : {}),
              ...(lisSlots.destination
                ? { destination: lisSlots.destination, previous_destination: lisSlots.destination }
                : {}),
              lis_slots: lisSlots,
            };
          }
          acceptedScene = {
            scene_key: skillKey,
            decision: 'accept',
            confidence: Number(lisGateResult.intent?.confidence) || 1,
            routed: true,
            source: `lis_${String(lisGateResult.mode || 'gate').toLowerCase()}`,
            intent: lisGateResult.intent?.intent_id || '',
          };
          sceneDecision = acceptedScene;
          mark('scene_route', 'LIS门控锁定场景', {
            scene_key: skillKey,
            mode: lisGateResult.mode,
            template_id: lisGateResult.template_id || '',
          });
        } else if (actionLockedSkillKey) {
          // action_button 路径（仅 LIS 关闭）：直接锁定场景，不走路由
          skillKey = actionLockedSkillKey;
          acceptedScene = {
            scene_key: skillKey,
            decision: 'accept',
            confidence: 1,
            routed: true,
            source: 'action_key_lock',
          };
          sceneDecision = acceptedScene;
          mark('scene_route', 'action_key 锁定场景', { scene_key: skillKey, action_key: request.context?.action_key });
        } else {
          sceneDecision = identifyScene(
            { ...sceneInput, intent_context: intentContext },
            { ...(options.sceneOptions ?? {}), ...(thresholdsByScene ? { thresholdsByScene } : {}) },
          );
          mark('scene_route', '场景路由', { scene_key: sceneDecision?.scene_key, decision: sceneDecision?.decision, confidence: sceneDecision?.confidence });
          acceptedScene = await acceptScene(request, sceneDecision);
          // 消歧短路：把 ambiguity_options 直接回传客户端，避免继续走完整管线冲掉选项
          if (Array.isArray(acceptedScene?.ambiguity_options) && acceptedScene.ambiguity_options.length) {
            mark('ambiguity', '场景消歧', {
              options: acceptedScene.ambiguity_options.map((o) => o.scene_key || o.skill_key),
            });
            const ambSkill = acceptedScene.skill_key || 'common';
            const ambAnswer = acceptedScene.slot_overrides?.answer_text
              || '我不确定您想了解哪个方面，请选择：';
            const ambEnvelope = buildEnvelope({
              request_id: request.request_id,
              conversation_id: request.conversation_id,
              turn_id: request.turn_id,
              skill_key: ambSkill,
              agent_key: ambSkill,
              intent: 'common.ambiguity',
              template_id: acceptedScene.template_id || 'answer',
              template_key: acceptedScene.template_id || 'answer',
              answer_text: ambAnswer,
              data: {},
              actions: [],
              followup_suggestions: [],
              evidence: [],
              route: {
                source: acceptedScene.route_source || 'flatTalk.ambiguity_resolver',
                scene_key: ambSkill,
                decision: 'ambiguous',
                confidence: 0,
                routed: false,
                intent_context: intentContext,
              },
            });
            return {
              ...ambEnvelope,
              ambiguity_options: acceptedScene.ambiguity_options,
              answer: ambAnswer,
              context_snapshot: buildSnapshot({ ...ambEnvelope, semantic: request.semantic || sceneInput.semantic }),
              stages,
              debug: { ambiguity: true, option_count: acceptedScene.ambiguity_options.length },
            };
          }
          skillKey = acceptedScene?.scene_key || 'common';
        }

        // Optional: extract intent override (default off — LIS/scene remain权威)
        if (
          contextBusOn
          && String(process.env.FLATTALK_INTENT_EXTRACT_OVERRIDE || '').trim() === '1'
          && contextExtracted?.intents?.[0]?.skill_key
          && Number(contextExtracted.intents[0].confidence) >= 0.75
        ) {
          const overrideKey = String(contextExtracted.intents[0].skill_key);
          mark('intent_extract_override', '抽取意图覆盖路由', {
            from: skillKey,
            to: overrideKey,
            confidence: contextExtracted.intents[0].confidence,
          });
          skillKey = overrideKey;
          if (acceptedScene) acceptedScene.scene_key = overrideKey;
        }

        // ★ Context Bus post-route：detectors + profile inject（skillKey 已定）
        if (contextBusOn && options.session && skillKey) {
          const post = await runPostRoute({
            session: options.session,
            skillKey,
            utterance: sceneInput.text,
            mark,
          });
          if (options.sessionStore?.save) {
            try { await options.sessionStore.save(options.session); } catch { /* best-effort */ }
          }
          contextProfile = post.profile;
          if (post.detected?.need_location) {
            const answerText = '请开启定位或选择位置后，我再帮您查找附近资源。';
            const locEnvelope = buildEnvelope({
              request_id: request.request_id,
              conversation_id: request.conversation_id,
              turn_id: request.turn_id,
              skill_key: skillKey || 'nearby_resource',
              agent_key: skillKey || 'nearby_resource',
              intent: 'nearby.need_location',
              template_id: 'answer',
              template_key: 'answer',
              answer_text: answerText,
              data: {
                need_location: true,
                reason: post.detected.reason || 'missing_latlng',
                context_profile: contextProfile,
              },
              actions: [],
              followup_suggestions: [],
              evidence: [],
              route: {
                source: 'flatTalk.context_bus_location',
                scene_key: skillKey || 'nearby_resource',
                decision: 'need_location',
                confidence: 1,
                routed: false,
                intent_context: intentContext,
              },
            });
            return {
              ...locEnvelope,
              answer: answerText,
              context_snapshot: buildSnapshot({ ...locEnvelope, semantic: request.semantic || sceneInput.semantic }),
              stages,
              debug: { need_location: true, detected: post.detected },
            };
          }
        }

        const skillTemplates = resolveSkillTemplates(skillKey);
        if (skillKey === 'health_risk_warning' && typeof dataService.remoteHealth?.syncAll === 'function') {
          // ★ 异步触发同步，不阻塞主链路（写入知识库已在 writeQueue 后台执行）
          // syncAll 内部有 30s TTL 缓存，不会重复拉取
          dataService.remoteHealth.syncAll().then((sync) => {
            if (sync) mark('remote_health_sync', '云诊接口异步同步完成', {
              yz365: sync.providers?.yz365?.recordCount || 0,
              shezhen: sync.providers?.shezhen?.recordCount || 0,
              cache_total: sync.cache?.all?.recordCount || 0,
              warnings: sync.warnings || [],
            });
          }).catch((error) => {
            mark('remote_health_sync', '云诊接口异步同步失败', { error: error.message });
          });
        }
        // ★ 天气 action 快速通道：跳过知识检索/业务数据/城市提取，直接走天气分支
        const isWeatherAction = (request.context?.action_key === 'travel_route.check_weather_risk'
          && skillKey === 'travel_route');

        const knowledge = (isWeatherAction || !acceptedScene)
          ? { source: isWeatherAction ? 'weather_action_skip' : 'scene_rejected', status: 'skipped', matches: [] }
          : await retrieveMultiKnowledgeWithTimeout(ragService, {
              skill_keys: Array.from(new Set([skillKey, ...(acceptedScene.required_knowledge || [])])),
              query: sceneInput.text,
              limit: 3,
              filters: {
                elder_id: request.elder_id || request.context?.elder_id || request.elderScope || '',
                role_key: request.role || request.roleKey || '',
              },
            });
        mark('knowledge', '知识检索', { status: knowledge.status, source: knowledge.source, local_status: knowledge.local_status, remote_status: knowledge.remote_status, local_count: knowledge.local_count, remote_count: knowledge.remote_count, timed_out: Boolean(knowledge.timed_out) });
        const businessData = isWeatherAction
          ? (() => {
            const params = request.context?.action_params || request.params || {};
            const ctx = request.context || {};
            const city = firstNonEmpty(
              params.city,
              params.destination,
              ctx.previous_city,
              ctx.previous_destination,
              ctx.city,
              ctx.destination,
            );
            return {
              primary_city: city,
              destination: city,
              city,
            };
          })()
          : await loadBusinessData({
              sceneDecision: acceptedScene || sceneDecision,
              request,
              dataService,
              mark,
            });
        // 自报姓名写入业务上下文，供卡片与后续记忆使用
        const mentionedName = extractMentionedName(sceneInput.text);
        if (mentionedName && businessData && typeof businessData === 'object') {
          if (!businessData.elder_name) businessData.elder_name = mentionedName;
          businessData.mentioned_elder_name = mentionedName;
          request.context = {
            ...(request.context || {}),
            mentioned_elder_name: mentionedName,
          };
          mark('identity_mention', '身份提及提取', { name: mentionedName });
        }
        if (contextProfile && businessData && typeof businessData === 'object') {
          Object.assign(businessData, {
            role_key: contextProfile.role_key,
            elder_id: contextProfile.elder_id,
            has_elder: contextProfile.has_elder,
            context_profile: contextProfile,
          });
        }
        const accessSummary = businessData?._access || null;
        if (businessData && businessData._access) delete businessData._access;
        mark('business_data', '业务数据', {
          loaded: !!(businessData && Object.keys(businessData).length),
          skipped: isWeatherAction,
          has_elder: Boolean(businessData?.elder_id || businessData?.elder_name),
          role_key: businessData?.role_key || '',
          destination: businessData?.destination || businessData?.primary_city || '',
          product_id: businessData?.jtd?.selected_product?.product_id || '',
          mentioned_elder_name: mentionedName || '',
          access: accessSummary,
        });
        // 旅居：把上一轮快照里的城市/目的地写回 businessData，避免追问句不含地名时丢城市
        if (skillKey === 'travel_route' && businessData && typeof businessData === 'object') {
          const params = request.context?.action_params || request.params || {};
          const ctx = request.context || {};
          const lockedCity = firstNonEmpty(
            businessData.primary_city,
            businessData.destination,
            businessData.city,
            params.city,
            params.destination,
            ctx.previous_city,
            ctx.previous_destination,
          );
          if (lockedCity) {
            if (!businessData.primary_city) businessData.primary_city = lockedCity;
            if (!businessData.destination) businessData.destination = lockedCity;
            if (!businessData.city) businessData.city = lockedCity;
          }
        }
        // 城市预提取（仅 travel_route 场景，非天气 action）：无旅居信号且无锁定城市时跳过 LLM
        if (skillKey === 'travel_route' && !isWeatherAction) {
          try {
            const lockedCity = firstNonEmpty(
              businessData?.primary_city,
              businessData?.destination,
              businessData?.city,
            );
            const msg = request.message || sceneInput.text || '';
            if (!lockedCity && !hasTravelSignal(msg)) {
              mark('city_extract', '城市提取跳过', { reason: 'no_travel_signal' });
            } else {
              const cityHistory = request.history && request.history.length > 0
                ? request.history
                : (contextManager ? await injectHistory(request, contextManager, skillKey) : []);
              const cityResult = await extractCities({
                message: msg,
                business_data: businessData,
                conversation_history: cityHistory,
              });
              if (cityResult?.primary) {
                businessData.primary_city = cityResult.primary;
                businessData.cities = cityResult.cities;
                if (!businessData.destination) businessData.destination = cityResult.primary;
              }
              mark('city_extract', '城市提取', { primary: cityResult?.primary, cities: cityResult?.cities, source: cityResult?.source });
            }
          } catch (e) {
            mark('city_extract', '城市提取', { error: e.message });
          }
        }
        const availableTemplateIds = (skillTemplates.library || []).map(t => t.id);
        // 推断产品类型（康养/滨海/文化/生态）用于模板路由；优先 published 包命中
        let routeType = '';
        let publishHit = null;
        // 专用动作（天气/可订/预算等）不走线路包消歧，避免「查天气」被同分线路选项截胡
        const skipPublishMatch = Boolean(request.context?.action_key && [
          'travel_route.check_weather_risk',
          'travel_route.check_availability',
          'travel_route.calculate_budget',
        ].includes(request.context.action_key));
        if (skillKey === 'travel_route' && acceptedScene && !skipPublishMatch) {
          const forcedRouteId = String(request.context?.publish_route_id || request.context?.route_id || '').trim();
          let hits = matchPublishedPackages(sceneInput.text);
          // 举一反三：话语归属城市与包 destination 冲突时剔除（嘉路≠巴马）
          const text = String(sceneInput.text || '');
          hits = hits.filter((h) => {
            const dests = (h.meta?.destination || []).join('|');
            if (/嘉路|白浪滩|簕山|京族/.test(text) && /巴马|百魔洞/.test(dests) && !/巴马|百魔洞/.test(text)) return false;
            if (/巴马|百魔洞/.test(text) && /(北海|防城港|东兴)/.test(dests) && !/(北海|防城港|东兴|嘉路)/.test(text)) return false;
            return true;
          });
          if (forcedRouteId) {
            // 点选锁定：仅接受已 published 的包，拒绝客户端伪造 route_id
            const forced = getPublishedPackageById(forcedRouteId)
              || hits.find((h) => h.route_id === forcedRouteId);
            if (forced) {
              hits = [forced];
            } else {
              mark('publish_route_id_rejected', '拒绝未发布线路锁定', { forcedRouteId });
            }
          }
          const top = hits[0];
          const second = hits[1];
          if (top && (!second || top.score > second.score)) {
            publishHit = top;
            // 线路包只负责补业务数据（route_id/标题/目的地），**不覆写模板**：
            // LIS 已按意图下发 template_id 时它才是权威。
            //
            // 实测事故：「这条线路要多少钱」LIS 判定 travel_route_budget
            // -> travel_budget_card（置信 1.000），但文本同时匹配上一条已发布
            // 线路包，被 product_template_id 覆写成 route_compare_card
            // —— 用户问价格却看到线路对比卡。
            // 线路包的 product_template_id 表达的是"这条线路长什么样"，
            // 与"用户此刻想看什么"是两件事，后者由 LIS 意图决定。
            const lisTemplateId = request.template_id || request.templateId || '';
            // 方案B 回程：用户从消歧选项点回来时，前端回传 pending_template_id。
            // 此时话语可能只是线路标题（不含"多少钱"），LIS 无法再判出预算意图，
            // 所以必须用上一轮暂存的模板，否则消歧一轮就把原始诉求丢了。
            const pendingTemplateId = String(
              request.context?.pending_template_id || '',
            ).trim();
            const resolvedTemplateId = lisTemplateId || pendingTemplateId;
            const lisTemplateInSkill = resolvedTemplateId
              && availableTemplateIds.includes(resolvedTemplateId);
            if (!lisTemplateInSkill) {
              routeType = top.product_template_id || inferRouteType(sceneInput.text);
            } else {
              routeType = resolvedTemplateId;
              mark('publish_template_kept', '意图模板优先于线路包', {
                lis_template_id: lisTemplateId,
                pending_template_id: pendingTemplateId,
                publish_template_id: top.product_template_id || '',
              });
            }
            businessData.route_id = top.route_id;
            businessData.route_title = top.meta?.title || top.route_id;
            businessData.destination = Array.isArray(top.meta?.destination)
              ? (top.meta.destination[0] || businessData.destination)
              : (top.meta?.destination || businessData.destination);
            businessData.publish_match = {
              route_id: top.route_id,
              score: top.score,
              product_type: top.meta?.product_type,
              destination: top.meta?.destination || [],
              title: top.meta?.title || '',
            };
          } else if (top && second && top.score === second.score && !forcedRouteId) {
            // 第二刀同分：回传选线选项，避免静默落到错包
            //
            // 方案B：选项必须**携带本轮已识别的意图**。
            // 消歧只解决"哪条线路"，不该丢掉"用户想看什么"：
            // 「巴马这条线路要多少钱」LIS 已判定 travel_route_budget(1.000)，
            // 若选项只带 route_id，用户点完会退回默认线路卡，价格问题始终没答。
            // 带上 intent_id/template_id 后，下一轮 forcedRouteId 命中单条包，
            // 再由 LIS 模板优先分支出 travel_budget_card。
            const pendingIntentId = lisGateResult?.intent_id
              || acceptedScene?.intent
              || '';
            const pendingTemplateId = request.template_id || request.templateId || '';
            const routeOptions = hits.slice(0, 3).map((h) => ({
              scene_key: 'travel_route',
              skill_key: 'travel_route',
              route_id: h.route_id,
              icon: '🧳',
              label: h.meta?.title || h.route_id,
              desc: (h.meta?.destination || []).join('·') || h.product_template_id || '',
              confidence: h.score,
              // 前端点选时需原样回传这三个字段（见 handleChat 的 context 透传）
              pending_intent_id: pendingIntentId,
              pending_template_id: pendingTemplateId,
              user_prompt: sceneInput.text,
            }));
            mark('publish_ambiguous', '线路包消歧', {
              options: routeOptions.map((o) => o.route_id),
              pending_intent_id: pendingIntentId,
              pending_template_id: pendingTemplateId,
            });
            const ambAnswer = '找到多条相近旅居线路，请选择您想看的一条：';
            const ambEnvelope = buildEnvelope({
              request_id: request.request_id,
              conversation_id: request.conversation_id,
              turn_id: request.turn_id,
              skill_key: 'travel_route',
              agent_key: 'travel_route',
              intent: 'travel_route.publish_ambiguous',
              template_id: 'answer',
              template_key: 'answer',
              answer_text: ambAnswer,
              data: { publish_ambiguous: routeOptions },
              actions: [],
              followup_suggestions: [],
              evidence: [],
              route: {
                source: 'flatTalk.publish_index',
                scene_key: 'travel_route',
                decision: 'ambiguous',
                confidence: 0,
                routed: false,
                intent_context: intentContext,
              },
            });
            return {
              ...ambEnvelope,
              ambiguity_options: routeOptions,
              answer: ambAnswer,
              context_snapshot: buildSnapshot({ ...ambEnvelope, semantic: request.semantic || sceneInput.semantic }),
              stages,
              debug: { publish_ambiguous: true, option_count: routeOptions.length },
            };
          } else {
            routeType = inferRouteType(sceneInput.text);
            console.log('[publish-miss]', sceneInput.text?.slice?.(0, 80) || '');
          }
        }
        const routedTemplateId = selectRoutedTemplateId(acceptedScene, availableTemplateIds, routeType);
        // 天气风险动作：结合上下文城市，调用腾讯天气接口，由模型合成天气风险卡片
        const weatherActionCities = (skillKey === 'travel_route' && request.context?.action_key === 'travel_route.check_weather_risk')
          ? resolveWeatherCity(request, businessData)
          : [];
        let modelResult;
        const fallbackActionKey = request.context?.action_key
          && !SPECIAL_CASE_ACTION_KEYS.includes(request.context.action_key)
          ? request.context.action_key
          : null;
        const specialActionTemplateId = request.context?.action_key === 'travel_route.check_availability'
          ? 'travel_availability_card'
          : request.context?.action_key === 'travel_route.check_weather_risk'
          ? 'travel_weather_risk_card'
          : request.context?.action_key === 'travel_route.booking_handoff'
          ? 'travel_h5_embed_card'
          : request.context?.action_key === 'travel_route.calculate_budget'
          ? 'travel_budget_card'
          : '';
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
            resource || { action_key: fallbackActionKey, label: fallbackActionKey, target: 'flattalk', endpoint: '（未知资源）', params_schema: {}, param_sources: {} },
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
              conversation_history: await injectHistory(request, contextManager, skillKey),
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
              conversation_history: await injectHistory(request, contextManager, skillKey),
            });
          }
          mark('model', '按钮动作通用兜底', { action_key: fallbackActionKey, target: resource?.target, model: modelResult.model_used, status: modelResult.model_status });
        } else {
          modelResult = await modelService.fillTemplateSlots({
            message: sceneInput.text,
            skill_key: skillKey,
            intent_context: intentContext,
            template_id: request.template_id || request.templateId || specialActionTemplateId || routedTemplateId,
            default_template_id: skillTemplates.defaultTemplateId,
            template_library: skillTemplates.library,
            evidence: knowledge.matches,
            business_data: businessData,
            conversation_history: await injectHistory(request, contextManager, skillKey),
          });
          mark('model', '模板填充', { model: modelResult.model_used, status: modelResult.model_status, template_id: modelResult.template_id });
          modelResult = await applySmartFallback(modelResult, {
            message: sceneInput.text, skill_key: skillKey, conversation_id: request.conversation_id,
          }, smartFallbackHandler, contextManager);
        }
        const staticFollowups = loadStaticFollowups(skillKey, modelResult.template_id || routedTemplateId);
        const interactionScene = acceptedScene || sceneDecision;
        let interactions = composeInteractions({
          sceneDecision: interactionScene,
          modelResult,
          staticFollowups,
          // LIS 次意图（role=secondary 且 confidence>=0.6）转追问建议
          lisSuggestions: lisGateResult?.intent_suggestions || [],
        });
        if (contextBusOn && options.session) {
          const pending = readBus(options.session).turn?.pending_intents;
          if (Array.isArray(pending) && pending.length) {
            interactions = mergePendingIntoInteractions(interactions, pending);
            mark('pending_intents', '挂起意图追问', { count: pending.length });
          }
        }
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
          agent_key: skillKey,
          agent_switched: request.context?.agent_switched || false,
          agent_from: request.context?.agent_from || null,
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
          context_snapshot: buildSnapshot({ ...envelope, semantic: request.semantic || sceneInput.semantic }),
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
  // SOS 检测前置：无论是否有 intent override，都先扫描紧急关键词
  const { detectEmergency } = await import('../intent-classifier/emergency-detector.js');
  const emergency = detectEmergency({ text: sceneInput.text });
  if (emergency.matched && (emergency.intent_type === 'SOS' || emergency.urgency_level === 'P0')) {
    return { ...emergency, source: 'emergency_precheck' };
  }

  const requestIntent = sceneInput.intent || sceneInput.intent_context?.intent;
  if (requestIntent) {
    return { intent: requestIntent, source: 'request_override' };
  }
  if (options.intentClassifier) {
    return options.intentClassifier.classifyIntent(sceneInput, options.intentOptions ?? {});
  }
  return classifyIntent(sceneInput, options.intentOptions ?? {});
}

function normalizeSosModelResult(modelResult = {}, intentContext = {}) {
  const result = modelResult && typeof modelResult === 'object' ? modelResult : {};
  const keywords = Array.isArray(intentContext.keyword_match) && intentContext.keyword_match.length
    ? intentContext.keyword_match.join('、')
    : '紧急求助';
  const emergencyPhone = result.data?.emergency_phone || process.env.SOS_DEFAULT_PHONE || '';
  const emergencyName = result.data?.emergency_name || process.env.SOS_DEFAULT_NAME || '家属';
  const rawAnswerText = result.answer_text || result.answer || '';
  const defaultAnswerText = `检测到紧急情况（${keywords}），请立即拨打120或通知家属。`;
  const answerText = /120|急救|紧急|家属|救护车/.test(String(rawAnswerText))
    ? rawAnswerText
    : defaultAnswerText;
  return {
    ...result,
    template_id: 'service_emergency',
    template_key: 'service_emergency',
    answer_text: answerText,
    answer: answerText,
    data: {
      ...(result.data && typeof result.data === 'object' ? result.data : {}),
      matched_keywords: result.data?.matched_keywords || keywords,
      emergency_phone: emergencyPhone,
      emergency_name: emergencyName,
    },
    actions: normalizeSosActions(result.actions),
    followup_suggestions: normalizeSosFollowups(result.followup_suggestions),
    model_status: result.model_status || 'ok',
    model_used: result.model_used || 'deterministic_sos_guard',
  };
}

function normalizeSosActions(actions = []) {
  const normalized = Array.isArray(actions)
    ? actions.map((action) => ({
        ...action,
        action_key: action?.action_key || action?.key || '',
        label: action?.label || '',
      }))
    : [];
  const required = [
    { action_key: 'sos.call_120', label: '立即拨打120' },
    { action_key: 'sos.notify_family', label: '通知家属' },
  ];
  const seen = new Set();
  return [...normalized, ...required]
    .filter((action) => action.action_key && action.label)
    .filter((action) => {
      if (seen.has(action.action_key)) return false;
      seen.add(action.action_key);
      return true;
    });
}

function normalizeSosFollowups(followups = []) {
  const normalized = Array.isArray(followups)
    ? followups.map((followup) => ({
        ...followup,
        action_key: followup?.action_key || followup?.key || '',
        label: followup?.label || '',
        user_prompt: followup?.user_prompt || followup?.prompt || followup?.label || '',
      }))
    : [];
  const required = [
    { action_key: 'sos.call_120', label: '拨打120', user_prompt: '紧急情况，需要拨打120' },
    { action_key: 'sos.notify_family', label: '通知家属', user_prompt: '紧急情况，需要通知家属' },
  ];
  const seen = new Set();
  return [...normalized, ...required]
    .filter((followup) => followup.action_key && followup.label && followup.user_prompt)
    .filter((followup) => {
      if (seen.has(followup.action_key)) return false;
      seen.add(followup.action_key);
      return true;
    });
}

function normalizeRequest(request) {
  return {
    ...request,
    text: request.message || request.text || request.query || '',
    intent: request.intent || request.intent_context?.intent || '',
  };
}

async function injectHistory(request, contextManager, skillKey) {
  // ★ 优先使用前端传来的对话历史（最完整、跨场景不丢）
  // 同 skill-key 优先取最近 5 轮（约 10 条消息）；无 skill 标记则取最近 5 轮全局
  const clientHistory = Array.isArray(request.history) ? request.history : [];
  if (clientHistory.length > 0) {
    const normalized = clientHistory
      .filter((m) => m && (m.role || m.type) && String(m.content || m.message || m.text || '').trim())
      .map((m) => ({
        role: (m.role === 'user' || m.type === 'user') ? 'user' : 'assistant',
        content: String(m.content || m.message || m.text || '').trim(),
        skill_key: m.skill_key || m.meta?.skill_key || '',
      }));
    const sameSkill = skillKey
      ? normalized.filter((m) => !m.skill_key || m.skill_key === skillKey || m.skill_key === 'common')
      : normalized;
    const pool = sameSkill.length ? sameSkill : normalized;
    return pool.slice(-10).map(({ role, content }) => ({ role, content }));
  }
  // 回退到后端 sessionStore
  if (!contextManager || !request.conversation_id) return [];
  try {
    let history = await contextManager.buildHistory(request.conversation_id, skillKey);
    // ★ 指定 skillKey 下没有历史时，fallback 取全局历史（跨场景追问不脱节）
    if (history.length === 0 && skillKey !== 'common') {
      history = await contextManager.buildHistory(request.conversation_id, 'common');
    }
    return history.slice(-10);
  } catch { return []; }
}

async function applySmartFallback(modelResult, input, smartFallbackHandler, contextManager) {
  if (!smartFallbackHandler) return modelResult;
  const msg = input.message || '';
  const tpl = modelResult?.template_id || '';
  // 闲聊却出了业务卡：强制走 answer
  const mismatchChitchat = isWeakOrChitchatUtterance(msg)
    && tpl
    && tpl !== 'answer'
    && !String(tpl).startsWith('assistant');
  if (!mismatchChitchat && !smartFallbackHandler.shouldFallback(modelResult)) return modelResult;
  let history = [];
  if (contextManager && input.conversation_id) {
    try { history = await contextManager.buildHistory(input.conversation_id, input.skill_key); } catch {}
  }
  const fallback = await smartFallbackHandler.generateNaturalAnswer({
    message: msg,
    skill_key: mismatchChitchat ? 'common' : (input.skill_key || 'common'),
    conversation_history: history,
  });
  // 闲聊错配：直接用 answer，不要保留错误业务卡数据
  if (mismatchChitchat && fallback) {
    return {
      ...fallback,
      template_id: 'answer',
      template_key: 'answer',
      model_used: fallback.model_used || 'smart_fallback',
      model_status: 'smart_fallback_chitchat',
      template_fit_notes: [...(modelResult?.template_fit_notes || []), 'chitchat_mismatch_forced_answer'],
    };
  }
  // ★ 如果原始 modelResult 有完整模板数据（如 nearby 地图 markers），只借用 fallback 的 answer 文本，
  //   保留原始 data/template_id，避免数据丢失导致地图/卡片空白
  if (fallback?.template_id === 'answer' && modelResult?.template_id && modelResult.template_id !== 'answer' && modelResult.data) {
    return {
      ...fallback,
      template_id: modelResult.template_id,
      template_key: modelResult.template_key || modelResult.template_id,
      data: modelResult.data,               // ★ 保留 fillNearbyResourceCard 等生成的完整数据
      model_used: fallback.model_used || 'smart_fallback',
      model_status: 'smart_fallback',
    };
  }
  return fallback;
}

async function acceptScene(request, sceneDecision) {
  const ambiguityPick = request.context?.ambiguity_pick === true
    || request.context?.ambiguity_pick === 'true';
  const ambiguityScene = normalizeForcedSkillKey(
    request.context?.ambiguity_scene_key || (ambiguityPick ? request.skill_key : '')
  );
  if (ambiguityPick && ambiguityScene) {
    logSceneDecision({
      utterance: request.message || request.text || '',
      candidates: sceneDecision?.candidates || [],
      margin: sceneDecision?.margin,
      transition_type: 'ambiguity_pick',
      ambiguity: true,
      final_scene: ambiguityScene,
      conflict_notes: ['ambiguity_pick'],
      disambiguation_result: ambiguityScene,
    });
    return {
      scene_key: ambiguityScene,
      intent: request.intent || `${ambiguityScene}.ambiguity_pick`,
      decision: 'accept',
      confidence: 1,
      routed: true,
      forced: true,
      ambiguity_pick: true,
    };
  }

  const forcedSceneKey = normalizeForcedSkillKey(request.skill_key || request.skillKey);
  if (forcedSceneKey) {
    // ★ 关键词快速匹配：nearby_resource 是纯模板型技能（无需 LLM），
    //   当用户在"周边助手"模式下输入周边/附近/配套/地图等关键词时，
    //   跳过 supervisor 守卫，避免被 LLM 路由器误判为 common
    if (forcedSceneKey === 'nearby_resource') {
      const msg = String(request.message || request.text || '');
      if (/周边|附近|配套|地图|生活圈|资源|嘉路|康养|多少公里|医院|餐厅|住宿|景点|民宿|超市|购物|医疗|卫生|药店|银行|交通|公交|在哪|哪里|分布|大屏|nearby|around|map/i.test(msg)) {
        return {
          scene_key: forcedSceneKey,
          intent: request.intent || `${forcedSceneKey}.forced`,
          decision: 'accept',
          confidence: 1,
          routed: true,
          forced: true,
        };
      }
    }
    // Guard: check if user input actually matches the forced skill
    try {
      const route = await _supervisorForGuard.route({
        message: request.message || request.text || '',
        context: { active_agent: forcedSceneKey },
      });
      // If supervisor routes to same agent, or doesn't switch away — keep forced
      if (route.agentKey === forcedSceneKey || !route.switched) {
        return {
          scene_key: forcedSceneKey,
          intent: request.intent || intentFromScene(sceneDecision, forcedSceneKey) || `${forcedSceneKey}.forced`,
          decision: 'accept',
          confidence: 1,
          routed: true,
          forced: true,
        };
      }
      // Supervisor routed to a different agent — trust the supervisor's match
      const guardKey = normalizeForcedSkillKey(route.agentKey);
      if (guardKey) {
        return {
          scene_key: guardKey,
          intent: request.intent || intentFromScene(sceneDecision, guardKey) || `${guardKey}.guard`,
          decision: 'accept',
          confidence: 1,
          routed: true,
          guarded: true,
        };
      }
      // guardKey invalid — fall through to normal routing
    } catch {
      // If guard fails, keep forced as fallback
      return {
        scene_key: forcedSceneKey,
        intent: request.intent || intentFromScene(sceneDecision, forcedSceneKey) || `${forcedSceneKey}.forced`,
        decision: 'accept',
        confidence: 1,
        routed: true,
        forced: true,
      };
    }
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

  // ★ SceneTransitionManager：仅处理 AMBIGUOUS（消歧）和 CONTINUE（延续词）
  // ROUTE/FALLBACK 回退到原有逻辑，避免过度干预
  const candidates = sceneDecision?.candidates || [];
  const transition = decideTransition(candidates, {
    previous_scene: request.previous_scene || request.context?.previous_scene,
    message: request.message || request.text || '',
  });

  logSceneDecision({
    utterance: request.message || request.text || '',
    candidates: sceneDecision?.candidates || [],
    margin: sceneDecision?.margin,
    transition_type: transition?.type,
    ambiguity: transition?.type === TRANSITION_TYPE.AMBIGUOUS,
    final_scene: transition?.type === TRANSITION_TYPE.AMBIGUOUS
      ? null
      : (transition?.scene?.scene_key || sceneDecision?.scene_key || null),
  });

  // AMBIGUOUS：消歧追问
  if (transition.type === TRANSITION_TYPE.AMBIGUOUS) {
    return resolveAmbiguity(transition.candidates, request);
  }

  // CONTINUE：延续旧场景（含延续词）
  if (transition.type === TRANSITION_TYPE.CONTINUE) {
    return transition.scene;
  }

  // 原有逻辑：accept/review→路由，否则 null→answer
  if (sceneDecision?.decision === 'accept') return sceneDecision;
  if (sceneDecision?.decision === 'review' && sceneDecision?.confidence >= 0.55) return sceneDecision;
  return null;
}

/**
 * 追问场景的轻量意图解析：用 user_prompt 走一次 LIS，返回**差异化**模板。
 *
 * 为什么追问也要跑意图识别：
 *   action_key 是粗粒度动作标识，一个 key 常服务多个语义。实测冲突：
 *     meal_plan.adjust_for_condition  <- 「按健康状况调整」/「换成软烂版」
 *     travel_route.calculate_budget   <- 「测算费用」/「按经济型重新规划」
 *   这些差异只存在于 user_prompt 里，丢掉它就必然多意图共用一张卡。
 *
 * 为什么要与上一轮模板对比：
 *   追问句常与当前卡同域（如在早餐卡上问"换成软烂版"），LIS 可能仍判回
 *   同一个意图。此时返回同模板等于"点了按钮但卡没变"，体验上是失败的。
 *   只有识别出**不同**模板才采纳；相同则返回空，让调用方回落 action_key 推导。
 *
 * 失败不抛错：追问是增强路径，LIS 不可达时应静默回落，不能阻断出卡。
 */
async function resolveFollowupIntent({
  text,
  skillKey,
  lisClient,
  catalogEntries = [],
  availableIds = [],
  prevTemplateId = '',
} = {}) {
  const empty = { intent_id: '', template_id: '' };
  if (!lisClient || typeof lisClient.sort !== 'function' || !text) return empty;

  // 只送本技能的意图，避免追问被跨技能候选带偏
  const scoped = catalogEntries.filter(
    (e) => (e.entry?.skill_key || e.entry?.domain || '') === skillKey && e.enabled !== false,
  );
  const intentIds = scoped.map((e) => e.intent_id);
  if (!intentIds.length) return empty;

  const supply = await lisClient.sort({
    utterance: text,
    catalog_intent_ids: intentIds,
  });
  const top = (supply?.intents || [])[0];
  if (!top?.intent_id) return empty;

  const hit = scoped.find((e) => e.intent_id === top.intent_id);
  const templateId = hit?.entry?.template_id || '';
  if (!templateId) return empty;
  // 模板必须在该技能实际存在
  if (availableIds.length && !availableIds.includes(templateId)) return empty;
  // 与上一轮相同 → 视为无差异，交回上层用 action_key 推导
  if (prevTemplateId && templateId === prevTemplateId) {
    return { intent_id: top.intent_id, template_id: '' };
  }
  return { intent_id: top.intent_id, template_id: templateId };
}

function intentFromScene(sceneDecision = {}, sceneKey = '') {
  return sceneDecision?.scene_key === sceneKey && sceneDecision?.decision !== 'reject'
    ? sceneDecision.intent
    : '';
}

/**
 * 由意图解析模板 ID。
 *
 * 权威源是 config/intent-catalog.json（intent_id → entry.template_id，强制 1:1），
 * 与 LIS IntentKB 同源：LIS 命中时直接下发 template_id（见 lisGateResult 分支），
 * 此函数只在 LIS 未命中、走 scene-router 降级时使用，保证两条路径拿到同一张卡。
 *
 * 原先此处查 intent-template-map.js，那是**第二份**映射表（87 键）：
 * 与 catalog 分属两个文件、无统一事务，改一处漏一处就会静默断链；
 * 且它同一模板被多个意图共用，违反 1:1。现已删除该文件。
 */
function resolveTemplateIdFromCatalog(intent, availableIds = []) {
  if (!intent) return '';
  const entries = loadCatalogEntries();
  const hit = entries.find((e) => e.intent_id === intent);
  const templateId = hit?.entry?.template_id || '';
  if (!templateId) return '';
  // availableIds 为该技能实际存在的模板；为空表示调用方未做限制
  if (availableIds.length && !availableIds.includes(templateId)) return '';
  return templateId;
}

/**
 * travel_route 的 route_type 模板升级。
 *
 * 语义与原 resolveTemplateWithRouteType 一致：仅当基础模板为 route_svg 时，
 * 才把它升级为具体产品模板（康养/滨海/文化/生态），且该模板必须真实存在。
 */
const ROUTE_TYPE_TEMPLATES = Object.freeze([
  'route_wellness',
  'route_coastal',
  'route_culture',
  'route_ecology',
]);

function resolveRouteTypeTemplate(intent, availableIds = [], routeType = '') {
  const baseTemplateId = resolveTemplateIdFromCatalog(intent, availableIds);
  if (baseTemplateId !== 'route_svg' || !routeType) return baseTemplateId;
  if (ROUTE_TYPE_TEMPLATES.includes(routeType) && availableIds.includes(routeType)) {
    return routeType;
  }
  return baseTemplateId;
}

function selectRoutedTemplateId(sceneDecision, availableIds = [], routeType = '') {
  if (!sceneDecision || sceneDecision.decision !== 'accept') return '';

  const sceneKey = sceneDecision.scene_key;
  const intent = sceneDecision.intent || '';

  // travel_route 场景：带 route_type 的模板路由（康养/滨海/文化/生态 → 对应产品模板）
  if (sceneKey === 'travel_route' && routeType) {
    const productTemplateId = resolveRouteTypeTemplate(intent, availableIds, routeType);
    if (productTemplateId) return productTemplateId;
  }

  return resolveTemplateIdFromCatalog(intent, availableIds);
}

async function retrieveKnowledge(ragService, request) {
  // 各技能统一走「本地知识库优先」检索（retriever 内部已实现：本地命中在前，远程仅作补充）
  if (typeof ragService.retrieveKnowledge === 'function') {
    return ragService.retrieveKnowledge(request);
  }
  if (request?.skill_key === 'meal_plan' && typeof ragService.retrieveMealPlanKnowledge === 'function') {
    return ragService.retrieveMealPlanKnowledge(request);
  }
  return { source: 'knowledge_unavailable', status: 'not_configured', matches: [] };
}

async function retrieveMultiKnowledgeWithTimeout(ragService, args = {}) {
  const timeoutMs = Math.max(
    1500,
    Number(process.env.FLATTALK_KB_HARD_TIMEOUT_MS || process.env.FLATTALK_KB_TIMEOUT_MS || 8000),
  );
  let timer;
  try {
    const result = await Promise.race([
      retrieveMultiKnowledge(ragService, args),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('kb_hard_timeout'), { code: 'kb_hard_timeout' })), timeoutMs);
      }),
    ]);
    return result;
  } catch (err) {
    return {
      source: 'timeout',
      status: 'timeout',
      local_status: 'skipped',
      local_count: 0,
      remote_status: 'timeout',
      remote_count: 0,
      remote_error: err?.message || 'kb_hard_timeout',
      matches: [],
      timed_out: true,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function retrieveMultiKnowledge(ragService, { skill_keys = [], query, limit = 3, filters = {} } = {}) {
  const remoteOnly = String(process.env.FLATTALK_KB_REMOTE_ONLY || '').trim() === '1';
  // 多技能合并：REMOTE_ONLY 时只认远程；否则本地排前、远程补后
  const allMatches = [];
  let remoteStatus = 'disabled';
  let remoteError = null;
  let sourceHint = remoteOnly ? 'remote_knowledge' : 'local_first';
  for (const skill_key of skill_keys) {
    const r = await retrieveKnowledge(ragService, { skill_key, query, limit, filters });
    if (r && Array.isArray(r.matches)) allMatches.push(...r.matches);
    if (r) {
      if (r.source) sourceHint = r.source;
      const rs = r.remote_status || (r.source === 'remote_knowledge' || r.origin === 'remote' ? 'remote_hit' : 'disabled');
      if (rs === 'remote_error' || rs === 'remote_failed') remoteStatus = 'remote_error';
      else if (rs !== 'disabled' && remoteStatus !== 'remote_error') remoteStatus = rs;
      if (r.remote_error && !remoteError) remoteError = r.remote_error;
      if (r.local_status === 'local_disabled' && remoteOnly) {
        // keep
      }
    }
  }
  const seen = new Set();
  const local = [];
  const remote = [];
  for (const m of allMatches) {
    const key = String(m.content || m.text || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isRemote = m.origin === 'remote' || remoteOnly;
    (isRemote ? remote : local).push({ ...m, origin: isRemote ? 'remote' : (m.origin || 'local') });
  }
  const byScore = (a, b) => (b.score || 0) - (a.score || 0);
  const merged = remoteOnly
    ? remote.sort(byScore).slice(0, Math.max(1, Number(limit) || 3))
    : [...local.sort(byScore), ...remote.sort(byScore)].slice(0, Math.max(1, Number(limit) || 3));
  const localCount = remoteOnly ? 0 : local.length;
  const remoteCount = remote.length;
  let status;
  if (remoteOnly) {
    if (remoteCount) status = 'remote_hit';
    else if (remoteStatus === 'remote_error') status = 'remote_error';
    else status = 'remote_empty';
  } else if (localCount) status = 'local_hit';
  else if (remoteCount) status = 'remote_hit';
  else if (remoteStatus === 'remote_error') status = 'remote_error';
  else status = 'empty';
  return {
    source: remoteOnly ? (sourceHint || 'remote_knowledge') : 'local_first',
    status,
    local_status: remoteOnly ? 'local_disabled' : (localCount ? 'local_hit' : 'local_empty'),
    local_count: localCount,
    remote_status: remoteStatus === 'disabled' && remoteCount ? 'remote_hit' : remoteStatus,
    remote_count: remoteCount,
    remote_error: remoteError,
    matches: merged,
  };
}

// ★ 公共函数：根据请求中的 elder_id / userToken 解析当前登录用户关联的老人档案
//   所有需要身份数据的技能都应调用此函数，不使用 mock 默认值
function normalizeFindServiceOrders(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((o) => ({
      order_id: o.order_id || o.orderId || o.order_no || o.orderNo || '',
      elder_name: o.elder_name || o.elderName || '',
      elder_id: o.elder_id || o.elderId || '',
      service_name: o.service_name || o.serviceName || o.service_item_name || '',
      service_id: o.service_id || o.serviceItemId || '',
      org_name: o.org_name || o.orgName || '',
      org_id: o.org_id || o.orgId || '',
      status: o.status || o.order_status || o.orderStatus || o.order_status_name || '',
      expected_time: o.expected_time || o.reserve_date || o.reserveDate || o.expectedTime || '',
      time_slot: o.time_slot || o.reserve_time || o.reserveTime || '',
    })).filter((o) => o.order_id || o.service_name);
  }
  if (Array.isArray(raw.records)) return normalizeFindServiceOrders(raw.records);
  if (Array.isArray(raw.list)) return normalizeFindServiceOrders(raw.list);
  if (raw.order_id || raw.orderId || raw.order_no) return normalizeFindServiceOrders([raw]);
  return [];
}

function resolveElderProfile(request) {
  const actionParams = request.context?.action_params || request.params || {};
  const elderId = actionParams.elder_id || request.elder_id || request.context?.elder_id || request.elderScope || '';
  const userToken = request.user_token || request.context?.user_token || '';
  let elderProfile = null;
  if (isMockEldersAllowed()) {
    if (elderId) {
      elderProfile = mockElders.find((e) => e.elder_id === elderId) || null;
    }
    if (!elderProfile && userToken) {
      const user = getMockUserByToken(userToken);
      if (user?.elder_scope) {
        elderProfile = mockElders.find((e) => e.elder_id === user.elder_scope) || null;
      }
    }
  }
  return {
    elder_id: elderProfile?.elder_id || elderId || '',
    elder_name: elderProfile?.elder_name || actionParams.elder_name || '',
    elder_age: elderProfile?.age || '',
    elder_sex: elderProfile?.gender || elderProfile?.elder_sex || '',
    community_name: elderProfile?.community_name || '',
    address_label: elderProfile?.address_label || '',
    care_level: elderProfile?.care_level || '',
    ability_status: elderProfile?.ability_status || '',
    profile_source: elderProfile ? 'mock_elder' : (elderId || actionParams.elder_name ? 'request_params' : 'empty'),
  };
}

async function loadBusinessData({ sceneDecision, request, dataService, mark } = {}) {
  if (sceneDecision?.decision !== 'accept') return {};
  const tracer = createDataAccessTracer(mark);
  const skill = sceneDecision?.scene_key || '';

  const withAccess = (payload) => {
    if (!payload || typeof payload !== 'object') return payload;
    return { ...payload, _access: tracer.summary() };
  };

  const accessMeta = (r = {}) => ({
    method: r.method,
    url: r.url,
    sql: r.sql,
    http_status: r.http_status,
    provider: r.provider,
  });

  if (skill === 'meal_plan') {
    const tableData = await tracer.span({
      kind: 'db',
      name: 'elder_profile+meal_rules+diet_contraindications',
      meta: { skill, tables: ['elder_profile', 'meal_rules', 'diet_contraindications'] },
      run: () => dataService.tableData.getMealPlanTables({
        elder_id: request.elder_id || request.context?.elder_id || 'demo_elder_1',
      }),
    });
    return withAccess(tableData || { source: 'error' });
  }

  if (skill === 'travel_route' && typeof dataService.tableData.getTravelRouteTables === 'function') {
    const tableData = await tracer.span({
      kind: 'db',
      name: 'gxy_travel_route_plan',
      meta: { skill },
      run: () => dataService.tableData.getTravelRouteTables(),
    }) || {};
    const jtd = await tracer.span({
      kind: 'http',
      name: 'jintiaodong.buildRouteProductContext',
      meta: { skill, integration: 'jintiaodong', provider: 'jintiaodong' },
      run: async () => {
        if (typeof dataService.travelData?.jtd?.buildRouteProductContext !== 'function') {
          recordKeepOk('jtd_skipped', 'jtd_service_not_configured');
          return {
            provider: 'jintiaodong',
            required: true,
            source_status: 'unavailable',
            products: [],
            selected_product: null,
            warnings: ['jtd_service_not_configured'],
            skipped: true,
            skip_reason: 'jtd_service_not_configured',
          };
        }
        return dataService.travelData.jtd.buildRouteProductContext(request);
      },
    });
    const elder = resolveElderProfile(request);
    const actionParams = request.context?.action_params || request.params || {};
    return withAccess({
      ...tableData,
      jtd,
      ...elder,
      role_key: request.role || request.roleKey || request.context?.role_key || '',
      auth_level: request.authLevel || request.auth_level || request.context?.auth_level || '',
      user_name: request.userName || request.user_name || request.context?.user_name || '',
      org_name: request.orgName || request.org_name || request.context?.org_name || '',
      terminal: request.terminal || request.context?.terminal || '',
      channel: request.channel || request.context?.channel || 'mobile',
      user_token: request.user_token || request.userToken || '',
      action_params: actionParams,
      destination: firstNonEmpty(
        actionParams.destination,
        actionParams.city,
        request.context?.previous_destination,
        request.context?.previous_city,
        jtd?.selected_product?.destination,
        jtd?.selected_product?.city,
      ),
      primary_city: firstNonEmpty(
        actionParams.city,
        actionParams.destination,
        request.context?.previous_city,
        request.context?.previous_destination,
        jtd?.selected_product?.city,
        jtd?.selected_product?.destination,
      ),
    });
  }

  if (skill === 'health_risk_warning' && typeof dataService.tableData.getHealthRiskWarningTables === 'function') {
    const tableData = await tracer.span({
      kind: 'db',
      name: 'health_risk_warning_business',
      meta: { skill },
      run: () => dataService.tableData.getHealthRiskWarningTables(),
    }) || {};
    const remote = await tracer.span({
      kind: 'http',
      name: 'yunzhen365.buildRiskRemoteContext',
      meta: { skill, integration: 'yunzhen365' },
      run: async () => {
        if (typeof dataService.remoteHealth?.buildRiskRemoteContext !== 'function') {
          return {
            provider: 'yunzhen365',
            required: false,
            source_status: 'unavailable',
            metrics: [],
            warnings: ['remote_health_service_not_configured'],
            skipped: true,
            skip_reason: 'remote_health_service_not_configured',
          };
        }
        return dataService.remoteHealth.buildRiskRemoteContext(request);
      },
    });
    return withAccess({
      ...tableData,
      remote,
      ...resolveElderProfile(request),
    });
  }

  if (skill === 'find_service' && typeof dataService.tableData.getFindServiceTables === 'function') {
    const params = { ...(request.context?.action_params || request.params || {}) };
    params.elderId = params.elderId || request.elder_id || request.context?.elder_id || '';
    params.orgId = params.orgId || request.org_id || request.context?.org_id || '';
    params.action = request.context?.action_key || params.action || '';
    params.intent = sceneDecision?.intent || params.intent || '';
    const tableData = await tracer.span({
      kind: 'db',
      name: 'fs_catalog+org+worker+order',
      meta: { skill, via: 'assembleFindServiceData' },
      run: () => dataService.tableData.getFindServiceTables(params),
    }) || {};

    let orders = Array.isArray(tableData.orders) ? tableData.orders : [];
    let orders_meta = { source: tableData.source || 'flatTalk_table_data' };
    const orderRes = await tracer.span({
      kind: 'tag_system',
      name: params.orderId ? 'getServiceOrder' : 'listServiceOrders',
      meta: { skill, elderId: params.elderId || '', orderId: params.orderId || '' },
      run: async () => {
        const orderSvc = createOrderService();
        if (params.orderId) return orderSvc.getOrderDetail(params.orderId);
        if (!params.elderId) return { ok: false, skipped: true, source: 'skipped', error: 'no_elder_id', skip_reason: 'no_elder_id' };
        return orderSvc.getOrderPage(params);
      },
    });
    try {
      if (orderRes?.ok) {
        const normalized = normalizeFindServiceOrders(orderRes.data);
        if (normalized.length) {
          orders = normalized;
          orders_meta = { source: orderRes.source_status || 'real_data', ok: true };
        } else {
          orders_meta = { source: orderRes.source_status || 'real_data', ok: true, empty: true };
        }
      } else if (orderRes?.skipped) {
        orders_meta = { source: 'skipped', ok: false, error: orderRes.error };
      }
    } catch (err) {
      orders_meta = { source: 'error', error: err.message };
    }

    const qualityEvaluation = await tracer.span({
      kind: 'tag_system',
      name: 'getEvaluationRecords',
      meta: { skill },
      run: async () => {
        try {
          const q = await dataService.quality.getEvaluation({ elderId: params.elderId, orgId: params.orgId, limit: 50 });
          if (q.ok) return { source: q.source, rowCount: q.rowCount, rows: q.data, ok: true, ...accessMeta(q) };
          return { source: 'unavailable', ok: false, ...accessMeta(q) };
        } catch (e) {
          return { source: 'error', error: e && e.message, ok: false };
        }
      },
    });

    const feedbackMetrics = await tracer.span({
      kind: 'tag_system',
      name: 'getFeedbackMetrics',
      meta: { skill },
      run: async () => {
        try {
          const f = await dataService.quality.getFeedbackMetrics({ orgId: params.orgId, userId: params.elderId, limit: 50 });
          if (f.ok) return { source: f.source, metrics: f.metrics, samples: f.samples, ok: true, ...accessMeta(f) };
          return { source: 'unavailable', ok: false, ...accessMeta(f) };
        } catch (e) {
          return { source: 'error', error: e && e.message, ok: false };
        }
      },
    });

    return withAccess({
      ...tableData,
      orders,
      orders_meta,
      quality_evaluation: qualityEvaluation || { source: 'unavailable' },
      feedback_metrics: feedbackMetrics || { source: 'unavailable' },
      ...resolveElderProfile(request),
    });
  }

  if (skill === 'dispatch_manage' && typeof dataService.tableData.getDispatchManageTables === 'function') {
    const tableData = await tracer.span({
      kind: 'db',
      name: 'dm_dispatch_order',
      meta: { skill, via: 'assembleDispatchData' },
      run: () => dataService.tableData.getDispatchManageTables(),
    }) || {};
    const params = { ...(request.context?.action_params || request.params || {}) };
    params.elderId = params.elderId || request.elder_id || request.context?.elder_id;
    params.orgId = params.orgId || request.org_id || request.context?.org_id;

    const workorders = await tracer.span({
      kind: 'tag_system',
      name: params.workOrderId ? 'getWorkOrder' : 'listWorkOrders',
      meta: { skill },
      run: async () => {
        try {
          const wSvc = createWorkorderService();
          const res = params.workOrderId
            ? await wSvc.getWorkorderDetail(params.workOrderId)
            : await wSvc.getWorkorderPage(params);
          if (res?.ok) return { ok: true, source_status: res.source_status || 'real_data', data: res.data };
          return { ok: false, source: 'unavailable' };
        } catch (err) {
          return { ok: false, source: 'error', error: err.message };
        }
      },
    });

    const qualityEvaluation = await tracer.span({
      kind: 'tag_system',
      name: 'getEvaluationRecords',
      meta: { skill },
      run: async () => {
        try {
          const q = await dataService.quality.getEvaluation({ elderId: params.elderId, orgId: params.orgId, limit: 50 });
          if (q.ok) return { source: q.source, rowCount: q.rowCount, rows: q.data, ok: true, ...accessMeta(q) };
          return { source: 'unavailable', ok: false, ...accessMeta(q) };
        } catch (e) {
          return { source: 'error', error: e && e.message, ok: false };
        }
      },
    });

    const feedbackMetrics = await tracer.span({
      kind: 'tag_system',
      name: 'getFeedbackMetrics',
      meta: { skill },
      run: async () => {
        try {
          const f = await dataService.quality.getFeedbackMetrics({ orgId: params.orgId, userId: params.elderId, limit: 50 });
          if (f.ok) return { source: f.source, metrics: f.metrics, samples: f.samples, ok: true, ...accessMeta(f) };
          return { source: 'unavailable', ok: false, ...accessMeta(f) };
        } catch (e) {
          return { source: 'error', error: e && e.message, ok: false };
        }
      },
    });

    return withAccess({
      ...tableData,
      workorders,
      quality_evaluation: qualityEvaluation || { source: 'unavailable' },
      feedback_metrics: feedbackMetrics || { source: 'unavailable' },
      ...resolveElderProfile(request),
    });
  }

  if (skill === 'service_quality_eval') {
    const params = { ...(request.context?.action_params || request.params || {}) };
    params.elderId = params.elderId || request.elder_id || request.context?.elder_id;
    params.orgId = params.orgId || request.org_id || request.context?.org_id;
    params.staffId = params.staffId || request.staff_id || request.context?.staff_id;

    const qualityEvaluation = await tracer.span({
      kind: 'tag_system',
      name: 'getEvaluationRecords',
      meta: { skill },
      run: async () => {
        try {
          const q = await dataService.quality.getEvaluation({
            elderId: params.elderId,
            orgId: params.orgId,
            staffId: params.staffId,
            orderId: params.orderId,
            limit: 100,
          });
          if (q.ok) return { source: q.source, rowCount: q.rowCount, rows: q.data, degradeNote: q.degradeNote, ok: true, ...accessMeta(q) };
          return { source: 'unavailable', rows: [], rowCount: 0, ok: false, ...accessMeta(q) };
        } catch (e) {
          return { source: 'error', rows: [], rowCount: 0, error: e && e.message, ok: false };
        }
      },
    });

    const feedbackMetrics = await tracer.span({
      kind: 'tag_system',
      name: 'getFeedbackMetrics',
      meta: { skill },
      run: async () => {
        try {
          const f = await dataService.quality.getFeedbackMetrics({
            orgId: params.orgId,
            staffId: params.staffId,
            userId: params.elderId,
            limit: 100,
          });
          if (f.ok) return { source: f.source, metrics: f.metrics, samples: f.samples, degradeNote: f.degradeNote, ok: true, ...accessMeta(f) };
          return { source: 'unavailable', metrics: {}, samples: [], ok: false, ...accessMeta(f) };
        } catch (e) {
          return { source: 'error', metrics: {}, samples: [], error: e && e.message, ok: false };
        }
      },
    });

    return withAccess({
      source: 'flatTalk_quality_data',
      params,
      quality_evaluation: qualityEvaluation || { source: 'unavailable', rows: [], rowCount: 0 },
      feedback_metrics: feedbackMetrics || { source: 'unavailable', metrics: {}, samples: [] },
      ...resolveElderProfile(request),
    });
  }

  // fall through to remaining scene handlers below (nearby etc.) without tracer if unchanged
  return loadBusinessDataLegacyTail({ sceneDecision, request, dataService, tracer, withAccess });
}

/** Preserve nearby_resource and other scene tails with data-access spans */
async function loadBusinessDataLegacyTail({ sceneDecision, request, dataService, tracer, withAccess }) {
  void dataService;
  if (sceneDecision?.scene_key === 'nearby_resource') {
    const userMessage = request.message || request.text || '';
    const intent = request.context?.intent || request.context?.action_key || 'all';

    const cityResult = tryExtractNonJialuCity(userMessage);
    if (cityResult) {
      const poiResult = await tracer.span({
        kind: 'http',
        name: 'tencent_map.searchPoisForCity',
        meta: { skill: 'nearby_resource', integration: 'tencent_map', city: cityResult.city },
        run: async () => {
          try {
            return await searchPoisForCity(cityResult.city, cityResult.category || intent, cityResult.coord);
          } catch (err) {
            return { ok: false, source: 'error', error: err.message, facilities: [] };
          }
        },
      });
      if (poiResult && poiResult.facilities?.length > 0) {
        return withAccess({
          jialu_facilities: poiResult.facilities,
          jialu_center: poiResult.center,
          _is_default_location: false,
          _data_source: 'tencent_map_poi',
          _enrich_stats: null,
        });
      }
    }

    const facilities = getJialuFacilities({ type: '', maxDistance: 0, limit: 0 });
    const requestLocation = request.context?.location || request.location;
    const isDefaultLocation = !requestLocation || requestLocation.source === 'default';
    const namedLocalCenter = /嘉路|防城港|东兴|港口区|江山镇/.test(String(userMessage || ''));
    const center = (namedLocalCenter)
      ? getJialuCenter()
      : ((requestLocation && typeof requestLocation.lat === 'number' && !isDefaultLocation)
        ? { lat: requestLocation.lat, lng: requestLocation.lng, name: requestLocation.city ? requestLocation.city + '·您的位置' : '您的位置' }
        : getJialuCenter());
    const resolvedDefaultLocation = namedLocalCenter ? false : isDefaultLocation;

    let enrichedFacilities = facilities;
    let enrichStats = null;
    const enrichResult = await tracer.span({
      kind: 'http',
      name: 'nearbyEnrich(tencent_map+tavily)',
      meta: { skill: 'nearby_resource', integration: 'tencent_map' },
      run: async () => {
        try {
          return await nearbyEnrich(facilities, center, intent);
        } catch (err) {
          return { facilities, stats: null, source: 'error', error: err.message, ok: false };
        }
      },
    });
    if (enrichResult?.facilities) {
      enrichedFacilities = enrichResult.facilities;
      enrichStats = enrichResult.stats;
    }

    return withAccess({
      jialu_facilities: enrichedFacilities,
      jialu_center: center,
      _is_default_location: resolvedDefaultLocation,
      _enrich_stats: enrichStats,
    });
  }

  return withAccess({});
}

// ★ 嘉路康养中心所在城市（这些城市用本地数据，其余城市走腾讯地图实时搜索）
const JIALU_CITIES = ['嘉路', '防城港', '东兴', '港口区', '江山镇'];

// 广西城市坐标（用于附近搜索中心定位）
const CITY_COORDS = {
  '桂林': { lat: 25.2734, lng: 110.2902, name: '桂林市' },
  '南宁': { lat: 22.8170, lng: 108.3669, name: '南宁市' },
  '北海': { lat: 21.4817, lng: 109.1196, name: '北海市' },
  '柳州': { lat: 24.3264, lng: 109.4280, name: '柳州市' },
  '百色': { lat: 23.9022, lng: 106.6182, name: '百色市' },
  '钦州': { lat: 21.9522, lng: 108.6286, name: '钦州市' },
  '梧州': { lat: 23.4765, lng: 111.2791, name: '梧州市' },
  '贺州': { lat: 24.4033, lng: 111.5527, name: '贺州市' },
  '玉林': { lat: 22.6360, lng: 110.1540, name: '玉林市' },
  '贵港': { lat: 23.1114, lng: 109.5982, name: '贵港市' },
  '河池': { lat: 24.6965, lng: 108.0853, name: '河池市' },
  '来宾': { lat: 23.7333, lng: 109.2217, name: '来宾市' },
  '崇左': { lat: 22.4041, lng: 107.3540, name: '崇左市' },
  '阳朔': { lat: 24.7784, lng: 110.4890, name: '阳朔县' },
  '巴马': { lat: 24.0487, lng: 107.2586, name: '巴马瑶族自治县' },
};

// 意图到搜索关键词的映射
const INTENT_KEYWORDS = {
  wellness: ['医院', '诊所', '药店', '社区卫生服务中心'],
  food: ['餐厅', '美食', '饭店'],
  spot: ['景点', '景区', '旅游'],
  stay: ['酒店', '住宿', '民宿'],
  leisure: ['休闲娱乐', '公园'],
  shop: ['购物', '超市', '商场'],
  transit: ['公交站', '地铁站', '汽车站'],
};

// 类别到颜色/emoji的映射
const CAT_STYLES = {
  wellness: { color: '#E53935', emoji: '🏥', cat: 'wellness' },
  food: { color: '#FB8C00', emoji: '🍜', cat: 'food' },
  spot: { color: '#2BAE8E', emoji: '🏖️', cat: 'spot' },
  stay: { color: '#7E57C2', emoji: '🏠', cat: 'stay' },
  leisure: { color: '#43A047', emoji: '🎣', cat: 'leisure' },
  shop: { color: '#8D6E63', emoji: '🛍️', cat: 'shop' },
  transit: { color: '#1E88E5', emoji: '🚐', cat: 'transit' },
};

function tryExtractNonJialuCity(message) {
  if (!message || typeof message !== 'string') return null;

  // 提取用户提到的城市
  let foundCity = null;
  let foundCoord = null;
  for (const [city, coord] of Object.entries(CITY_COORDS)) {
    if (message.includes(city)) {
      foundCity = city;
      foundCoord = coord;
      break;
    }
  }

  // 没有提到城市 或 是嘉路所在城市 → 返回 null（走默认嘉路数据）
  if (!foundCity || JIALU_CITIES.some(c => message.includes(c))) return null;

  // 提取搜索类别
  let category = null;
  if (/医院|卫生|诊所|药店|医疗/.test(message)) category = 'wellness';
  else if (/餐厅|饭店|美食|吃饭|吃/.test(message)) category = 'food';
  else if (/景点|景区|游玩|旅游/.test(message)) category = 'spot';
  else if (/酒店|住宿|民宿/.test(message)) category = 'stay';
  else if (/休闲|娱乐|公园/.test(message)) category = 'leisure';
  else if (/购物|超市|商场/.test(message)) category = 'shop';

  return { city: foundCity, coord: foundCoord, category };
}

async function searchPoisForCity(cityName, category, cityCoord) {
  if (!cityCoord) return null;

  const keywords = INTENT_KEYWORDS[category] || ['医院', '诊所'];
  const style = CAT_STYLES[category] || CAT_STYLES.wellness;

  // 腾讯地图 POI 搜索（按城市区域；走 WebService Key 池，主 Key 配额满自动切备用）
  const adapter = new TencentMapAdapter({});

  const radius = 10000; // 10km
  let allPois = [];

  for (const kw of keywords) {
    try {
      const pois = await adapter.searchNearby(kw, cityCoord.lat, cityCoord.lng, radius, 10);
      for (const poi of pois) {
        if (poi.title && poi.location && poi.location.lat) {
          allPois.push({
            poi_id: poi.id || `poi_${allPois.length}`,
            name: poi.title,
            address: poi.address || '',
            lng: poi.location.lng,
            lat: poi.location.lat,
            distance: parseFloat((poi.distance / 1000).toFixed(1)),
            category: style.cat,
            amap_type: poi.type || kw,  // ★ 设 amap_type 为腾讯 type 或搜索关键词，让 nbCat 能匹配
            cat: style.cat,
            color: style.color,
            emoji: style.emoji,
            biz_status: '',
            tel: poi.tel || '',
            open_time: '',
            tags: [],
            tags_text: '',
            _source: 'tencent_map',
          });
        }
      }
    } catch (err) {
      console.warn(`[nearby] POI search "${kw}" failed:`, err.message);
    }
    if (allPois.length >= 15) break; // 够了就不再搜
  }

  // 去重（按名称）
  const seen = new Set();
  const facilities = allPois.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });

  return {
    facilities,
    center: { lat: cityCoord.lat, lng: cityCoord.lng, name: `${cityCoord.name}·${cityName}中心` },
    method: 'GET',
    url: 'https://apis.map.qq.com/ws/place/v1/search',
    provider: 'tencent_map',
    ok: facilities.length > 0,
  };
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
