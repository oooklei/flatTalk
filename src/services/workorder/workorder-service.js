/**
 * 桂小养工单服务（继承方案B基类）
 *
 * 职责：包装 gxy-workorder-sdk（同步/分页/详情/进度/时间轴），运行时取数后
 * 自动写入 dispatch_manage 技能本地知识库（interface_cache/guangxi_workorder_index.json）
 *
 * 用法：
 *   const svc = createWorkorderService({ secret, apiUrl });
 *   const page = await svc.getWorkorderPage({ elderId });
 *   // 命中真实数据时已自动入库
 */
import * as workorderSdk from '../../third/workorder/gxy-workorder-sdk.js';
import { BaseInterfaceService } from '../interface-base.js';
import { getTagSystemBiz } from '../interface-data/tag-system-biz.js';

const DEFAULT_API_URL = 'https://aiyl-m.yunxida.com/backend-api/portal-api';
const DEFAULT_SECRET = 'sign_U9IAnIMAFv';

export class WorkorderService extends BaseInterfaceService {
  constructor(config = {}) {
    super({
      skillKey: 'dispatch_manage',
      provider: 'guangxi_workorder',
      sourcePath: '桂小养工单',
      config,
    });
    workorderSdk.init({
      secret: config.secret || process.env.WORKORDER_SECRET || DEFAULT_SECRET,
      apiUrl: config.apiUrl || process.env.WORKORDER_API_URL || DEFAULT_API_URL,
      timeout: Number(config.timeout || process.env.WORKORDER_TIMEOUT_MS || 10000),
    });
  }

  async getWorkorderPage(payload = {}) {
    const res = await workorderSdk.page(payload);
    if (res.ok) {
      this.capture([{
        id: `workorder_page_${payload.elderId || 'unknown'}`,
        type: 'workorder_page',
        data: res.data,
        capturedAt: new Date().toISOString(),
      }]);
    }
    return res;
  }

  async syncWorkorder(payload = {}) {
    const res = await workorderSdk.sync(payload);
    if (res.ok) {
      this.capture([{
        id: `workorder_sync_${payload.orderNo || 'unknown'}_${payload.staffId || ''}`,
        type: 'workorder_sync',
        data: res.data,
        capturedAt: new Date().toISOString(),
      }]);
      // 双写：智能派单（桂小养同步）后，同步落库 tag-system.work_order（关联 order_id）
      try {
        const biz = getTagSystemBiz();
        const r = await biz.createWorkOrder({
          work_id: payload.workOrderId || payload.work_id,
          order_id: payload.orderNo || payload.order_id,
          org_id: payload.orgId || payload.org_id,
          elder_id: payload.elderId || payload.elder_id,
          staff_id: payload.staffId || payload.staff_id,
          staff_type: payload.staffType || payload.staff_type,
          work_type: payload.workType || payload.work_type,
          priority: payload.priority,
          work_status: payload.workStatus || payload.work_status,
          dispatch_time: payload.dispatchTime || payload.dispatch_time,
          accept_time: payload.acceptTime || payload.accept_time,
          finish_time: payload.finishTime || payload.finish_time,
          content: payload.content,
          result: payload.result,
          remark: payload.remark,
          chief_complaint: payload.chiefComplaint || payload.chief_complaint,
        });
        if (!r.ok) {
          console.warn('[workorder] tag-system work_order 双写失败（已降级）:', r.error);
        }
      } catch (e) {
        console.warn('[workorder] tag-system work_order 双写异常（已降级）:', e && e.message);
      }
    }
    return res;
  }

  async getWorkorderDetail(workOrderId) {
    const res = await workorderSdk.getDetail(workOrderId);
    if (res.ok) {
      this.capture([{
        id: `workorder_${workOrderId}`,
        type: 'workorder_detail',
        data: res.data,
        capturedAt: new Date().toISOString(),
      }]);
    }
    return res;
  }

