// src/skills/dispatch_manage/lib/action-handlers.js
/**
 * dispatch_manage action → template 映射表。
 * 与 action-dispatcher.js L125-133 保持一致。
 */

export const DISPATCH_ACTION_MAP = {
  'dispatch_manage.detail':   'dispatch_detail',
  'dispatch_manage.work_order': 'work_order',
  'dispatch_manage.status':   'dispatch_status',
  'dispatch_manage.accept':   'dispatch_accept',
  'dispatch_manage.reject':   'dispatch_reject',
  'dispatch_manage.transfer': 'dispatch_transfer',
  'dispatch_manage.supplier': 'dispatch_supplier_action',
  'dispatch_manage.list':     'dispatch_list',
};

export function getTemplateForAction(actionKey) {
  return DISPATCH_ACTION_MAP[actionKey] || 'dispatch_list';
}
