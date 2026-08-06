import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import { requireAuth } from './server/auth-middleware.js';
import { wantsChatSse, writeChatSse } from './server/sse-chat.js';
import { handleAdminApi, serveAdminStatic } from './admin/index.js';
import { handleExtGateway } from './admin/integrations.js';
import { verifyOpenApiKey } from './admin/openapi.js';
import { getEmbedByToken, readAccess } from './admin/access.js';
import { handleDebugApi } from './api/debug.js';
import { buildEnvelope } from './contracts/envelope.js';
import { dispatchAction } from './core/actions/action-dispatcher.js';
import { createSmartFallbackHandler } from './core/fallback/smart-fallback-handler.js';
import { createContextManager } from './core/conversation/context-manager.js';
import { createSessionStore } from './core/conversation/session-store.js';
import { classifyIntent } from './core/intent-classifier/index.js';
import { createTemplateCardModelService } from './core/model-runtime/template-card-llm-service.js';
import { pickChatModel, publicModelName } from './core/model-runtime/model-registry.js';
import { createRuntimeLogger, summarizeEnvelope } from './core/observability/logger.js';
import { runLocalSkill } from './runtime/local-skill-runtime.js';
import { createRedisStateStore } from './services/cache/redis-state-store.js';
import { createDataService } from './services/data-service.js';
import { TencentMapAdapter } from './services/map/tencent-map-adapter.js';
import { createTencentWeatherAdapter } from './services/weather/tencent-weather.js';
import {
  getDevSsoPresets,
  getMobileBootstrap,
  getMockUserByToken,
} from './services/interface-data/mock-collaboration.js';
import { TABLE_SCHEMAS } from './services/table-data/schemas.js';

const DEV_PRESETS = getDevSsoPresets();
const CLIENT_DEV_PRESETS = DEV_PRESETS.slice(0, 8);
const DEV_PRESET_MAP = new Map(DEV_PRESETS.map((preset) => [preset.key, preset]));

