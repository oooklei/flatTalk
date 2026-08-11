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

// order-service 和 workorder-service 将在后续任务中创建
// 取消注释以下导出在 Task 9/10 完成后
// export {
//   syncOrder,
//   getOrderDetail,
//   getOrderPage,
//   cancelOrder,
//   evaluateOrder,
//   getOrderTimeline,
// } from './order-service.js';

// export {
//   syncWorkorder,
//   getWorkorderDetail,
//   getWorkorderPage,
//   cancelWorkorder,
//   getWorkorderProgress,
//   getWorkorderTimeline,
// } from './workorder-service.js';

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
