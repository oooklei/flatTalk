import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
/** P0：默认不仿真；仅 FLATTALK_ALLOW_SIM_FALLBACK=1（或质量分开关）时允许演示仿真。 */
const ALLOW_SIM_FALLBACK = process.env.FLATTALK_ALLOW_SIM_FALLBACK === '1'
  || process.env.FLATTALK_QUALITY_ALLOW_SIM_FALLBACK === '1';
const DISABLE_SIM_FALLBACK = process.env.FLATTALK_DISABLE_SIM_FALLBACK === '1'
  || process.env.FLATTALK_QUALITY_DISABLE_SIM_FALLBACK === '1';
const useSimFallback = ALLOW_SIM_FALLBACK && !DISABLE_SIM_FALLBACK;
/** SHOULD：本地 interface_cache 默认不冒充现网；显式允许才用。 */
const ALLOW_LOCAL_QUALITY_CACHE = process.env.FLATTALK_ALLOW_LOCAL_QUALITY_CACHE === '1'
  || process.env.FLATTALK_QUALITY_ALLOW_LOCAL_CACHE === '1';

function readLocalIndex(skillKey, provider) {
  const file = path.join(ROOT, 'src', 'skills', skillKey, 'knowledge', 'interface_cache', `${provider}_index.json`);
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class QualityMetricsService {
  constructor({ tagSystemBiz } = {}) {
    this.biz = tagSystemBiz || null;
  }

  async getEvaluation(filter = {}) {
    if (this.biz) {
      const remote = await this.biz.getEvaluationRecords(filter);
      if (remote.ok && Array.isArray(remote.rows) && remote.rows.length) {
        return {
          ok: true,
          source: 'tag_system',
          data: remote.rows,
          rowCount: remote.rowCount,
          method: remote.method,
          url: remote.url,
          sql: remote.sql,
        };
      }
    }

    const local = this._fallbackEvaluation(filter);
    if (local.length && ALLOW_LOCAL_QUALITY_CACHE) {
      return {
        ok: true,
        source: 'local',
        stale: true,
        data: local,
        rowCount: local.length,
        method: 'LOCAL',
        url: 'local://quality_evaluation',
        sql: null,
        degradeNote: 'tag-system 不可达，已使用本地缓存（stale，FLATTALK_ALLOW_LOCAL_QUALITY_CACHE）',
      };
    }
    if (useSimFallback) {
      const data = buildSimulatedEvaluation(filter);
      return {
        ok: true,
        source: 'simulated_fallback',
        data,
        rowCount: data.length,
        method: 'LOCAL',
        url: 'local://quality_evaluation',
        sql: null,
        degradeNote: '演示模式：已启用服务质量仿真样本（FLATTALK_ALLOW_SIM_FALLBACK）',
      };
    }
    return {
      ok: false,
      source: local.length ? 'local_cache_blocked' : 'unavailable',
      data: [],
      rowCount: 0,
      method: 'LOCAL',
      url: 'local://quality_evaluation',
      sql: null,
      degradeNote: local.length
        ? 'tag-system 不可达；本地质量缓存已禁用（设 FLATTALK_ALLOW_LOCAL_QUALITY_CACHE=1 可启用）'
        : 'tag-system 不可达且本地无质量数据，已禁止仿真回填',
    };
  }

  async getServiceOrderEvaluation(orderId) {
    if (this.biz) {
      const remote = await this.biz.getServiceOrderEvaluation(orderId);
      if (remote.ok && remote.data) return { ok: true, source: 'tag_system', data: remote.data };
    }
    const local = this._fallbackEvaluation({ orderId, limit: 1 });
    if (local[0] && ALLOW_LOCAL_QUALITY_CACHE) {
      return {
        ok: true,
        source: 'local',
        stale: true,
        data: local[0],
        degradeNote: '服务质量评价已使用本地缓存（stale）',
      };
    }
    if (useSimFallback) {
      const data = buildSimulatedEvaluation({ orderId, limit: 1 })[0] || null;
      return {
        ok: Boolean(data),
        source: data ? 'simulated_fallback' : 'local_empty',
        data,
        degradeNote: data ? '演示模式：服务质量评价仿真样本' : '未找到服务质量评价数据',
      };
    }
    return {
      ok: false,
      source: local[0] ? 'local_cache_blocked' : 'unavailable',
      data: null,
      degradeNote: local[0]
        ? '本地质量缓存已禁用（FLATTALK_ALLOW_LOCAL_QUALITY_CACHE）'
        : '未找到服务质量评价数据，已禁止仿真回填',
    };
  }

  _fallbackEvaluation(filter = {}) {
    const orders = readLocalIndex('find_service', 'guangxi_order');
    const out = [];
    for (const rec of orders) {
      const d = rec.data || rec;
      if (filter.orderId && d.order_id !== filter.orderId && d.orderId !== filter.orderId) continue;
      if (filter.elderId && d.elder_id !== filter.elderId && d.elderId !== filter.elderId) continue;
      if (filter.orgId && d.org_id !== filter.orgId && d.orgId !== filter.orgId) continue;
      out.push({ source: 'local', ...d });
    }
    const limit = Math.min(Math.max(parseInt(filter.limit, 10) || 50, 1), 500);
    return out.slice(0, limit);
  }

  async getFeedbackMetrics(filter = {}) {
    if (this.biz) {
      const metrics = await this.biz.getFeedbackMetrics(filter);
      if (metrics.ok && metrics.data && (metrics.data.total > 0 || (Array.isArray(metrics.data.by_type) && metrics.data.by_type.length))) {
        const list = await this.biz.listFeedback({ ...filter, limit: filter.limit || 100 });
        return {
          ok: true,
          source: 'tag_system',
          metrics: metrics.data,
          samples: list.ok ? list.rows : [],
          method: metrics.method || list.method,
          url: metrics.url || list.url,
          sql: metrics.sql || list.sql,
        };
      }
    }

    const local = this._fallbackFeedback(filter);
    if (local.metrics.total && ALLOW_LOCAL_QUALITY_CACHE) {
      return {
        ok: true,
        source: 'local',
        stale: true,
        metrics: local.metrics,
        samples: local.samples,
        method: 'LOCAL',
        url: 'local://feedback_metrics',
        sql: null,
        degradeNote: 'tag-system 不可达，已使用本地缓存（stale）',
      };
    }
    if (useSimFallback) {
      const simulated = buildSimulatedFeedback(filter);
      return {
        ok: true,
        source: 'simulated_fallback',
        metrics: simulated.metrics,
        samples: simulated.samples,
        method: 'LOCAL',
        url: 'local://feedback_metrics',
        sql: null,
        degradeNote: '演示模式：已启用投诉反馈仿真样本（FLATTALK_ALLOW_SIM_FALLBACK）',
      };
    }
    return {
      ok: false,
      source: local.metrics.total ? 'local_cache_blocked' : 'unavailable',
      metrics: { total: 0, avg_rating: null, handled: 0, by_type: [] },
      samples: [],
      method: 'LOCAL',
      url: 'local://feedback_metrics',
      sql: null,
      degradeNote: local.metrics.total
        ? '本地投诉缓存已禁用（FLATTALK_ALLOW_LOCAL_QUALITY_CACHE）'
        : 'tag-system 不可达且本地无投诉反馈，已禁止仿真回填',
    };
  }

  _fallbackFeedback(filter = {}) {
    const feedback = readLocalIndex('find_service', 'guangxi_feedback');
    let samples = feedback.map((rec) => rec.data || rec);
    if (filter.feedbackType) samples = samples.filter((s) => s.feedback_type === filter.feedbackType);
    if (filter.orgId) samples = samples.filter((s) => s.org_id === filter.orgId);
    const total = samples.length;
    const rated = samples.filter((s) => typeof s.rating === 'number');
    const avg = rated.length ? round2(rated.reduce((sum, item) => sum + item.rating, 0) / rated.length) : null;
    const handled = samples.filter((s) => ['已处理', '已关闭'].includes(s.status)).length;
    const byType = countBy(samples, 'feedback_type').map(([feedback_type, cnt]) => ({ feedback_type, cnt }));
    return {
      metrics: {
        total,
        rated_count: rated.length,
        avg_rating: avg,
        handled_count: handled,
        handled_rate: total ? round3(handled / total) : 0,
        by_type: byType,
        by_status: countBy(samples, 'status').map(([status, cnt]) => ({ status, cnt })),
        by_handler: [],
      },
      samples: samples.slice(0, filter.limit ? Number(filter.limit) : 100),
    };
  }
}

export function createQualityMetricsService(options = {}) {
  return new QualityMetricsService(options);
}

function buildSimulatedEvaluation(filter = {}) {
  const now = new Date().toISOString();
  const orgId = filter.orgId || 'org_jialu_001';
  const elderId = filter.elderId || 'elder_demo_001';
  const rows = [
    {
      source: 'simulated_fallback',
      order_id: filter.orderId || 'SO_SIM_20260801001',
      order_no: 'DD20260801001',
      service_item: '上门护理',
      service_type: 'doorstep_nurse',
      service_item_name: '上门护理服务',
      elder_id: elderId,
      elder_name: '示例老人',
      org_id: orgId,
      org_name: '嘉路康养中心',
      nurse_id: 'staff_sim_001',
      nurse_name: '陈护工',
      order_rating: 5,
      evaluate_content: '服务准时，态度耐心，护理过程说明清楚。',
      evaluate_tags: '服务态度好,准时到达,耐心细致',
      comment_type: '好评',
      evaluate_time: now,
      work_id: 'WO_SIM_20260801001',
      work_order_no: 'GD20260801001',
      staff_id: 'staff_sim_001',
      staff_name: '陈护工',
      staff_role: '护理员',
      staff_type: 'WORKER',
      work_type: 'nurse',
      work_status: '已完成',
      work_rating: 5,
      service_summary: '按计划完成血压记录、协助洗漱和环境整理。',
      service_suggestion: '继续保持准时到达，补充服务前后照片留痕。',
      service_log: '接单-到达-服务-离开-评价链路完整。',
      exception_type: '',
      chief_complaint: '',
      dispatch_time: now,
      finish_time: now,
    },
    {
      source: 'simulated_fallback',
      order_id: 'SO_SIM_20260801002',
      order_no: 'DD20260801002',
      service_item: '巡访关怀',
      service_type: 'patrol_task',
      service_item_name: '巡访关怀服务',
      elder_id: elderId,
      elder_name: '示例老人',
      org_id: orgId,
      org_name: '嘉路康养中心',
      nurse_id: 'staff_sim_002',
      nurse_name: '李社工',
      order_rating: 4,
      evaluate_content: '服务完成，但到达时间略晚。',
      evaluate_tags: '沟通清晰,迟到',
      comment_type: '中评',
      evaluate_time: now,
      work_id: 'WO_SIM_20260801002',
      work_order_no: 'GD20260801002',
      staff_id: 'staff_sim_002',
      staff_name: '李社工',
      staff_role: '社工',
      staff_type: 'WORKER',
      work_type: 'patrol',
      work_status: '已完成',
      work_rating: 4,
      service_summary: '完成入户巡访与安全隐患记录。',
      service_suggestion: '建议加强预约时间提醒和迟到原因记录。',
      service_log: '接单-延迟到达-服务-回访。',
      exception_type: '迟到',
      chief_complaint: '',
      dispatch_time: now,
      finish_time: now,
    },
  ];
  const limit = Math.min(Math.max(parseInt(filter.limit, 10) || 50, 1), 500);
  return rows.slice(0, limit);
}

function buildSimulatedFeedback(filter = {}) {
  const now = new Date().toISOString();
  const orgId = filter.orgId || 'org_jialu_001';
  const samples = [
    {
      feedback_id: 'FB_SIM_20260801001',
      feedback_type: '投诉',
      title: '上门护理到达延迟',
      content: '预约时间后约 20 分钟到达，希望提前告知。',
      status: '已处理',
      rating: 3,
      org_id: orgId,
      org_name: '嘉路康养中心',
      user_name: '示例家属',
      handle_by: '机构管理员',
      handle_result: '已向服务人员复盘并补充到达提醒。',
      source: 'simulated_fallback',
      create_time: now,
      handle_time: now,
    },
    {
      feedback_id: 'FB_SIM_20260801002',
      feedback_type: '表扬',
      title: '护理员服务耐心',
      content: '护理员沟通清楚，老人配合度高。',
      status: '已关闭',
      rating: 5,
      org_id: orgId,
      org_name: '嘉路康养中心',
      user_name: '示例老人',
      handle_by: '系统归档',
      handle_result: '纳入正向评价标签。',
      source: 'simulated_fallback',
      create_time: now,
      handle_time: now,
    },
  ];
  return {
    metrics: {
      total: samples.length,
      rated_count: samples.length,
      avg_rating: 4,
      handled_count: samples.length,
      handled_rate: 1,
      by_type: [
        { feedback_type: '投诉', cnt: 1, avg_rating: 3 },
        { feedback_type: '表扬', cnt: 1, avg_rating: 5 },
      ],
      by_status: [
        { status: '已处理', cnt: 1 },
        { status: '已关闭', cnt: 1 },
      ],
      by_handler: [
        { handler_id: 'admin_sim_001', handle_by: '机构管理员', cnt: 1, avg_rating: 3 },
        { handler_id: 'system', handle_by: '系统归档', cnt: 1, avg_rating: 5 },
      ],
    },
    samples,
  };
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || '';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()];
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function round3(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
