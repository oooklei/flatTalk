// src/third/gxy/feedback-client.js
/**
 * 桂小养反馈意见客户端。
 * 移植自 AI对接包-v3/backend/app/clients/gxy_feedback.py
 *
 * 接口：
 *   POST /openapi/feedback/submit — 提交反馈
 *   POST /openapi/feedback/page   — 分页查询反馈列表
 */

import { createGxyClient } from './base-client.js';

export const FEEDBACK_TYPE = {
  COURSE: 'course', ACTIVITY: 'activity', FACILITY: 'facility',
  SERVICE: 'service', SYSTEM: 'system', OTHER: 'other',
};

export const FEEDBACK_SOURCE = { APP: 'app', WEB: 'web' };

export function createFeedbackClient(config) {
  const client = createGxyClient(config);

  async function submit(payload) {
    return client.post('/openapi/feedback/submit', payload);
  }

  async function page(payload) {
    return client.post('/openapi/feedback/page', payload);
  }

  return { submit, page };
}