export function createApp(env = { runtimeMode: 'local' }) {
  const dataService = env.dataService || createDataService(env.dataServiceOptions || buildDataServiceOptions(env));
  const stateStore = env.stateStore || createRedisStateStore({ redisUrl: env.redisUrl || '' });
  const modelService = env.modelService || createTemplateCardModelService({
    modelMode: env.modelMode,
    runtimeMode: env.runtimeMode,
    registryPath: env.modelRegistryPath,
    modelId: env.modelId,
  });
  const weatherService = env.weatherService || createTencentWeatherAdapter();
  const logger = env.logger || createRuntimeLogger(env.loggerOptions || {});
  const chatState = {
    running: new Map(),
    busyConversations: new Map(),
    stateStore,
    sessionStore: createSessionStore({ stateStore, repository: dataService?.tableData?.repository || null }),
    logger,
  };
  const contextManager = createContextManager({ sessionStore: chatState.sessionStore });
  const smartFallbackHandler = createSmartFallbackHandler({ modelClient: modelService });

  return async function handleRequest(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');

    // 轻量请求日志（供 admin「运行日志」读取）— 异步写入避免阻塞事件循环
    try {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        method: req.method,
        path: url.pathname,
        ip: req.socket?.remoteAddress || '-',
      }) + '\n';
      const logPath = path.join(process.cwd(), 'data', 'runtime.log');
      fs.appendFile(logPath, line, () => {});
    } catch { /* 日志失败不影响主流程 */ }

    try {
      // ===== 鉴权中间件：所有 /api/ 路由均需校验会话令牌 =====
      // 白名单路径（/api/health、/api/sso/*、静态文件等）在中间件内自动放行。
      // 本地/测试运行模式在缺少令牌时放行，生产模式严格返回 401/403。
      if (url.pathname.startsWith('/api/')) {
        const authorized = await requireAuth(req, res, url, { runtimeMode: env.runtimeMode, json });
        if (!authorized) return;
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, buildHealth(env));
      }

      if (req.method === 'GET' && url.pathname === '/api/client-config') {
        const accessCfg = readAccess();
        return json(res, 200, {
          ok: true,
          production: false,
          showTemplatePanel: true,
          businessSsoEnabled: accessCfg.sso?.enabled === true,
          businessSsoRemoteConfigured: Boolean(accessCfg.sso?.token_check_url),
          businessSsoPresets: [],
          devSsoPresets: CLIENT_DEV_PRESETS,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/sso/dev-login') {
        return handleDevLogin(req, res);
      }

      if (req.method === 'GET' && url.pathname === '/api/mobile-bootstrap') {
        return handleMobileBootstrap(req, res, url);
      }

      if (req.method === 'GET' && url.pathname === '/api/conversation/list') {
        return handleConversationList(res, { stateStore });
      }

      if (req.method === 'POST' && url.pathname === '/api/conversation/sync-batch') {
        return handleConversationSyncBatch(req, res, { stateStore });
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/conversation/delete/')) {
        return handleConversationDelete(req, res, url, { stateStore });
      }

      if (req.method === 'POST' && url.pathname === '/api/conversation/harvest-sync') {
        return handleConversationHarvestSync(req, res, { stateStore });
      }

      if (req.method === 'POST' && url.pathname === '/api/chat/message') {
        return handleChat(req, res, { dataService, chatState, modelService, weatherService, contextManager, smartFallbackHandler });
      }

      if (req.method === 'POST' && url.pathname === '/api/chat/followup') {
        return handleChat(req, res, { followup: true, dataService, chatState, modelService, weatherService, contextManager, smartFallbackHandler });
      }

      if (req.method === 'POST' && url.pathname === '/api/chat/action') {
        return handleChatAction(req, res, { dataService, modelService, logger, chatState, weatherService });
      }

      if (req.method === 'GET' && url.pathname === '/api/chat/running') {
        return json(res, 200, { ok: true, items: Array.from(chatState.running.values()) });
      }

      if (req.method === 'GET' && url.pathname === '/api/chat/queue') {
        return json(res, 200, { ok: true, source: stateStore.source, items: await stateStore.listJson('chat:queue') });
      }

      if (req.method === 'POST' && url.pathname === '/api/chat/queue/action') {
        return handleQueueAction(req, res, { chatState });
      }

      if (req.method === 'POST' && url.pathname === '/api/input/voice') {
        return handleVoiceInput(req, res, { asrEndpoint: env.asrEndpoint, json, readJson });
      }

      if (req.method === 'POST' && url.pathname === '/api/open/v1/chat/completions') {
        const auth = verifyOpenApiKey(req);
        if (!auth.ok) return json(res, 401, { ok: false, error: 'invalid_api_key', message: auth.message });
        return handleOpenApiChat(req, res, { dataService, chatState, modelService, weatherService });
      }

      // ========== 腾讯地图接口 ==========
      if (req.method === 'GET' && url.pathname === '/api/open/v1/map/regeocode') {
        return handleMapRegeocode(req, res, url);
      }

      if (req.method === 'GET' && url.pathname === '/api/open/v1/map/locate-by-ip') {
        return handleMapLocateByIP(req, res, url);
      }

      if (req.method === 'GET' && url.pathname === '/api/open/v1/map/suggestion') {
        return handleMapSuggestion(req, res, url);
      }

      if (req.method === 'GET' && url.pathname === '/api/open/v1/map/search-nearby') {
        return handleMapSearchNearby(req, res, url);
      }

      if (req.method === 'GET' && url.pathname === '/api/travel/geocode') {
        return handleMapGeocode(req, res, url);
      }

      // ========== 天气查询接口（首页天气栏使用） ==========
      if (req.method === 'GET' && url.pathname === '/api/weather') {
        return handleWeather(req, res, url, { weatherService });
      }

      // 第三方API 入站网关（目录见 admin「第三方API」页面）
      if (url.pathname.startsWith('/api/ext/')) {
        return void (await handleExtGateway(req, res, url));
      }

      // 第三方嵌入：嵌入页 + 嵌入点配置
      if (req.method === 'GET' && url.pathname === '/embed.html') {
        return serveFile(res, 'src/public/embed.html', 'text/html; charset=utf-8', req);
      }

      if (req.method === 'GET' && url.pathname === '/api/embed/config') {
        const embedCfg = getEmbedByToken(url.searchParams.get('token') || '');
        return embedCfg
          ? json(res, 200, { ok: true, embed: embedCfg })
          : json(res, 404, { ok: false, error: 'embed_not_found_or_disabled' });
      }

      // ── 外部系统 AES 加密 SSO 入口（支持 GET 和 POST） ──
      if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/gxy-assistant') {
        return handleGxyAssistant(req, res, url, { json });
      }

      if (req.method === 'POST' && url.pathname === '/api/intent/classify') {
        return handleIntentClassify(req, res);
      }

      if (req.method === 'GET' && url.pathname === '/api/intent/health') {
        return handleIntentHealth(res, env);
      }

      if (url.pathname.startsWith('/api/debug/')) {
        return handleDebugApi(req, res, url, { logger, chatState, env, json });
      }

      if (url.pathname.startsWith('/api/data/')) {
        return handleDataApi(req, res, url, { dataService });
      }

      if (req.method === 'GET' && url.pathname === '/api/skills') {
        return handleSkillList(res);
      }

      if (req.method === 'GET' && /^\/api\/skills\/[^/]+\/templates$/.test(url.pathname)) {
        return handleSkillTemplates(res, url);
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/mobile.html') && !hasAuthQuery(url)) {
        return redirectToDefaultMobile(res);
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/mobile.html')) {
        return serveFile(res, 'src/public/mobile.html', 'text/html; charset=utf-8', req);
      }

      if (req.method === 'GET' && (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg')) {
        return serveFile(res, 'src/public/favicon.svg', 'image/svg+xml', req);
      }

      if (req.method === 'GET' && url.pathname === '/mobile.css') {
        return serveFile(res, 'src/public/mobile.css', 'text/css; charset=utf-8', req);
      }

      if (req.method === 'GET' && url.pathname === '/mobile.js') {
        return serveFile(res, 'src/public/mobile.js', 'application/javascript; charset=utf-8', req);
      }

      if (req.method === 'GET' && url.pathname === '/location-service.js') {
        return serveFile(res, 'src/public/location-service.js', 'application/javascript; charset=utf-8', req);
      }

      if (req.method === 'GET' && url.pathname === '/device-redirect.js') {
        return serveFile(res, 'src/public/device-redirect.js', 'application/javascript; charset=utf-8', req);
      }

      if (req.method === 'GET' && url.pathname === '/device-switch.js') {
        return serveFile(res, 'src/public/device-switch.js', 'application/javascript; charset=utf-8', req);
      }

      if (url.pathname.startsWith('/api/admin/table/')) {
        const adminTablePath = url.pathname.replace('/api/admin/table', '/api/data/tables');
        const adminTableUrl = new URL(adminTablePath + url.search, 'http://localhost');
        return handleTableDataApi(req, res, adminTableUrl.pathname.slice('/api/data/tables/'.length).split('/').filter(Boolean), dataService);
      }

      if (url.pathname.startsWith('/api/admin/')) {
        return void handleAdminApi(req, res, url);
      }

      if (url.pathname.startsWith('/admin')) {
        return void serveAdminStatic(req, res, url);
      }

      return json(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      return json(res, 500, { ok: false, error: error.message || 'internal_error' });
    }
  };
}

