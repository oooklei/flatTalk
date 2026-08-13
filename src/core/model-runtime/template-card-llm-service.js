import { fillTemplateSlots as fillTemplateSlotsMock } from '../model-service.js';
import {
  buildSessionContextText,
  splitBusinessDataForPrompt,
} from '../context-bus/session-prompt-context.js';
import { LOCAL_FILL_TEMPLATE_IDS } from './extra-template-fills.js';
import { pickChatModel, publicModelName } from './model-registry.js';
import { callOpenAiCompatibleModel } from './openai-compatible-client.js';
import { loadPrompt } from './prompt-loader.js';
import { createKnowledgeDataService } from '../../services/knowledge-data/index.js';
import { createTencentWeatherAdapter } from '../../services/weather/tencent-weather.js';
import { recordDegrade } from '../observability/degradation-monitor.js';

function shouldForceLocalFill(requestedId, skillKey) {
  // 旧模板已废弃，按新主卡处理
  if (requestedId === 'route_card') requestedId = 'sojourn_route';
  if (requestedId === 'travel_base_card') requestedId = 'sojourn_base';
  if (requestedId && LOCAL_FILL_TEMPLATE_IDS.has(requestedId)) return true;
  if (requestedId && String(requestedId).startsWith('nearby_')) return true;
  // skill 级强制仅保留结构化主路径；其余缺本地填槽的模板放开 LLM
  if (skillKey === 'travel_route' && (!requestedId || ['sojourn_route', 'sojourn_base'].includes(requestedId))) return true;
  if (skillKey === 'find_service' && (!requestedId || requestedId === 'service_recommend')) return true;
  return false;
}

