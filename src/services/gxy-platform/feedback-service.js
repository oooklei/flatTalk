// src/services/gxy-platform/feedback-service.js
/**
 * 反馈意见服务。
 * 移植自 AI对接包-v3/backend/app/services/feedback_service.py
 * 注意：submit 接口平台侧已知故障（需登录上下文），代码写好等修复。
 */

import { createFeedbackClient } from '../../third/gxy/feedback-client.js';
import { ok, err, toPlatformResult } from './shared.js';

export async function submitFeedback(payload = {}) {
  if (!payload.feedbackType) {
    return err('FIELD_INVALID', '反馈类型(feedbackType)不能为空');
  }
  if (!payload.content) {
    return err('FIELD_INVALID', '反馈内容(content)不能为空');
  }
  const client = createFeedbackClient();
  const resp = await client.submit(payload);
  return toPlatformResult(resp, '反馈提交成功');
}

export async function pageFeedback(payload = {}) {
  const client = createFeedbackClient();
  const resp = await client.page(payload);
  return toPlatformResult(resp, '查询反馈列表成功');
}