function buildDataServiceOptions(env) {
  return {
    tableData: {
      pgUrl: env.pgUrl || env.tagSystemPgUrl || '',
    },
    interfaceData: {
      tagSystem: {
        baseUrl: env.tagSystemBaseUrl || 'http://192.168.1.160:8010',
        pgUrl: env.tagSystemPgUrl || env.pgUrl || '',
        token: env.tagSystemToken || '',
      },
    },
    knowledgeData: {
      remote: {
        baseUrl: env.knowledgeBaseUrl || '',
          searchPath: env.knowledgeSearchPath || '/api/knowledge/query',
          apiKey: env.knowledgeApiKey || '',
          username: env.knowledgeUsername || '',
          password: env.knowledgePassword || '',
          ticket: env.knowledgeTicket || '',
          space: env.knowledgeSpace || '23',
          agentId: env.knowledgeAgentId || '373',
          collections: env.knowledgeCollections || '',
          mealPlanCollections: env.knowledgeMealPlanCollections || '膳食知识库',
          defaultCollections: env.knowledgeDefaultCollections || '广西养老办事指引知识库,广西养老政策知识库',
        },
      },
    travelData: {
      jtdOptions: {
        ...(env.runtimeMode === 'test' ? { mode: 'mock' } : {}),
      },
    },
  };
}

function buildHealth(env) {
  const bindHost = env.host || '127.0.0.1';
  const publicHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost;
  const port = env.port || 5298;
  return {
    ok: true,
    service: 'flatTalk',
    runtime_mode: env.runtimeMode || 'local',
    local_service: { host: publicHost, bind_host: bindHost, port, endpoint: `${publicHost}:${port}` },
    platform: {
      mode: 'local_skill_runtime',
      baseUrl: `http://${publicHost}:${port}`,
      spaceId: process.env.FLATTALK_KB_SPACE || '23',
      agentId: process.env.FLATTALK_KB_AGENT_ID || '373',
      model: { name: env.modelMode || 'mock', model: env.openaiModel || 'mock' },
    },
  };
}

async function handleDevLogin(req, res) {
  const body = await readJson(req);
  const preset = DEV_PRESET_MAP.get(body.presetKey) || DEV_PRESET_MAP.get('c_elder') || DEV_PRESETS[0];
  const roleKey = body.roleKey || preset.roleKey;
  const elderScope = body.elderScope || preset.elderScope;
  const user = getMockUserByToken(preset.token, roleKey);
  return json(res, 200, {
    ok: true,
    mode: 'dev_sso',
    presetKey: preset.key,
    presetLabel: preset.label,
    userToken: preset.token,
    userId: user.user_id,
    roleId: user.role_id,
    roleName: user.role_name,
    roleKey,
    elderScope,
    terminal: preset.terminal,
    authLevel: preset.authLevel,
    orgId: preset.orgId,
    orgName: preset.orgName,
    userName: preset.userName,
    expiresIn: 24 * 60 * 60,
    usage: 'dev_only',
  });
}

function handleMobileBootstrap(req, res, url) {
  const query = Object.fromEntries(url.searchParams.entries());
  const bootstrap = getMobileBootstrap({
    ...query,
    token: query.token || query.userToken,
  });
  return json(res, 200, { ok: true, ...bootstrap });
}