export function createTemplateCardModelService(options = {}) {
  let mode = options.modelMode || process.env.FLATTALK_MODEL_MODE || 'admin';
  const allowModelMock = process.env.FLATTALK_ALLOW_MODEL_MOCK === '1'
    || options.runtimeMode === 'test'
    || process.env.FLATTALK_RUNTIME_MODE === 'test';
  // SHOULD：生产禁止 mock 填槽；未显式允许时强制回落 admin
  if (mode === 'mock' && !allowModelMock) {
    console.warn('[template-card-llm] FLATTALK_MODEL_MODE=mock 已忽略（需 FLATTALK_ALLOW_MODEL_MOCK=1）');
    mode = 'admin';
  }
  const useMock = mode === 'mock' || options.runtimeMode === 'test';
  const knowledgeService = options.knowledgeService || createKnowledgeDataService();
  const weatherService = options.weatherService || createTencentWeatherAdapter();

  return {
    async fillTemplateSlots(input = {}) {
      if (useMock) {
        const result = await fillTemplateSlotsMock({ ...input, knowledgeService, weatherService });
        if (result?.model_status === 'no_local_fill') {
          return buildNoLocalFillApology(input, result);
        }
        return { ...result, model_status: result.model_status || 'mock', model_used: result.model_used || 'mock' };
      }

      const requestedId = input.template_id || input.templateId || '';
      if (shouldForceLocalFill(requestedId, input.skill_key)) {
        const localResult = await fillTemplateSlotsMock({ ...input, knowledgeService, weatherService });
        if (localResult?.model_status === 'no_local_fill') {
          // 本地清单声称有填槽但未命中：放开 LLM
        } else {
          return { ...localResult, model_status: 'local_deterministic', model_used: 'local' };
        }
      } else {
        // 先尝试本地；有结果则用本地，否则走 LLM
        const localResult = await fillTemplateSlotsMock({ ...input, knowledgeService, weatherService });
        if (localResult && localResult.model_status !== 'no_local_fill' && (localResult.answer_text || Object.keys(localResult.data || {}).length)) {
          return { ...localResult, model_status: 'local_deterministic', model_used: 'local' };
        }
      }

      const model = pickChatModel({ registryPath: options.registryPath, modelId: options.modelId });
      if (!model) return fallback(input, 'no_available_model', '未找到可用 admin 模型');

      const templateFields = buildTemplateFields(input.template_library);
      const messages = buildMessages({ ...input, template_fields: templateFields });
      const response = await callOpenAiCompatibleModel(model, messages, {
        fetchImpl: options.fetchImpl,
        timeoutMs: input.timeoutMs || options.timeoutMs || 45000,
        maxTokens: input.max_tokens || model.max_tokens,
        temperature: input.temperature ?? model.temperature ?? 0.3,
      });
      if (!response.ok) return fallback(input, response.status, response.error, publicModelName(model));

      const parsed = parseModelJson(response.content);
      if (!parsed) return fallback(input, 'invalid_json', '模型未返回合法 JSON', publicModelName(model), response.content);

      return sanitizeShape({
        ...parsed,
        model_status: 'ok',
        model_used: publicModelName(model),
      }, input);
    },

    /**
     * 按钮动作通用兜底：强制走真实 LLM（绕过本地确定性模板），
     * 用 input.prompt（五要素提示词）作为 user message 调模型合成。
     * mock 模式或无可用模型时返回离线兜底说明（含「兜底」字样）。
     * 测试可通过 options.testModel 或 svc.testModel 注入模型强制走 LLM。
     */
    async fillFallback(input = {}) {
      const templateId = input.template_id || input.templateId || 'answer';
      if (useMock && !options.testModel) {
        return buildFallbackMockAnswer(input, 'mock_mode');
      }
      const model = options.testModel || pickChatModel({ registryPath: options.registryPath, modelId: options.modelId });
      if (!model) return buildFallbackMockAnswer(input, 'no_available_model');

      const session_context_text = input.session_context_text
        || buildSessionContextText(input.business_data || {});
      const messages = [
        {
          role: 'system',
          content: loadPrompt('template-card/system.md', {
            session_context_text: session_context_text || '（当前会话暂无明确登录身份）',
          }),
        },
        { role: 'user', content: input.prompt || '' },
      ];
      const response = await callOpenAiCompatibleModel(model, messages, {
        fetchImpl: input.fetchImpl || options.fetchImpl,
        timeoutMs: input.timeoutMs || options.timeoutMs,
        maxTokens: input.max_tokens || model.max_tokens,
        temperature: input.temperature ?? model.temperature ?? 0.3,
      });
      if (!response.ok) return buildFallbackMockAnswer(input, response.status);
      const parsed = parseModelJson(response.content);
      if (!parsed) return buildFallbackMockAnswer(input, 'invalid_json', response.content);
      const shaped = sanitizeShape({
        ...parsed,
        data: parsed,
        model_status: 'ok',
        model_used: publicModelName(model),
      }, { template_id: templateId, template_library: [{ id: templateId }] });
      // 兜底保证 answer_text 非空：优先取模型声明的 answer_text/answer，否则回退到 data.summary/title
      if (!shaped.answer_text) {
        shaped.answer_text = (shaped.data && (shaped.data.summary || shaped.data.title)) || shaped.title || '';
      }
      return shaped;
    },

    set testModel(m) { options.testModel = m; },
  };
}

function buildNoLocalFillApology(input = {}, result = {}) {
  const templateId = result.template_id || input.template_id || input.templateId || 'answer';
  const message = input.message || '';
  const answerText = message
    ? `抱歉，我暂时无法处理「${message}」，请稍后重试或换个问法。`
    : '抱歉，我暂时无法处理您的请求，请稍后重试。';
  return {
    template_id: templateId,
    answer_text: answerText,
    answer: answerText,
    data: {
      title: '桂小养答复',
      skill_name: '通用回答',
      answer_text: answerText,
      answer: answerText,
      metrics: [
        { label: '处理状态', value: '降级兜底' },
        { label: '下一步', value: '请稍后重试或换个问法' },
      ],
    },
    actions: [],
    followup_suggestions: [],
    template_fit_notes: ['fallback_common_answer', 'no_local_fill'],
    model_status: 'no_local_fill',
    model_used: 'mock',
  };
}

