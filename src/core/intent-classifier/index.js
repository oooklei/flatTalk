import { detectEmergency } from './emergency-detector.js';
import { extractEntities } from './entity-extractor.js';
import { createIntentModelClient } from './model-client.js';
import { INTENT_THRESHOLDS } from './thresholds.js';
import { INTENT_TYPES, URGENCY_LEVELS, normalizeIntentContext } from './schema.js';

const HEALTH_WORDS = [
  '膳食', '饮食', '餐食', '饭菜', '早餐', '午餐', '晚餐', '糖尿病', '高血压',
  '控糖', '低盐', '营养', '健康', '血压', '血糖', '用药', '吞咽', '胸痛', '头晕', '不舒服',
];

const SERVICE_WORDS = [
  '办理', '办事', '补贴', '申请', '预约', '上门', '助餐', '送餐', '服务', '工单',
  '机构', '养老院', '政策', '指引', '长护险', '长期护理保险', '高龄津贴', '居家养老',
  '社区养老', '养老政策', '养老服务', '养老助手', '桂小养', '怎么用', '能做什么', '使用方法', '功能',
  '\u65c5\u5c45', '\u65c5\u6e38', '\u65c5\u884c', '\u5eb7\u517b', '\u65c5\u517b', '\u8def\u7ebf', '\u7ebf\u8def', '\u884c\u7a0b',
  '\u65c5\u884c\u8def\u7ebf', '\u65c5\u6e38\u8def\u7ebf', '\u65c5\u5c45\u8def\u7ebf', '\u5eb7\u517b\u8def\u7ebf',
  '\u89c4\u5212', '\u63a8\u8350', '\u5b89\u6392', '\u89c4\u5212\u8def\u7ebf', '\u89c4\u5212\u65c5\u5c45',
  '\u767e\u8272', '\u5df4\u9a6c', '\u5317\u6d77', '\u6842\u6797', '\u76ee\u7684\u5730', '\u4ea4\u901a\u63a5\u9a73',
  '\u9632\u57ce\u6e2f', '\u4eac\u65cf', '\u829f\u8857', '\u4e1c\u5174', '\u5341\u4e07\u5927\u5c71', '\u5609\u8def', '\u94f6\u53d1\u7231\u60c5', '\u8de8\u5883',
  '\u65c5\u5c45\u517b\u8001', '\u5eb7\u517b\u8def\u7ebf', '\u5c45\u65c5\u517b\u8001\u7ebf\u8def', '\u4e94\u6761\u65c5\u5c45\u7ebf\u8def', '\u5927\u672c\u8425', '\u836f\u81b3', '\u975e\u9057',
];

const CHAT_WORDS = ['你好', '谢谢', '再见', '你是谁', '聊天'];

export async function classifyIntent(input = {}, options = {}) {
  const startedAt = Date.now();
  const text = String(input.text || input.message || input.query || input.asr_context?.asr_text || '').trim();
  const asrConfidence = input.asr_confidence ?? input.asrContext?.asr_confidence ?? input.asr_context?.asr_confidence;
  const thresholds = { ...INTENT_THRESHOLDS, ...(options.thresholds || {}) };

  if (!text) {
    return normalizeIntentContext({
      intent_type: INTENT_TYPES.AMBIGUOUS,
      confidence: 0,
      urgency_level: URGENCY_LEVELS.P2,
      needs_clarification: true,
      classification_path: 'clarification',
      model_used: 'rules',
      model_path: ['input_validation'],
      processing_time: Date.now() - startedAt,
    });
  }

  if (Number.isFinite(Number(asrConfidence)) && Number(asrConfidence) < (options.minAsrConfidence ?? 0.5)) {
    return normalizeIntentContext({
      intent_type: INTENT_TYPES.AMBIGUOUS,
      confidence: 0,
      urgency_level: URGENCY_LEVELS.P2,
      needs_clarification: true,
      urgency_reason: 'ASR confidence too low',
      classification_path: 'clarification',
      model_used: 'input_validation',
      model_path: ['input_validation'],
      processing_time: Date.now() - startedAt,
    });
  }

  const modelClient = resolveModelClient(options);
  const toneAnalysis = await analyzeToneLayer({ ...input, text }, modelClient);
  const emergency = detectEmergency({ ...input, text, tone_analysis: toneAnalysis });
  if (emergency.matched && emergency.intent_type === INTENT_TYPES.SOS) {
    return normalizeIntentContext({
      ...emergency,
      tone_analysis: toneAnalysis || emergency.tone_analysis,
      entities: await extractEntitiesLayer({ ...input, text }, modelClient),
      model_used: 'emergency_keywords',
      model_path: ['emergency_keywords', toneAnalysis?.model_used || 'tone_rules'],
      processing_time: Date.now() - startedAt,
    });
  }

  const classified = await classifyWithModelLayers({ ...input, text }, modelClient, thresholds);
  const ruleEntities = extractEntities({ ...input, text });
  const modelEntities = await extractEntitiesLayer({ ...input, text }, modelClient);
  const final = determineIntent(classified, thresholds);

  if (emergency.matched && emergency.intent_type === INTENT_TYPES.HEALTH) {
    final.intent_type = INTENT_TYPES.HEALTH;
    final.urgency_level = URGENCY_LEVELS.P1;
    final.urgency_reason = emergency.urgency_reason;
  }

  return normalizeIntentContext({
    ...classified,
    ...final,
    entities: mergeEntities(ruleEntities, modelEntities),
    keyword_match: emergency.keyword_match || [],
    tone_analysis: toneAnalysis || emergency.tone_analysis,
    classification_path: final.needs_clarification ? 'clarification' : classified.classification_path || 'normal',
    processing_time: Date.now() - startedAt,
  });
}