async function handleVoiceInput(req, res, { asrEndpoint, json, readJson }) {
  const body = await readJson(req);
  const audioBase64 = body.audioBase64 || '';

  if (!audioBase64) {
    return json(res, 200, { ok: true, input: { voiceOk: false, warning: '未收到有效录音数据' } });
  }
  if (!asrEndpoint) {
    return json(res, 200, { ok: true, input: { voiceOk: false, warning: '语音识别服务未配置（ASR_ENDPOINT 缺失）' } });
  }

  // 从 data URL 中提取纯 base64 音频数据
  const base64Data = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
  const audioBuffer = Buffer.from(base64Data, 'base64');

  try {
    const asrResponse = await fetch(asrEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: audioBuffer,
    });

    if (!asrResponse.ok) {
      const errText = await asrResponse.text().catch(() => '');
      console.error('[ASR] 服务返回错误:', asrResponse.status, errText);
      return json(res, 200, { ok: true, input: { voiceOk: false, warning: `语音识别服务异常（HTTP ${asrResponse.status}）` } });
    }

    const asrResult = await asrResponse.json().catch(() => ({}));
    // 兼容多种 ASR 响应字段
    const text = asrResult.text || asrResult.result || asrResult.transcript
      || asrResult.data?.text || asrResult.data?.result || '';

    if (text) {
      return json(res, 200, { ok: true, input: { voiceOk: true, text } });
    }
    return json(res, 200, { ok: true, input: { voiceOk: false, warning: '语音未识别出有效文字，请靠近麦克风再试' } });
  } catch (err) {
    console.error('[ASR] 请求失败:', err.message);
    return json(res, 200, { ok: true, input: { voiceOk: false, warning: `语音识别服务连接失败：${err.message}` } });
  }
}

async function handleConversationList(res, { stateStore }) {
  const sessionStore = createSessionStore({ stateStore });
  const conversations = await sessionStore.listConversations();
  return json(res, 200, {
    ok: true,
    source: stateStore.source,
    conversations,
  });
}

async function handleConversationSyncBatch(req, res, { stateStore }) {
  const body = await readJson(req);
  const sessionStore = createSessionStore({ stateStore });
  const saved = await sessionStore.syncClientConversations(Array.isArray(body.conversations) ? body.conversations : []);
  return json(res, 200, {
    ok: true,
    source: stateStore.source,
    synced_count: saved.length,
  });
}

async function handleConversationDelete(req, res, url, { stateStore }) {
  const conversationId = decodeURIComponent(url.pathname.slice('/api/conversation/delete/'.length));
  const sessionStore = createSessionStore({ stateStore });
  await sessionStore.deleteConversation(conversationId);
  return json(res, 200, {
    ok: true,
    conversation_id: conversationId,
  });
}

async function handleConversationHarvestSync(req, res, { stateStore }) {
  const body = await readJson(req);
  const conversationId = body.conversationId || body.conversation_id || body.id;
  const sessionStore = createSessionStore({ stateStore });
  const harvest = await sessionStore.markHarvested(conversationId, {
    source: body.source || 'mobile',
  });
  return json(res, 200, {
    ok: true,
    conversation_id: conversationId,
    harvest,
  });
}

async function handleChat(req, res, { followup = false, dataService, chatState, modelService, weatherService, contextManager, smartFallbackHandler } = {}) {
  const body = await readJson(req);
  const startedAt = Date.now();
  const conversationId = body.conversation_id || body.conversationId || makeId('conv');
  const sessionStore = chatState.sessionStore;
  const previous = await sessionStore.getPreviousTurn(conversationId);
  const turnId = body.turn_id || makeId('turn');
  const message = body.message || body.user_prompt || body.prompt || '';
  const runningKey = `${conversationId}:${turnId}`;
  const reenterChat = body.reenter_chat === true || body.reenterChat === true || body.execute_action === false;

  // 会话级互斥：同一会话正在处理时拒绝新请求
  if (chatState?.busyConversations?.has(conversationId)) {
    return json(res, 409, {
      ok: false,
      error: 'conversation_busy',
      message: '当前会话正在处理中，请稍候',
      conversation_id: conversationId,
    });
  }
  chatState?.busyConversations?.set(conversationId, { turn_id: turnId, started_at: new Date().toISOString() });

  chatState?.running?.set(runningKey, {
    conversation_id: conversationId,
    turn_id: turnId,
    status: 'running',
    message,
    started_at: new Date().toISOString(),
  });

  try {
    const envelope = await runLocalSkill({
      request_id: body.request_id,
      conversation_id: conversationId,
      turn_id: turnId,
      skill_key: (reenterChat || !followup) ? '' : body.skill_key || body.skillKey,
      template_id: body.template_id || body.templateId || body.params?.template_id || body.next_template_id || '',
      intent: body.intent || '',
      message,
      role: body.role || body.roleKey || 'elder_family',
      elder_id: body.elder_id,
      context: {
        active_agent: reenterChat ? '' : (previous?.envelope?.agent_key || previous?.envelope?.skill_key || ''),
        last_template: previous?.envelope?.template_id || '',
        ...(body.context || {}),
        action_key: reenterChat ? '' : (body.action_key || body.actionKey || ''),
        action_params: reenterChat ? {} : (body.params || {}),
        reenter_chat: reenterChat,
        location: body.location || null,
        unsupported_action_key: body.unsupported_action_key || body.unsupportedActionKey || '',
        previous_turn_id: previous?.turn_id || '',
        ...(followup ? {
          previous_scene: previous?.envelope?.skill_key,
          followup_source: body.followup_source || body.source || '',
        } : {}),
        // ★ ContextSnapshot 注入：从上一轮 envelope 提取上下文快照
        ...(previous?.envelope?.context_snapshot ? {
          previous_scene: previous.envelope.context_snapshot.scene,
          previous_template: previous.envelope.context_snapshot.template_id,
          previous_intent: previous.envelope.context_snapshot.intent,
        } : {}),
      },
    }, { dataService, modelService, weatherService, contextManager, smartFallbackHandler });

    await sessionStore.appendTurn(conversationId, { turn_id: turnId, user_message: message, envelope });
    chatState.logger?.write?.({ type: 'chat_turn', ...summarizeEnvelope(envelope, startedAt) });
    if (wantsChatSse(req)) {
      return writeChatSse(res, envelope);
    }
    return json(res, 200, envelope);
  } finally {
    chatState?.running?.delete(runningKey);
    chatState?.busyConversations?.delete(conversationId);
  }
}

