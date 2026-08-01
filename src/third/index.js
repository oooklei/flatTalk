/**
 * 桂小养第三方 SDK 统一入口
 *
 * 使用方式:
 *   import GxyMessage from './third/message/gxy-message-sdk.js';
 *   import GxyOrder from './third/order/gxy-order-sdk.js';
 *   import GxyWorkOrder from './third/workorder/gxy-workorder-sdk.js';
 *
 * 或者统一入口:
 *   import { Message, Order, WorkOrder } from './third/index.js';
 */

export { default as Message } from './message/gxy-message-sdk.js';
export { default as Order } from './order/gxy-order-sdk.js';
export { default as WorkOrder } from './workorder/gxy-workorder-sdk.js';

// 重导出枚举常量
export { CATEGORY, URGENCY_LEVEL, DISPATCH_MODE, ORDER_SOURCE } from './order/gxy-order-sdk.js';
export { WORK_ORDER_STATUS, WORK_ORDER_TYPE, SERVICE_TYPE, CHECK_IN_TYPE } from './workorder/gxy-workorder-sdk.js';

// 重导出签名工具
export {
  sign,
  verify,
  sha256,
  hmacSha256,
  checkTimestamp,
  generateNonce,
  generateSignatureHeaders,
} from './lib/hmac-signature.js';