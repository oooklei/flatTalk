import { INTENT_TYPES, URGENCY_LEVELS } from './schema.js';
import { analyzeTone } from './tone-analysis.js';

export const LEVEL_1 = ['救命', '昏迷', '晕倒', '不能呼吸', '喘不过气', '胸痛', '中风', '抽搐', '大出血', 'SOS', 'sos', '120', '999', '急救', '求救', '救护车', '叫救护车', '打120'];
export const LEVEL_2 = ['摔倒', '头晕', '心慌', '发烧', '高烧', '剧痛', '呕吐', '血压很高', '血糖很高', '不舒服', '很难受', '撑不住', '快不行了', '呼吸困难'];

export function detectEmergency(input = {}) {
  const text = String(input.text || input.message || '').trim();
  const tone = input.tone_analysis || input.toneAnalysis || analyzeTone({ text, asr_context: input.asr_context || input.asrContext || {} });
  const level1 = LEVEL_1.filter((word) => text.includes(word));
  const level2 = LEVEL_2.filter((word) => text.includes(word));

  if (level1.length > 0) {
    return {
      matched: true,
      intent_type: INTENT_TYPES.SOS,
      confidence: 0.95,
      urgency_level: URGENCY_LEVELS.P0,
      urgency_reason: `命中一级紧急关键词：${level1.join('、')}`,
      keyword_match: level1,
      tone_analysis: tone,
      classification_path: 'emergency_bypass',
    };
  }

  if (level2.length > 0 && tone.urgency_score >= 0.45) {
    return {
      matched: true,
      intent_type: INTENT_TYPES.SOS,
      confidence: 0.88,
      urgency_level: URGENCY_LEVELS.P0,
      urgency_reason: `命中二级紧急关键词且语气急迫：${level2.join('、')}`,
      keyword_match: level2,
      tone_analysis: tone,
      classification_path: 'emergency_bypass',
    };
  }

  if (level2.length > 0) {
    return {
      matched: true,
      intent_type: INTENT_TYPES.HEALTH,
      confidence: 0.76,
      urgency_level: URGENCY_LEVELS.P1,
      urgency_reason: `命中健康风险关键词：${level2.join('、')}`,
      keyword_match: level2,
      tone_analysis: tone,
      classification_path: 'normal',
    };
  }

  return {
    matched: false,
    keyword_match: [],
    tone_analysis: tone,
  };
}