async function handleChatAction(req, res, { dataService, modelService, logger, chatState, weatherService }) {
  const body = await readJson(req);
  const actionKey = body.action_key || body.actionKey;
  if (!actionKey) return json(res, 400, { ok: false, error: 'action_key_required' });

  const startedAt = Date.now();
  const conversationId = body.conversation_id || body.conversationId || makeId('conv');
  const sessionStore = chatState?.sessionStore;

  // 会话级互斥
  if (chatState?.busyConversations?.has(conversationId)) {
    return json(res, 409, {
      ok: false,
      error: 'conversation_busy',
      message: '当前会话正在处理中，请稍候',
      conversation_id: conversationId,
    });
  }
  chatState?.busyConversations?.set(conversationId, { action_key: actionKey, started_at: new Date().toISOString() });

  const previous = await sessionStore?.getPreviousTurn(conversationId);
  try {
    const result = await dispatchAction({
      ...body,
      conversation_id: conversationId,
      context: {
        ...(body.context || {}),
        previous_scene: previous?.envelope?.skill_key,
        previous_turn_id: previous?.turn_id,
        previous_template_id: previous?.envelope?.template_id,
        // ★ ContextSnapshot 注入：从上一轮 envelope 提取上下文快照
        ...(previous?.envelope?.context_snapshot ? {
          previous_scene: previous.envelope.context_snapshot.scene,
          previous_template: previous.envelope.context_snapshot.template_id,
          previous_intent: previous.envelope.context_snapshot.intent,
        } : {}),
      },
    }, {
      runSkill: (request) => runLocalSkill({
        request_id: request.request_id,
        conversation_id: request.conversation_id || conversationId,
        turn_id: request.turn_id || makeId('turn_action'),
        skill_key: request.skill_key || request.skillKey || 'meal_plan',
        template_id: request.template_id || request.templateId || request.params?.template_id,
        message: request.message || '',
        role: request.role || request.roleKey || 'elder_family',
        elder_id: request.elder_id || request.params?.elder_id,
        context: request.context || {},
      }, { dataService, modelService, weatherService }),
    });
    if (result.envelope && sessionStore) {
      await sessionStore.appendTurn(conversationId, {
        turn_id: result.envelope.turn_id,
        user_message: body.user_prompt || body.message || actionKey,
        envelope: result.envelope,
        action_key: actionKey,
      });
    }
    logger?.write?.({
      type: 'chat_action',
      action_key: actionKey,
      action_type: result.action_type,
      result_type: result.result_type,
      ...(result.envelope ? summarizeEnvelope(result.envelope, startedAt) : { latency_ms: Date.now() - startedAt }),
    });
    const status = result.status || 200;
    const { status: _status, ...payload } = result;
    return json(res, status, payload);
  } finally {
    chatState?.busyConversations?.delete(conversationId);
  }
}

async function handleQueueAction(req, res, { chatState }) {
  const body = await readJson(req);
  const action = body.action || body.action_key || 'status';
  if (action === 'clear' || action === 'chat.queue.clear') {
    await chatState.stateStore.clear('chat:queue');
    return json(res, 200, { ok: true, source: chatState.stateStore.source, queue_size: 0 });
  }
  if (action === 'add' || action === 'chat.queue.add') {
    const item = {
      queue_id: body.queue_id || makeId('queue'),
      conversation_id: body.conversation_id || '',
      message: body.message || body.user_prompt || '',
      created_at: new Date().toISOString(),
    };
    await chatState.stateStore.pushJson('chat:queue', item);
    const queue = await chatState.stateStore.listJson('chat:queue');
    return json(res, 200, { ok: true, source: chatState.stateStore.source, item, queue_size: queue.length });
  }
  const queue = await chatState.stateStore.listJson('chat:queue');
  return json(res, 200, { ok: true, source: chatState.stateStore.source, queue_size: queue.length, items: queue });
}