function buildFallbackMockAnswer(input = {}, status = 'mock_mode', rawReply = '') {
  const templateId = input.template_id || input.templateId || 'answer';
  const label = input.label || '该按钮动作';
  const answerText = `[兜底动作] 已收到动作「${label}」，当前为离线/无模型模式，暂无法调用大模型生成内容。该动作将：${input.endpoint || '依据资源清单处理'}。${rawReply ? `\n（模型原始返回：${String(rawReply).slice(0, 200)}）` : ''}`;
  recordDegrade('llm_fallback_mock', { detail: status, template_id: templateId });
  return {
    template_id: templateId,
    template_key: templateId,
    answer_text: answerText,
    answer: answerText,
    data: {
      title: '桂小养兜底答复',
      skill_name: '按钮动作兜底',
      answer_text: answerText,
      points: [],
      risks: [],
      suggestions: [],
    },
    actions: [],
    followup_suggestions: [],
    model_status: 'fallback_mock',
    model_used: 'mock',
    model_error_status: status,
  };
}

function buildTemplateFields(library = []) {
  if (!Array.isArray(library)) return [];
  return library.map((t) => ({
    id: t.id || '',
    layout: t.layout || '',
    match: t.match || t.description || '',
    required: Array.isArray(t.required) ? t.required : [],
    data_schema: t.data_schema || null,
  }));
}

export function buildTemplateCardMessages(input = {}) {
  return buildMessages(input);
}

function buildMessages(input) {
  const historyText = formatHistoryText(input.conversation_history);
  const businessData = input.business_data || {};
  const session_context_text = input.session_context_text
    || buildSessionContextText(businessData);
  const split = input.session_profiles || input.skill_business_data
    ? {
        session_profiles: input.session_profiles || {},
        skill_business_data: input.skill_business_data || {},
      }
    : splitBusinessDataForPrompt(businessData);

  const system = loadPrompt('template-card/system.md', {
    session_context_text: session_context_text || '（当前会话暂无明确登录身份）',
  });
  const user = loadPrompt('template-card/fill-template.md', {
    user_message: input.message || '',
    intent_context: input.intent_context || {},
    skill_key: input.skill_key || '',
    requested_template_id: input.template_id || input.templateId || '',
    template_library: input.template_library || [],
    template_fields: input.template_fields || [],
    evidence: input.evidence || [],
    session_profiles: split.session_profiles,
    skill_business_data: split.skill_business_data,
    conversation_history: historyText,
    skill_instruction: buildSkillInstruction(input.skill_key),
  });
  const messages = [{ role: 'system', content: system }];
  const history = Array.isArray(input.conversation_history) ? input.conversation_history : [];
  for (const msg of history) {
    if (msg.role && msg.content) messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: user });
  return messages;
}

function buildSkillInstruction(skillKey = '') {
  if (skillKey === 'travel_route') {
    return [
      '【旅居路线规划 · 金跳动优先规则】',
      '1. business_data 中的 jtd.products（金跳动接口返回的可售旅居路线产品）是本次回复的【首要推荐对象】，必须作为 sojourn_route 的 product 字段，并在 answer_text 开头明确以该产品为首推。',
      '2. 知识库证据或 business_data.routes 中的本地路线（防城港线路、十条精品路线等）仅作【补充参考】；只有当 jtd.products 为空或明显不可订时，才改用本地路线，且必须在 answer_text 中标注「金跳动暂无匹配产品，以下为本地参考路线」。',
      '3. 严禁把本地路线排在金跳动产品之前作为首推；金跳动产品存在时，一律以金跳动为首。',
    ].join('\n');
  }
  return '（本技能无专属指令）';
}

function formatHistoryText(history = []) {
  if (!Array.isArray(history) || history.length === 0) return '无';
  return history
    .map((msg) => `[${msg.role === 'user' ? '用户' : '助手'}] ${msg.content}`)
    .join('\n');
}

function parseModelJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

async function fallback(input, status, error, modelName = '', rawReply = '') {
  const result = await fillTemplateSlotsMock(input);
  recordDegrade('llm_fallback_mock', { detail: status || error || 'fallback', template_id: input.template_id || input.templateId });
  return {
    ...result,
    model_status: 'fallback_mock',
    model_used: modelName || 'mock',
    model_error: error || status,
    model_error_status: status,
    raw_reply: rawReply ? String(rawReply).slice(0, 1000) : '',
  };
}