async function classifyWithModelLayers(input, modelClient, thresholds) {
  const deterministic = classifyByRules(input.text, { model_path: ['rules'] });
  if (deterministic.intent_type === INTENT_TYPES.SERVICE && deterministic.confidence >= thresholds.service) {
    return deterministic;
  }

  if (!modelClient?.isConfigured?.()) {
    return deterministic;
  }

  const modelPath = [];
  let bertResult = null;
  try {
    bertResult = await modelClient.classifyWithBert?.(input);
    if (bertResult) modelPath.push('BERT-base');
  } catch (error) {
    modelPath.push(`BERT-base:error:${error.message}`);
  }

  if (bertResult && bertResult.confidence >= thresholds.lowConfidence) {
    return {
      ...bertResult,
      model_used: 'BERT-base',
      model_path: modelPath,
      classification_path: 'normal',
    };
  }

  let textCnnResult = null;
  try {
    textCnnResult = await modelClient.classifyWithTextCnn?.(input);
    if (textCnnResult) modelPath.push('TextCNN');
  } catch (error) {
    modelPath.push(`TextCNN:error:${error.message}`);
  }

  const selected = pickHigherConfidence(bertResult, textCnnResult);
  if (selected) {
    return {
      ...selected,
      model_used: selected === textCnnResult ? 'TextCNN' : 'BERT-base',
      model_path: modelPath,
      classification_path: selected.confidence >= thresholds.lowConfidence ? 'normal' : 'clarification',
    };
  }

  return classifyByRules(input.text, { model_path: [...modelPath, 'rules_fallback'] });
}

function classifyByRules(text, extra = {}) {
  const scores = scoreByRules(text);
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || [INTENT_TYPES.CHAT, 0.55];
  const confidence = top[1];
  const intentType = top[0];
  return normalizeIntentContext({
    intent_type: intentType,
    confidence,
    model_used: 'rules',
    model_path: extra.model_path || ['rules'],
    urgency_level: intentType === INTENT_TYPES.SOS ? URGENCY_LEVELS.P0 : intentType === INTENT_TYPES.CHAT ? URGENCY_LEVELS.P2 : URGENCY_LEVELS.P1,
    classification_path: confidence >= INTENT_THRESHOLDS.lowConfidence ? 'normal' : 'clarification',
  });
}

function determineIntent(classificationResult, thresholds) {
  const intentType = classificationResult.intent_type;
  const confidence = classificationResult.confidence;

  if (intentType === INTENT_TYPES.SOS && confidence >= thresholds.sos) {
    return { intent_type: INTENT_TYPES.SOS, urgency_level: URGENCY_LEVELS.P0, warning_level: 'red' };
  }
  if (intentType === INTENT_TYPES.HEALTH && confidence >= thresholds.health) {
    return { intent_type: INTENT_TYPES.HEALTH, urgency_level: URGENCY_LEVELS.P1, warning_level: 'yellow' };
  }
  if (intentType === INTENT_TYPES.SERVICE && confidence >= thresholds.service) {
    return { intent_type: INTENT_TYPES.SERVICE, urgency_level: URGENCY_LEVELS.P1, warning_level: 'green' };
  }
  if (confidence < thresholds.chat) {
    return { intent_type: INTENT_TYPES.CHAT, urgency_level: URGENCY_LEVELS.P2, warning_level: 'green' };
  }
  return {
    intent_type: INTENT_TYPES.AMBIGUOUS,
    urgency_level: URGENCY_LEVELS.P2,
    warning_level: 'green',
    needs_clarification: true,
  };
}

async function extractEntitiesLayer(input, modelClient) {
  if (!modelClient?.isConfigured?.()) return null;
  try {
    return await modelClient.extractEntities?.(input);
  } catch {
    return null;
  }
}

async function analyzeToneLayer(input, modelClient) {
  if (!modelClient?.isConfigured?.()) return null;
  try {
    const result = await modelClient.analyzeTone?.(input);
    return result ? { ...result, model_used: result.model_used || 'tone-analysis' } : null;
  } catch {
    return null;
  }
}

function resolveModelClient(options) {
  if (options.intentModelClient) return options.intentModelClient;
  if (options.modelClient) return options.modelClient;
  const client = createIntentModelClient(options.modelOptions || {});
  return client.isConfigured() ? client : null;
}

function pickHigherConfidence(first, second) {
  if (first && second) return second.confidence > first.confidence ? second : first;
  return first || second || null;
}

function scoreByRules(text) {
  const healthHits = countHits(text, HEALTH_WORDS);
  const serviceHits = countHits(text, SERVICE_WORDS);
  const chatHits = countHits(text, CHAT_WORDS);

  return {
    [INTENT_TYPES.HEALTH]: healthHits ? Math.min(0.95, 0.62 + healthHits * 0.08) : 0.2,
    [INTENT_TYPES.SERVICE]: serviceHits ? Math.min(0.92, 0.60 + serviceHits * 0.08) : 0.18,
    [INTENT_TYPES.CHAT]: chatHits ? 0.72 : Math.max(0.35, 0.58 - Math.max(healthHits, serviceHits) * 0.08),
    [INTENT_TYPES.SOS]: 0.05,
  };
}

function countHits(text, words) {
  return words.reduce((sum, word) => sum + (String(text || '').includes(word) ? 1 : 0), 0);
}

function mergeEntities(...entitySets) {
  const merged = {
    service_type: null,
    time: null,
    location: null,
    symptom: null,
    medication: null,
  };
  for (const entities of entitySets) {
    if (!entities) continue;
    for (const key of Object.keys(merged)) {
      if (!merged[key] && entities[key]) merged[key] = entities[key];
    }
  }
  return merged;
}