async function handleOpenApiChat(req, res, deps) {
  const body = await readJson(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((item) => item?.role === 'user');
  const text = body.message || lastUser?.content || '';
  const envelope = await runSkillForOpenApi({
    request_id: body.request_id,
    conversation_id: body.conversation_id || makeId('conv'),
    skill_key: body.skill_key || body.skillKey,
    message: text,
    role: body.role || body.roleKey,
    elder_id: body.elder_id,
    context: body.context,
  }, deps);

  return json(res, 200, {
    id: makeId('chatcmpl'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || 'flatTalk-local-skill',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: envelope.answer_text || envelope.answer || '',
      },
      finish_reason: 'stop',
    }],
    flatTalk: envelope,
  });
}

async function runSkillForOpenApi(body, { dataService, modelService, weatherService }) {
  return runLocalSkill({
    request_id: body.request_id,
    conversation_id: body.conversation_id,
    turn_id: makeId('turn'),
    skill_key: body.skill_key || body.skillKey,
    message: body.message || '',
    role: body.role || 'elder_family',
    elder_id: body.elder_id,
    context: body.context || {},
  }, { dataService, modelService, weatherService });
}

async function handleIntentClassify(req, res) {
  const body = await readJson(req);
  const intent_context = await classifyIntent({
    ...body,
    text: body.text || body.message || body.query || '',
  });
  return json(res, 200, { ok: true, intent_context });
}

function handleIntentHealth(res, env) {
  const model = pickChatModel({ registryPath: env.modelRegistryPath, modelId: env.modelId });
  return json(res, 200, {
    ok: true,
    classifier: 'rules',
    route: 'intent-classifier -> scene-router -> local-skill-runtime',
    model_mode: env.modelMode || process.env.FLATTALK_MODEL_MODE || 'admin',
    default_model: model ? publicModelName(model) : '',
    has_default_model: Boolean(model),
  });
}

async function handleDataApi(req, res, url, { dataService }) {
  const parts = url.pathname.slice('/api/data/'.length).split('/').filter(Boolean);
  if (parts[0] === 'tables') return handleTableDataApi(req, res, parts.slice(1), dataService);
  if (parts[0] === 'knowledge') return handleKnowledgeDataApi(req, res, url, parts.slice(1), dataService);
  if (parts[0] === 'interfaces') return handleInterfaceDataApi(req, res, parts.slice(1), dataService);
  return json(res, 404, { ok: false, error: 'data_route_not_found' });
}

async function handleTableDataApi(req, res, parts, dataService) {
  const repository = dataService.tableData.repository;
  if (parts.length === 0 && req.method === 'GET') {
    return json(res, 200, { ok: true, items: TABLE_SCHEMAS });
  }

  const tableName = parts[0];
  if (!TABLE_SCHEMAS[tableName]) return json(res, 404, { ok: false, error: 'unknown_table' });

  if (parts.length === 1) {
    if (req.method === 'GET') return json(res, 200, { ok: true, items: await repository.list(tableName) });
    if (req.method === 'POST') {
      const row = await readJson(req);
      return json(res, 201, { ok: true, item: await repository.create(tableName, row) });
    }
  }

  const id = decodeURIComponent(parts[1] || '');
  if (req.method === 'GET') {
    const item = await repository.get(tableName, id);
    return item ? json(res, 200, { ok: true, item }) : json(res, 404, { ok: false, error: 'row_not_found' });
  }
  if (req.method === 'PUT' || req.method === 'PATCH') {
    const patch = await readJson(req);
    const item = await repository.update(tableName, id, patch);
    return item ? json(res, 200, { ok: true, item }) : json(res, 404, { ok: false, error: 'row_not_found' });
  }
  if (req.method === 'DELETE') {
    return json(res, 200, { ok: await repository.remove(tableName, id) });
  }
  return json(res, 405, { ok: false, error: 'method_not_allowed' });
}