function sanitizeShape(result = {}, input = {}) {
  const requestedTemplateId = validRequestedTemplateId(input);
  // 模型返回的 template_id 优先（如果在模板库中存在），否则回退到路由推荐的
  const modelTemplateId = (result.template_id || result.template_key || '').trim();
  const library = Array.isArray(input.template_library) ? input.template_library : [];
  const modelTemplateValid = modelTemplateId && library.some(item => item.id === modelTemplateId);
  const templateId = (modelTemplateValid ? modelTemplateId : '') || requestedTemplateId || '';
  const data = normalizeTemplateData(
    result.data && typeof result.data === 'object' ? result.data : {},
    templateId,
  );
  return {
    template_id: templateId,
    template_key: result.template_key || templateId,
    answer_text: result.answer_text || result.answer || '',
    answer: result.answer || result.answer_text || '',
    data,
    actions: Array.isArray(result.actions) ? result.actions : [],
    followup_suggestions: Array.isArray(result.followup_suggestions) ? result.followup_suggestions : [],
    compact_followups: Array.isArray(result.compact_followups) ? result.compact_followups : [],
    template_fit_notes: Array.isArray(result.template_fit_notes) ? result.template_fit_notes : [],
    model_status: result.model_status || 'ok',
    model_used: result.model_used || '',
  };
}

function normalizeTemplateData(data, templateId) {
  if (templateId !== 'weekly_plan') return data;
  const weekly = data.weekly_plan && typeof data.weekly_plan === 'object'
    ? { ...data.weekly_plan }
    : {};
  const rawItems = weekly.items ?? data.days ?? data.items ?? [];
  weekly.items = normalizeWeeklyItems(rawItems);
  if (!weekly.badge) weekly.badge = '\u4e00\u5468\u8ba1\u5212';
  if (!weekly.title) weekly.title = '\u4e03\u5929\u81b3\u98df\u8ba1\u5212';
  if (!weekly.summary) weekly.summary = data.summary || data.weekSummary || '\u6309\u5929\u5b89\u6392\u65e9\u9910\u3001\u5348\u9910\u3001\u665a\u9910\uff0c\u517c\u987e\u6e05\u6de1\u3001\u63a7\u7cd6\u548c\u6613\u6d88\u5316\u3002';
  return {
    ...data,
    weekly_plan: weekly,
  };
}

function normalizeWeeklyItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const normalized = items.map((item, index) => normalizeWeeklyItem(item, index));
  const defaults = defaultWeeklyItems();
  for (let i = normalized.length; i < 7; i += 1) normalized.push(defaults[i]);
  return normalized.slice(0, 7).map((item, index) => ({
    ...defaults[index],
    ...item,
    dayName: item.dayName || defaults[index].dayName,
    dayTotal: item.dayTotal || defaults[index].dayTotal,
    meals: ensureThreeMeals(item.meals, defaults[index].meals),
  }));
}

function normalizeWeeklyItem(item, index) {
  if (typeof item === 'string') {
    return { dayName: dayNames()[index] || ('Day ' + (index + 1)), itemText: item, meals: [] };
  }
  if (!item || typeof item !== 'object') {
    return { dayName: dayNames()[index] || ('Day ' + (index + 1)), itemText: String(item ?? ''), meals: [] };
  }
  return {
    dayName: item.dayName || item.day || item.date || dayNames()[index] || ('Day ' + (index + 1)),
    summary: item.summary || item.note || item.description || '',
    itemText: item.itemText || item.text || '',
    meals: normalizeWeeklyMeals(item.meals || item.mealList || []),
  };
}

function normalizeWeeklyMeals(rawMeals) {
  const meals = Array.isArray(rawMeals) ? rawMeals : rawMeals ? [rawMeals] : [];
  return meals.map((meal) => {
    if (typeof meal === 'string') return { mealName: '', foods: meal, mealCal: '' };
    if (!meal || typeof meal !== 'object') return { mealName: '', foods: String(meal ?? ''), mealCal: '' };
    return {
      mealName: meal.mealName || meal.name || meal.type || '',
      foods: Array.isArray(meal.foods)
        ? meal.foods.map((food) => typeof food === 'string' ? food : food?.foodName || food?.name || '').filter(Boolean).join('\u3001')
        : meal.foods || meal.foodText || '',
      mealCal: meal.mealCal || meal.cal || meal.calories || '',
    };
  });
}

