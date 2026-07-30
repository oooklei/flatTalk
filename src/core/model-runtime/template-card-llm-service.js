import { fillTemplateSlots as fillTemplateSlotsMock } from '../model-service.js';
import { pickChatModel, publicModelName } from './model-registry.js';
import { callOpenAiCompatibleModel } from './openai-compatible-client.js';
import { loadPrompt } from './prompt-loader.js';
import { createKnowledgeDataService } from '../../services/knowledge-data/index.js';

export function createTemplateCardModelService(options = {}) {
  const mode = options.modelMode || process.env.FLATTALK_MODEL_MODE || 'admin';
  const useMock = mode === 'mock' || options.runtimeMode === 'test';
  const knowledgeService = options.knowledgeService || createKnowledgeDataService();

  return {
    async fillTemplateSlots(input = {}) {
      if (useMock || shouldUseDeterministicTemplate(input)) {
        const result = await fillTemplateSlotsMock({ ...input, knowledgeService });
        return { ...result, model_status: useMock ? 'mock' : 'local_template', model_used: useMock ? 'mock' : 'local_template' };
      }

      const model = pickChatModel({ registryPath: options.registryPath, modelId: options.modelId });
      if (!model) return fallback(input, 'no_available_model', '未找到可用 admin 模型');

      const messages = buildMessages(input);
      const response = await callOpenAiCompatibleModel(model, messages, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
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
  };
}

function shouldUseDeterministicTemplate(input = {}) {
  const templateId = input.template_id || input.templateId || '';
  return input.skill_key === 'travel_route'
    || input.skill_key === 'health_risk_warning'
    || templateId === 'route_card'
    || templateId === 'health_warning_card'
    || templateId === 'health_risk_signal_card'
    || templateId === 'health_risk_rule_card'
    || templateId === 'policy_card'
    || templateId === 'weekly_plan'
    || templateId === 'diet_card';
}

function buildMessages(input) {
  const system = loadPrompt('template-card/system.md');
  const user = loadPrompt('template-card/fill-template.md', {
    user_message: input.message || '',
    intent_context: input.intent_context || {},
    skill_key: input.skill_key || '',
    requested_template_id: input.template_id || input.templateId || '',
    template_library: input.template_library || [],
    evidence: input.evidence || [],
    business_data: input.business_data || {},
  });
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
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
  const templateId = requestedTemplateId || result.template_id || result.template_key || '';
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
