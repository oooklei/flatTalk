// 派单管理类卡片：dispatch_list / dispatch_detail / work_order / dispatch_status。
// dispatch_accept / dispatch_reject / dispatch_transfer / dispatch_supplier_action 走 extra-template-fills。

import { sanitizeModelResult } from './utils.js';
import { pickByLockedId, withEntityParams, dispatchEntityParams } from '../conversation/entity-params.js';

function fillDispatchManageCard({ message, business_data, selectedTemplateId }) {
  const bd = business_data || {};
  const dispatches = Array.isArray(bd.dispatch_orders) ? bd.dispatch_orders : [];
  const orders = Array.isArray(bd.orders) ? bd.orders : [];
  const tpl = selectedTemplateId || 'dispatch_list';
  const d = pickByLockedId(dispatches, bd.dispatch_id, ['dispatch_id', 'id'], { allowFallback: !bd.dispatch_id }) || {};
  const o = pickByLockedId(orders, bd.order_id || d.order_id, ['order_id', 'id'], {
    allowFallback: !(bd.order_id || d.order_id),
  }) || {};
  const entityBase = dispatchEntityParams({
    dispatchId: d.dispatch_id,
    orderId: o.order_id || d.order_id,
    worker_id: d.worker_id || '',
    elder_id: bd.elder_id || o.elder_id || '',
  }, bd);

  if (tpl === 'dispatch_detail') {
    const answerText = `派单 ${d.dispatch_id || ''} 当前状态：${d.status || '待接单'}。`;
    return sanitizeModelResult({
      template_id: 'dispatch_detail',
      answer_text: answerText, answer: answerText,
      data: {
        dispatchId: d.dispatch_id || '', orderId: d.order_id || '', workerName: d.worker_name || '',
        skill: d.skill_tag || '', status: d.status || '待接单', createdAt: d.created_at || '',
        acceptedAt: d.accepted_at || '', rejectedReason: d.rejected_reason || '',
        dispatch_id: d.dispatch_id || '', order_id: d.order_id || '',
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '返回列表', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
        { label: '查看进度', user_prompt: '帮我查看这条派单的进度', action_key: 'dispatch_manage.status' },
      ], entityBase),
      template_fit_notes: [],
    });
  }

  if (tpl === 'work_order') {
    const linked = pickByLockedId(dispatches, bd.dispatch_id, ['dispatch_id', 'id'])
      || dispatches.find((x) => x.order_id === o.order_id)
      || {};
    const answerText = `工单 ${o.order_id || ''}：${o.service_name || ''}，状态 ${o.status || ''}。`;
    return sanitizeModelResult({
      template_id: 'work_order',
      answer_text: answerText, answer: answerText,
      data: {
        orderId: o.order_id || '', elderName: o.elder_name || '', serviceName: o.service_name || '',
        orgName: o.org_name || '', status: o.status || '', expectedTime: o.expected_time || '',
        linkedDispatch: linked.dispatch_id || '',
        order_id: o.order_id || '', dispatch_id: linked.dispatch_id || '',
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '查派单进度', user_prompt: '帮我查看这条派单的进度', action_key: 'dispatch_manage.status' },
        { label: '返回列表', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
      ], {
        ...entityBase,
        dispatch_id: linked.dispatch_id || entityBase.dispatch_id,
        order_id: o.order_id || entityBase.order_id,
      }),
      template_fit_notes: [],
    });
  }

  if (tpl === 'dispatch_status') {
    const answerText = `派单 ${d.dispatch_id || ''} 状态已更新为「${d.status || ''}」。`;
    return sanitizeModelResult({
      template_id: 'dispatch_status',
      answer_text: answerText, answer: answerText,
      data: {
        dispatchId: d.dispatch_id || '', status: d.status || '', changedAt: d.accepted_at || d.created_at || '',
        note: d.rejected_reason || '状态正常流转',
        dispatch_id: d.dispatch_id || '',
      },
      actions: [],
      followup_suggestions: withEntityParams([
        { label: '返回派单列表', user_prompt: '查看派单列表', action_key: 'dispatch_manage.list' },
      ], entityBase),
      template_fit_notes: [],
    });
  }

  const pending = dispatches.filter((x) => x.status === '待接单').length;
  const answerText = `当前共有 ${dispatches.length} 条派单，其中 ${pending} 条待接单。`;
  return sanitizeModelResult({
    template_id: 'dispatch_list',
    answer_text: answerText, answer: answerText,
    data: {
      total: dispatches.length, pending,
      dispatch_id: d.dispatch_id || '',
      order_id: d.order_id || '',
      orders: dispatches.map((x) => ({
        dispatchId: x.dispatch_id, orderId: x.order_id, workerName: x.worker_name,
        skill: x.skill_tag, status: x.status, createdAt: x.created_at,
      })),
    },
    actions: [],
    followup_suggestions: withEntityParams([
      { label: '派单详情', user_prompt: '查看派单详情', action_key: 'dispatch_manage.detail' },
      { label: '查看进度', user_prompt: '帮我查看这条派单的进度', action_key: 'dispatch_manage.status' },
      { label: '查看工单', user_prompt: '查看对应的服务工单', action_key: 'dispatch_manage.work_order' },
    ], entityBase),
    template_fit_notes: [],
  });
}

export {
  fillDispatchManageCard,
};