function ensureThreeMeals(rawMeals, fallbackMeals) {
  const meals = normalizeWeeklyMeals(rawMeals);
  const byName = new Map(meals.map((meal) => [meal.mealName, meal]));
  return fallbackMeals.map((fallback) => ({
    ...fallback,
    ...(byName.get(fallback.mealName) || {}),
  }));
}

function defaultWeeklyItems() {
  return [
    weeklyDay('\u5468\u4e00', '\u71d5\u9ea6\u5c0f\u7c73\u7ca5\u3001\u9e21\u86cb', '\u6742\u7cae\u996d\u3001\u6e05\u84b8\u9c7c\u3001\u9752\u83dc', '\u756a\u8304\u8c46\u8150\u6c64\u3001\u65f6\u852c'),
    weeklyDay('\u5468\u4e8c', '\u65e0\u7cd6\u8c46\u6d46\u3001\u5168\u9ea6\u9992\u5934', '\u9e21\u80f8\u8089\u7096\u51ac\u74dc\u3001\u7cd9\u7c73\u996d', '\u5357\u74dc\u5c0f\u7c73\u7ca5\u3001\u8c46\u8150\u9752\u83dc'),
    weeklyDay('\u5468\u4e09', '\u5c0f\u7c73\u7ca5\u3001\u84b8\u86cb', '\u7cd9\u7c73\u996d\u3001\u8c46\u8150\u9752\u83dc', '\u6e05\u84b8\u9c7c\u3001\u6cb9\u9ea6\u83dc'),
    weeklyDay('\u5468\u56db', '\u71d5\u9ea6\u7ca5\u3001\u51c9\u62cc\u9ec4\u74dc', '\u6742\u7cae\u996d\u3001\u7626\u8089\u7096\u841d\u535c', '\u7d2b\u83dc\u86cb\u82b1\u6c64\u3001\u65f6\u852c'),
    weeklyDay('\u5468\u4e94', '\u65e0\u7cd6\u8c46\u6d46\u3001\u7389\u7c73', '\u6e05\u84b8\u9c7c\u3001\u897f\u5170\u82b1', '\u8c46\u8150\u6c64\u3001\u9752\u83dc'),
    weeklyDay('\u5468\u516d', '\u5357\u74dc\u7ca5\u3001\u9e21\u86cb', '\u6742\u7cae\u996d\u3001\u51ac\u74dc\u867e\u4ec1', '\u5c0f\u7c73\u7ca5\u3001\u65f6\u852c'),
    weeklyDay('\u5468\u65e5', '\u71d5\u9ea6\u7ca5\u3001\u84b8\u86cb', '\u7cd9\u7c73\u996d\u3001\u6e05\u7096\u9e21\u8089', '\u756a\u8304\u8c46\u8150\u6c64\u3001\u9752\u83dc'),
  ];
}

function weeklyDay(dayName, breakfast, lunch, dinner) {
  return {
    dayName,
    dayTotal: '\u7ea61200kcal',
    summary: '\u4e3b\u98df\u5b9a\u91cf\uff0c\u5c11\u6cb9\u5c11\u76d0\uff0c\u642d\u914d\u4f18\u8d28\u86cb\u767d\u3002',
    itemText: '',
    meals: [
      { mealName: '\u65e9\u9910', mealEmoji: '\ud83c\udf05', foods: breakfast, mealCal: '\u7ea6300kcal' },
      { mealName: '\u5348\u9910', mealEmoji: '\u2600\ufe0f', foods: lunch, mealCal: '\u7ea6520kcal' },
      { mealName: '\u665a\u9910', mealEmoji: '\ud83c\udf19', foods: dinner, mealCal: '\u7ea6430kcal' },
    ],
  };
}

function dayNames() {
  return ['\u5468\u4e00', '\u5468\u4e8c', '\u5468\u4e09', '\u5468\u56db', '\u5468\u4e94', '\u5468\u516d', '\u5468\u65e5'];
}
function validRequestedTemplateId(input = {}) {
  const requested = input.template_id || input.templateId || '';
  if (!requested) return '';
  const library = Array.isArray(input.template_library) ? input.template_library : [];
  return library.some((item) => item.id === requested) ? requested : '';
}
