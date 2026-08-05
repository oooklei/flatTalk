/**
 * 桂小养订单服务（继承方案B基类）
 *
 * 职责：包装 gxy-order-sdk（同步/分页/详情/时间轴），运行时取数后
 * 自动写入 find_service 技能本地知识库（interface_cache/guangxi_order_index.json）
 *
 * 用法：
 *   const svc = createOrderService({ secret, apiUrl });
 *   const page = await svc.getOrderPage({ elderId });
 *   // 命中真实数据时已自动入库
 */
import * as orderSdk from '../../third/order/gxy-order-sdk.js';
import { BaseInterfaceService } from '../interface-base.js';
import { getTagSystemBiz } from '../interface-data/tag-system-biz.js';

const DEFAULT_API_URL = 'https://aiyl-m.yunxida.com/backend-api/portal-api';
const DEFAULT_SECRET = 'sign_U9IAnIMAFv';

export class OrderService extends BaseInterfaceService {
  constructor(config = {}) {
    super({
      skillKey: 'find_service',
      provider: 'guangxi_order',
      sourcePath: '桂小养订单',
      config,
    });
    orderSdk.init({
      secret: config.secret || process.env.ORDER_SECRET || DEFAULT_SECRET,
      apiUrl: config.apiUrl || process.env.ORDER_API_URL || DEFAULT_API_URL,
      timeout: Number(config.timeout || process.env.ORDER_TIMEOUT_MS || 10000),
    });
  }

  async getOrderPage(payload = {}) {
    const res = await orderSdk.page(payload);
    if (res.ok) {
      this.capture([{
        id: `order_page_${payload.elderId || 'unknown'}`,
        type: 'order_page',
        data: res.data,
        capturedAt: new Date().toISOString(),
      }]);
    }
    return res;
  }

  async syncOrder(payload = {}) {
    const res = await orderSdk.sync(payload);
    if (res.ok) {
      this.capture([{
        id: `order_sync_${payload.elderId || 'unknown'}_${payload.category || ''}_${payload.orderId || ''}`,
        type: 'order_sync',
        data: res.data,
        capturedAt: new Date().toISOString(),
      }]);
      // 双写：下单（桂小养同步）后，同步落库 tag-system.service_order（原数据逻辑之外的权威业务表）
      // 失败不影响主流程（降级兜底：上面已写入本地知识库）
      try {
        const biz = getTagSystemBiz();
        const r = await biz.createServiceOrder({
          order_id: payload.orderId || payload.order_id,
          order_no: payload.orderNo || payload.order_no,
          org_id: payload.orgId || payload.org_id,
          elder_id: payload.elderId || payload.elder_id,
          nurse_id: payload.nurseId || payload.nurse_id,
          service_provider_id: payload.serviceProviderId || payload.service_provider_id,
          service_item: payload.serviceItem || payload.service_item || payload.category,
          service_type: payload.serviceType || payload.service_type,
          order_amount: payload.amount || payload.order_amount,
          order_status: payload.orderStatus || payload.order_status,
          pay_status: payload.payStatus || payload.pay_status,
          start_time: payload.startTime || payload.start_time,
          end_time: payload.endTime || payload.end_time,
          remark: payload.remark,
        });
        if (!r.ok) {
          console.warn('[order] tag-system service_order 双写失败（已降级）:', r.error);
        }
      } catch (e) {
        console.warn('[order] tag-system service_order 双写异常（已降级）:', e && e.message);
      }
    }
    return res;
  }

  async getOrderDetail(orderId) {
    const res = await orderSdk.getDetail(orderId);
    if (res.ok) {
      this.capture([{
        id: `order_${orderId}`,
        type: 'order_detail',
        data: res.data,
        capturedAt: new Date().toISOString(),
      }]);
    }
    return res;
  }

