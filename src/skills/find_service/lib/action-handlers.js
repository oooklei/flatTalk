// src/skills/find_service/lib/action-handlers.js
/**
 * find_service action → template 映射表。
 * 与 action-dispatcher.js L111-123 保持一致。
 */

export const FIND_SERVICE_ACTION_MAP = {
  'find_service.recommend':       'service_recommend',
  'find_service.catalog':         'service_catalog',
  'find_service.detail_service':  'service_detail',
  'find_service.list_orgs':       'org_profile',
  'find_service.list_workers':    'worker_profile',
  'find_service.detail_order':    'order_status',
  'find_service.preview_order':   'order_preview',
  'find_service.booking_confirm': 'service_booking_confirm',
  'find_service.booking_success': 'booking_success',
  'find_service.contact_confirm': 'contact_confirm',
  'find_service.order_ticket':    'service_order_ticket',
  'find_service.booking_reschedule': 'booking_reschedule',
};

export function getTemplateForAction(actionKey) {
  return FIND_SERVICE_ACTION_MAP[actionKey] || 'service_recommend';
}