async function handleKnowledgeDataApi(req, res, url, parts, dataService) {
  const knowledge = dataService.knowledgeData;

  if (parts[0] === 'documents') {
    if (parts.length === 1 && req.method === 'GET') {
      const skillKey = url.searchParams.get('skill_key') || 'meal_plan';
      return json(res, 200, { ok: true, items: await knowledge.documentStore.listBySkill(skillKey) });
    }
    if (parts.length === 1 && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 201, { ok: true, item: await knowledge.documentStore.upsert(body) });
    }

    const documentId = decodeURIComponent(parts[1] || '');
    if (req.method === 'GET') {
      const item = await knowledge.documentStore.get(documentId);
      return item ? json(res, 200, { ok: true, item }) : json(res, 404, { ok: false, error: 'document_not_found' });
    }
    if (req.method === 'PUT') {
      const body = await readJson(req);
      return json(res, 200, { ok: true, item: await knowledge.documentStore.upsert({ ...body, document_id: documentId }) });
    }
    if (req.method === 'DELETE') {
      return json(res, 200, { ok: await knowledge.documentStore.remove(documentId) });
    }
  }

  if (parts[0] === 'search' && req.method === 'POST') {
    const body = await readJson(req);
    const result = await knowledge.retriever.retrieve({
      skill_key: body.skill_key || 'meal_plan',
      query: body.query || '',
      limit: body.limit || 3,
      filters: body.filters || {},
    });
    return json(res, 200, { ok: true, ...result });
  }

  return json(res, 404, { ok: false, error: 'knowledge_route_not_found' });
}

async function handleInterfaceDataApi(req, res, parts, dataService) {
  const interfaces = dataService.interfaceData;
  if (parts[0] === 'status' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      services: {
        httpClient: interfaces.httpClient.isConfigured(),
        tagSystem: interfaces.tagSystem.isConfigured(),
      },
    });
  }
  if (parts[0] === 'tag-system' && parts[1] === 'profile' && req.method === 'POST') {
    const body = await readJson(req);
    return json(res, 200, await interfaces.tagSystem.getEntityProfile(body.entity_id || body.entityId));
  }
  if (parts[0] === 'http' && parts[1] === 'post' && req.method === 'POST') {
    const body = await readJson(req);
    return json(res, 200, await interfaces.httpClient.post(body.path || '/', body.body || {}, body.headers || {}));
  }
  return json(res, 404, { ok: false, error: 'interface_route_not_found' });
}

function handleSkillList(res) {
  const skillsDir = path.join(process.cwd(), 'src', 'skills');
  const items = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => {
      const manifest = readJsonFileSafe(path.join(skillsDir, entry.name, 'manifest.json'));
      return {
        skill_key: entry.name,
        name: manifest.name || entry.name,
        default_template: manifest.default_template || '',
      };
    });
  return json(res, 200, { ok: true, items });
}

function handleSkillTemplates(res, url) {
  const skillKey = decodeURIComponent(url.pathname.split('/')[3] || '');
  const htmlDir = path.join(process.cwd(), 'src', 'skills', skillKey, 'templates', 'html');
  if (!fs.existsSync(htmlDir)) return json(res, 404, { ok: false, error: 'skill_templates_not_found' });
  const items = fs.readdirSync(htmlDir)
    .filter((file) => file.endsWith('.manifest.json'))
    .map((file) => readJsonFileSafe(path.join(htmlDir, file)))
    .filter((item) => item && Object.keys(item).length > 0);
  return json(res, 200, { ok: true, skill_key: skillKey, items });
}

/**
 * 处理外部系统 AES 加密 SSO 入口 /gxy-assistant
 * 支持 GET 和 POST 两种方式
 * 成功后返回 JSON（包含 mobileUrl、token、userToken）
 */
async function handleGxyAssistant(req, res, url, { json }) {
  let cipherText;
  if (req.method === 'GET') {
    cipherText = url.searchParams.get('userInfo');
  } else {
    // POST 模式：从请求体读取 JSON
    const body = await readJson(req);
    cipherText = body.userInfo;
  }
  if (!cipherText) {
    return json(res, 400, { ok: false, error: 'missing_userInfo', message: '缺少 userInfo 参数' });
  }
  // 修复 URL 编码问题：将空格替换回 + 号（Base64 标准字符）
  cipherText = cipherText.replace(/ /g, '+');
  
  // 获取主机配置
  const { loadEnv } = await import('./config/env.js');
  const env = loadEnv();
  const host = req.headers.host?.split(':')[0] || env.host;
  
  const { processExternalSsoRequest } = await import('./server/external-aes-sso.js');
  const result = processExternalSsoRequest(cipherText, {
    host,
    port: env.port,
    sslPort: env.sslPort,
  });
  
  if (!result.ok) {
    const status = result.error === 'internal_error' ? 500 : 400;
    return json(res, status, result);
  }
  
  // 返回 JSON（不再 302 重定向）
  return json(res, 200, result);
}

function hasAuthQuery(url) {
  return Boolean(url.searchParams.get('token') || url.searchParams.get('userToken') || url.searchParams.get('roleKey'));
}