  /**
   * 订单时间轴：同时覆盖工单(workorder)与消息(message)，统一入库。
   */
  async getOrderTimeline(orderId) {
    const res = await orderSdk.getTimeline(orderId);
    if (res.ok) {
      const records = [];
      const payload = res.data?.data || res.data || {};
      const workOrders = payload.workOrders || payload.workorders || [];
      const messages = payload.messages || [];
      if (Array.isArray(workOrders) && workOrders.length) {
        workOrders.forEach((w, i) => records.push({
          id: `order_${orderId}_workorder_${w.workOrderId || w.orderNo || i}`,
          type: 'order_workorder',
          data: w,
          capturedAt: new Date().toISOString(),
        }));
      }
      if (Array.isArray(messages) && messages.length) {
        messages.forEach((m, i) => records.push({
          id: `order_${orderId}_message_${m.id || m.messageId || i}`,
          type: 'order_message',
          data: m,
          capturedAt: new Date().toISOString(),
        }));
      }
      if (!records.length) {
        records.push({
          id: `order_${orderId}_timeline`,
          type: 'order_timeline',
          data: payload,
          capturedAt: new Date().toISOString(),
        });
      }
      this.capture(records);
    }
    return res;
  }

  /**
   * 找服务后"下单"：优先直写 tag-system.service_order，
   * 无论 tag-system 是否成功，都回写本地知识库（原 SDK/本地逻辑，降级兜底）。
   *
   * @param {object} orderData 订单数据
   *   { order_id?, org_id, elder_id, nurse_id, service_provider_id,
   *     service_item, service_type?, order_amount, order_status?, pay_status?,
   *     start_time?, end_time?, remark?, rating?, evaluate_content?, ... }
   * @returns {Promise<{ok:boolean, source:string, order_id:string, order_no:string, error?:string}>}
   */
  async placeOrder(orderData = {}) {
    let source = 'local';
    let bizErr = null;
    let orderId = orderData.order_id || `SO${Date.now()}`;
    let orderNo = orderData.order_no || '';
    try {
      const biz = getTagSystemBiz();
      const r = await biz.createServiceOrder(orderData);
      if (r.ok) {
        source = 'tag_system';
        orderId = r.order_id;
        orderNo = r.order_no;
      } else {
        bizErr = r.error;
      }
    } catch (e) {
      bizErr = e && e.message ? e.message : String(e);
    }
    // 降级兜底：原始数据逻辑（本地知识库落地），保证下单数据不丢
    this.capture([{
      id: `order_place_${orderId}`,
      type: 'order_place',
      data: { ...orderData, order_id: orderId, order_no: orderNo, tsBiz: source },
      capturedAt: new Date().toISOString(),
    }]).catch(() => {});
    return { ok: true, source, order_id: orderId, order_no: orderNo, error: bizErr || undefined };
  }

  /**
   * 服务质量评价 - 订单评价：直写 tag-system.service_order 评价字段，
   * 并回写本地知识库（降级兜底）。
   */
  async evaluateOrder({ orderId, rating, evaluate_content, evaluate_tags, comment_type, order_status } = {}) {
    if (!orderId) return { ok: false, error: 'orderId 必填' };
    let source = 'local';
    let bizErr = null;
    try {
      const biz = getTagSystemBiz();
      const r = await biz.saveOrderEvaluation(orderId, { rating, evaluate_content, evaluate_tags, comment_type, order_status });
      if (r.ok) source = 'tag_system';
      else bizErr = r.error;
    } catch (e) {
      bizErr = e && e.message ? e.message : String(e);
    }
    this.capture([{
      id: `order_eval_${orderId}`,
      type: 'order_evaluation',
      data: { order_id: orderId, rating, evaluate_content, evaluate_tags, comment_type, order_status, tsBiz: source },
      capturedAt: new Date().toISOString(),
    }]).catch(() => {});
    return { ok: true, source, order_id: orderId, error: bizErr || undefined };
  }
}

export function createOrderService(config = {}) {
  return new OrderService(config);
}
