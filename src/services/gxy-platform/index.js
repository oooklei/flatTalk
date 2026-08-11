// src/services/gxy-platform/index.js
/**
 * GXY 平台服务统一出口。
 */

export {
  listElders,
  listElderAddresses,
} from './elder-service.js';

export {
  pageServiceItems,
  getServiceItemDetail,
} from './service-item-service.js';

export {
  syncOrder,
  getOrderDetail,
  getOrderPage,
  cancelOrder,
  evaluateOrder,
  getOrderTimeline,
} from './order-service.js';

export {
  syncWorkorder,
  getWorkorderDetail,
  getWorkorderPage,
  cancelWorkorder,
  getWorkorderProgress,
  getWorkorderTimeline,
} from './workorder-service.js';

export {
  submitFeedback,
  pageFeedback,
} from './feedback-service.js';

export {
  ok,
  err,
  toPlatformResult,
  generateOrderNo,
  generateWorkOrderNo,
  inferServiceType,
} from './shared.js';