function redirectToDefaultMobile(res) {
  const preset = DEV_PRESET_MAP.get('c_family') || DEV_PRESETS[0];
  const params = new URLSearchParams({
    userToken: preset.token,
    roleKey: preset.roleKey,
    elderScope: preset.elderScope,
    terminal: preset.terminal,
    authLevel: preset.authLevel,
    userName: preset.userName,
    orgName: preset.orgName,
    presetKey: preset.key,
  });
  res.writeHead(302, { location: `/mobile.html?${params}` });
  res.end();
}

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('request_body_too_large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveFile(res, relativePath, contentType, req) {
  const filePath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(filePath)) {
    json(res, 404, { ok: false, error: 'static_file_not_found' });
    return;
  }

  const body = fs.readFileSync(filePath);
  const etag = `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;

  if (req?.headers?.['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  const headers = {
    'content-type': contentType,
    'etag': etag,
    'cache-control': 'no-cache',
  };

  const acceptEncoding = req?.headers?.['accept-encoding'] || '';
  if (acceptEncoding.includes('gzip') && body.length > 1024) {
    const compressed = zlib.gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = compressed.length;
    res.writeHead(200, headers);
    res.end(compressed);
  } else {
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(body);
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ========== 腾讯地图接口处理函数 ==========

async function handleMapGeocode(req, res, url) {
  const address = url.searchParams.get('address');
  if (!address) {
    return json(res, 400, { ok: false, error: '缺少 address 参数' });
  }

  try {
    const tencentMap = new TencentMapAdapter();
    const result = await tencentMap.geocode(address);
    return json(res, 200, {
      ok: true,
      result: {
        location: {
          lat: result.lat,
          lng: result.lng,
        },
        address_reference: result.formatted_address,
        precision: result.precision,
      },
      source: 'tencent_map',
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

async function handleMapRegeocode(req, res, url) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const coord_type = parseInt(url.searchParams.get('coord_type')) || 5;

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return json(res, 400, { ok: false, error: '缺少有效的 lat 和 lng 参数' });
  }

  try {
    const tencentMap = new TencentMapAdapter();
    const result = await tencentMap.regeocode(lat, lng, coord_type);
    return json(res, 200, {
      ok: true,
      result,
      source: 'tencent_map',
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

// 服务端天气缓存：city → { data, ts }
// 缓存 30 分钟，减少腾讯天气 API 调用次数
const weatherCache = new Map();
const WEATHER_CACHE_TTL = 30 * 60 * 1000;

/**
 * 处理天气查询请求
 * GET /api/weather?city=北海
 * 优先从缓存返回，缓存过期才调用腾讯天气 API
 */
async function handleWeather(req, res, url, { weatherService }) {
  const city = url.searchParams.get('city') || '';

  if (!city || !city.trim()) {
    return json(res, 400, { ok: false, error: '缺少 city 参数' });
  }

  const cityName = String(city).trim();

  // 查缓存
  const cached = weatherCache.get(cityName);
  if (cached && (Date.now() - cached.ts) < WEATHER_CACHE_TTL) {
    return json(res, 200, { ok: true, ...cached.data, cached: true });
  }

  try {
    const result = await weatherService.getWeather(cityName, { days: 1 });
    if (result.ok) {
      // 写缓存
      weatherCache.set(cityName, { data: result, ts: Date.now() });
    }
    return json(res, 200, { ok: result.ok, ...result, cached: false });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

async function handleMapLocateByIP(req, res, url) {
  const ip = url.searchParams.get('ip') || '';

  try {
    const tencentMap = new TencentMapAdapter();
    const result = await tencentMap.locateByIP(ip);
    return json(res, 200, {
      ok: true,
      result,
      source: 'tencent_map',
    });
  } catch (e) {
    // API 失败（配额耗尽/签名错误等）→ 返回 200 + 空结果，前端降级到默认坐标
    return json(res, 200, {
      ok: false,
      result: null,
      error: e.message,
    });
  }
}

async function handleMapSuggestion(req, res, url) {
  const keyword = url.searchParams.get('keyword');
  if (!keyword) {
    return json(res, 400, { ok: false, error: '缺少 keyword 参数' });
  }

  try {
    const tencentMap = new TencentMapAdapter();
    const suggestions = await tencentMap.suggestion(keyword, {
      region: url.searchParams.get('region') || '',
      city_limit: url.searchParams.get('city_limit') === 'true',
      location: url.searchParams.get('location') || '',
      page_size: parseInt(url.searchParams.get('page_size')) || 10,
    });
    return json(res, 200, {
      ok: true,
      result: suggestions,
      count: suggestions.length,
      source: 'tencent_map',
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}

async function handleMapSearchNearby(req, res, url) {
  const keyword = url.searchParams.get('keyword');
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radius = parseInt(url.searchParams.get('radius')) || 1000;
  const page_size = parseInt(url.searchParams.get('page_size')) || 10;

  if (!keyword) {
    return json(res, 400, { ok: false, error: '缺少 keyword 参数' });
  }
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return json(res, 400, { ok: false, error: '缺少有效的 lat 和 lng 参数' });
  }

  try {
    const tencentMap = new TencentMapAdapter();
    const pois = await tencentMap.searchNearby(keyword, lat, lng, radius, page_size);
    return json(res, 200, {
      ok: true,
      result: {
        pois,
        total: pois.length,
        page_index: 1,
        page_size: pois.length,
      },
      source: 'tencent_map',
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}