  async getWorkorderProgress(workOrderId) {
    const res = await workorderSdk.getProgress(workOrderId);
    if (res.ok) {
      this.capture([{
        id: `workorder_${workOrderId}_progress`,
        type: 'workorder_progress',
        data: res.data,
        capturedAt: new Date().toISOString(),
      }]);
    }
    return res;
  }

  async getWorkorderTimeline(workOrderId) {
    const res = await workorderSdk.getTimeline(workOrderId);
    if (res.ok) {
      const records = [];
      const payload = res.data?.data || res.data || {};
      const messages = payload.messages || [];
      if (Array.isArray(messages) && messages.length) {
        messages.forEach((m, i) => records.push({
          id: `workorder_${workOrderId}_message_${m.id || m.messageId || i}`,
          type: 'workorder_message',
          data: m,
          capturedAt: new Date().toISOString(),
        }));
      }
      records.push({
        id: `workorder_${workOrderId}_timeline`,
        type: 'workorder_timeline',
        data: payload,
        capturedAt: new Date().toISOString(),
      });
      this.capture(records);
    }
    return res;
  }

  /**
   * 智能派单：优先直写 tag-system.work_order（order_id 关联 service_order），
   * 无论 tag-system 是否成功，都回写本地知识库（原 SDK/本地逻辑，降级兜底）。
   *
   * @param {object} workData 工单数据
   *   { work_id?, order_id, org_id, elder_id, staff_id, staff_type?,
   *     work_type?, priority?, work_status?, dispatch_time?, accept_time?,
   *     finish_time?, content?, result?, remark?, chief_complaint?, ... }
   * @returns {Promise<{ok:boolean, source:string, work_id:string, work_order_no:string, error?:string}>}
   */
  async dispatchWorkorder(workData = {}) {
    if (!workData.order_id) return { ok: false, error: 'order_id 必填（工单须关联订单）' };
    let source = 'local';
    let bizErr = null;
    let workId = workData.work_id || `WO${Date.now()}`;
    let workOrderNo = workData.work_order_no || '';
    try {
      const biz = getTagSystemBiz();
      const r = await biz.createWorkOrder(workData);
      if (r.ok) {
        source = 'tag_system';
        workId = r.work_id;
        workOrderNo = r.work_order_no;
      } else {
        bizErr = r.error;
      }
    } catch (e) {
      bizErr = e && e.message ? e.message : String(e);
    }
    // 降级兜底：原始数据逻辑（本地知识库落地）
    this.capture([{
      id: `workorder_dispatch_${workId}`,
      type: 'workorder_dispatch',
      data: { ...workData, work_id: workId, work_order_no: workOrderNo, tsBiz: source },
      capturedAt: new Date().toISOString(),
    }]).catch(() => {});
    return { ok: true, source, work_id: workId, work_order_no: workOrderNo, error: bizErr || undefined };
  }

  /**
   * 服务质量评价 - 工单评价：直写 tag-system.work_order 服务质量字段，
   * 并回写本地知识库（降级兜底）。
   */
  async completeWorkOrder({ workId, rating, service_summary, service_suggestion, service_log, exception_type, work_status } = {}) {
    if (!workId) return { ok: false, error: 'work_id 必填' };
    let source = 'local';
    let bizErr = null;
    try {
      const biz = getTagSystemBiz();
      const r = await biz.saveWorkOrderEvaluation(workId, { rating, service_summary, service_suggestion, service_log, exception_type, work_status });
      if (r.ok) source = 'tag_system';
      else bizErr = r.error;
    } catch (e) {
      bizErr = e && e.message ? e.message : String(e);
    }
    this.capture([{
      id: `workorder_complete_${workId}`,
      type: 'workorder_completion',
      data: { work_id: workId, rating, service_summary, service_suggestion, service_log, exception_type, work_status, tsBiz: source },
      capturedAt: new Date().toISOString(),
    }]).catch(() => {});
    return { ok: true, source, work_id: workId, error: bizErr || undefined };
  }
}

export function createWorkorderService(config = {}) {
  return new WorkorderService(config);
}
