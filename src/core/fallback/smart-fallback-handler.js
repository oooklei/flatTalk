import { loadPrompt } from '../model-runtime/prompt-loader.js';
import { callOpenAiCompatibleModel } from '../model-runtime/openai-compatible-client.js';
import { pickChatModel, publicModelName } from '../model-runtime/model-registry.js';

const SCENE_LABELS = {
  meal_plan: '膳食推荐',
  travel_route: '旅居规划',
  health_risk_warning: '健康风险预警',
  find_service: '养老服务发现与匹配',
  dispatch_manage: '派单与工单调度',
  nearby_resource: '周边资源地图',
  common: '通用咨询',
};

const SCENE_DEGRADED_TEXT = {
  meal_plan: '膳食助手暂时繁忙，您可以直接告诉我老人的饮食偏好（如清淡、控糖、易消化），我会尽力为您推荐。',
  travel_route: '旅居助手暂时繁忙，您可以直接告诉我目的地、出行时间或预算，我会尽力为您规划。',
  health_risk_warning: '健康预警助手暂时繁忙，请描述老人的具体症状或健康指标，我会尽快为您分析。',
  find_service: '服务推荐助手暂时繁忙，您可以告诉我需要什么类型的服务（如上门护理、助餐、清洁），我会为您查找。',
  dispatch_manage: '派单系统暂时繁忙，请稍后重试或联系工作人员。',
  nearby_resource: '周边资源助手暂时繁忙，请告诉我您想查找的资源类型（如餐饮、住宿、医疗），我会为您搜索。',
  common: '助手暂时繁忙，请稍后重试或换个问题。',
};

export function createSmartFallbackHandler(options = {}) {
  const modelClient = options.modelClient;

  return {
    shouldFallback(modelResult = {}) {
      if (modelResult.model_status === 'fallback_mock') return true;
      const notes = Array.isArray(modelResult.template_fit_notes) ? modelResult.template_fit_notes : [];
      if (notes.includes('fallback_common_answer')) return true;
      const answerText = String(modelResult.answer_text || '').trim();
      if (answerText.startsWith('抱歉')) return true;
      return false;
    },

    async generateNaturalAnswer(input = {}) {
      const skillKey = input.skill_key || 'common';
      const skillLabel = SCENE_LABELS[skillKey] || '通用咨询';
      const history = Array.isArray(input.conversation_history) ? input.conversation_history : [];

      if (modelClient && modelClient.model) {
        try {
          const promptText = loadPrompt('template-card/free-answer.md', {
            user_message: input.message || '',
            skill_label: skillLabel,
            conversation_history: formatHistoryForPrompt(history),
          });

          const messages = [
            { role: 'system', content: '你是桂小养养老助手。直接输出自然语言回答，不要输出JSON或代码。' },
            ...history.slice(-6),
            { role: 'user', content: promptText },
          ];

          const response = await callOpenAiCompatibleModel(modelClient.model, messages, {
            fetchImpl: modelClient.fetchImpl,
            timeoutMs: options.timeoutMs || 30000,
            maxTokens: modelClient.model.max_tokens || 2000,
            temperature: 0.5,
          });
          if (response.ok && response.content) {
            const answerText = response.content.trim();
            return {
              template_id: 'answer',
              answer_text: answerText,
              answer: answerText,
              data: {
                title: '桂小养答复',
                skill_name: skillLabel,
                answer_text: answerText,
                answer: answerText,
              },
              actions: [],
              followup_suggestions: [],
              model_status: 'smart_fallback',
              model_used: publicModelName(modelClient.model),
            };
          }
        } catch {
          // fall through to degraded text
        }
      }

      const degradedText = SCENE_DEGRADED_TEXT[skillKey] || SCENE_DEGRADED_TEXT.common;
      return {
        template_id: 'answer',
        answer_text: degradedText,
        answer: degradedText,
        data: {
          title: '桂小养答复',
          skill_name: skillLabel,
          answer_text: degradedText,
          answer: degradedText,
        },
        actions: [],
        followup_suggestions: [],
        model_status: 'smart_fallback',
        model_used: 'degraded',
      };
    },
  };
}

function formatHistoryForPrompt(history = []) {
  if (!history.length) return '无';
  return history
    .map((msg) => `[${msg.role === 'user' ? '用户' : '助手'}] ${msg.content}`)
    .join('\n');
}
