'use strict';

/**
 * 直连 tag-system 数据库的"业务数据"访问层。
 *
 * 目标表（位于 tag_system 库，由 build_orders_sim.py 建表并仿真）：
 *   - service_order  服务订单表（找服务后"下单"写入）
 *   - work_order     工单表（智能派单后写入）
 *   - feedback       投诉/建议/咨询/反馈/表扬表（服务质量指标计算来源）
 *
 * 设计原则：
 *   1. 所有方法返回 { ok: boolean, data?, error?, source? }，绝不向外抛异常，
 *      以便上层在数据库不可用时走"降级兜底"（原 SDK / 本地知识逻辑）。
 *   2. 连接信息取自环境变量 FLATTALK_TAG_SYSTEM_PG_URL（与 interface-data 中
 *      PgTagReader 共用同一数据库）。
 *   3. 写操作（下单/派单/评价）以 tag-system 为权威落库点；读操作（服务质量评价、
 *      投诉建议咨询指标）优先查 tag-system，失败则交由上层 fallback。
 */

import pg from 'pg';
const { Pool } = pg;

let _pool = null;
let _poolUrl = null;

function resolvePgUrl(override) {
  if (override) return override;
  return (
    process.env.FLATTALK_TAG_SYSTEM_PG_URL ||
    process.env.FLATTALK_PG_URL ||
    process.env.TAG_SYSTEM_PG_URL ||
    ''
  );
}

function getPool(pgUrl) {
  const url = resolvePgUrl(pgUrl);
  if (!url) {
    return null;
  }
  if (_pool && _poolUrl === url) {
    return _pool;
  }
  // 配置变化或首次创建时重建连接池（懒连接，不会立即建连）
  if (_pool) {
    _pool.end().catch(() => {});
  }
  _pool = new Pool({
    connectionString: url,
    max: 6,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 4000,
    application_name: 'flattalk_tag_system_biz',
  });
  _poolUrl = url;
  _pool.on('error', (err) => {
    // 连接池层面错误静默处理，避免未捕获异常导致进程退出
    if (process.env.FLATTALK_LOG_LEVEL !== 'silent') {
      console.warn('[tag-system-biz] pool error:', err && err.message);
    }
  });
  return _pool;
}

function ts(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') return value; // pg 接受 ISO 字符串
  if (typeof value === 'number') return new Date(value);
  return value;
}

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value, max) {
  if (value === undefined || value === null) return null;
  let s = String(value);
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

class TagSystemBiz {
  constructor({ pgUrl } = {}) {
    this.pgUrl = resolvePgUrl(pgUrl);
  }

  /** 统一查询封装：失败返回 ok:false，不抛异常。 */
  async query(text, params = []) {
    const pool = getPool(this.pgUrl);
    const sqlPreview = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!pool) {
      return {
        ok: false,
        error: 'tag-system pg url 未配置',
        rows: [],
        rowCount: 0,
        method: 'SQL',
        url: 'tag_system(PG)',
        sql: sqlPreview,
      };
    }
    let client;
    try {
      client = await pool.connect();
      const res = await client.query(text, params);
      return {
        ok: true,
        rows: res.rows,
        rowCount: res.rowCount,
        fields: res.fields,
        method: 'SQL',
        url: 'tag_system(PG)',
        sql: sqlPreview,
      };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : String(err),
        rows: [],
        rowCount: 0,
        method: 'SQL',
        url: 'tag_system(PG)',
        sql: sqlPreview,
      };
    } finally {
      if (client) client.release();
    }
  }

  /** 批量解析实体 id -> { entity_name, entity_type }（用于回填展示名称，避免只存 id）。 */
  async resolveEntityNames(ids) {
    const uniq = Array.from(new Set((ids || []).filter(Boolean)));
    if (!uniq.length) return {};
    const res = await this.query(
      'SELECT entity_id, entity_name, entity_type FROM entity_record WHERE entity_id = ANY($1)',
      [uniq]
    );
    if (!res.ok) return {};
    const map = {};
    for (const r of res.rows) {
      map[r.entity_id] = { entity_name: r.entity_name, entity_type: r.entity_type };
    }
    return map;
  }

  // ----------------------------------------------------------------
  // 1) 找服务后"下单" -> 写入 service_order
  // ----------------------------------------------------------------
  async createServiceOrder(order = {}) {
    const names = await this.resolveEntityNames([
      order.org_id, order.elder_id, order.nurse_id, order.service_provider_id,
    ]);
    const payload = {
      order_id: str(order.order_id) || `SO${Date.now()}`,
      org_id: str(order.org_id),
      elder_id: str(order.elder_id),
      nurse_id: str(order.nurse_id),
      service_provider_id: str(order.service_provider_id),
      order_no: str(order.order_no) || `DD${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(Math.random() * 1e6)}`,
      service_item: str(order.service_item, 128),
      service_type: str(order.service_type, 64),
      order_amount: num(order.order_amount),
      order_status: str(order.order_status, 32) || '待支付',
      pay_status: str(order.pay_status, 32) || '未支付',
      start_time: ts(order.start_time),
      end_time: ts(order.end_time),
      remark: str(order.remark, 255),
      elder_name: str(order.elder_name) || (names[order.elder_id] && names[order.elder_id].entity_name),
      org_name: str(order.org_name) || (names[order.org_id] && names[order.org_id].entity_name),
      nurse_name: str(order.nurse_name) || (names[order.nurse_id] && names[order.nurse_id].entity_name),
      service_provider_name: str(order.service_provider_name) || (names[order.service_provider_id] && names[order.service_provider_id].entity_name),
      service_item_name: str(order.service_item_name, 128) || str(order.service_item, 128),
      rating: num(order.rating),
      evaluate_content: str(order.evaluate_content, 1024),
      evaluate_time: ts(order.evaluate_time),
      evaluate_tags: str(order.evaluate_tags, 255),
      comment_type: str(order.comment_type, 64),
    };
    const cols = Object.keys(payload);
    const params = cols.map((c) => payload[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const sql = `INSERT INTO service_order (${cols.join(',')}, create_time, update_time, deleted)
                 VALUES (${placeholders.join(',')}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)`;
    const res = await this.query(sql, params);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, order_id: payload.order_id, order_no: payload.order_no, data: payload };
  }

  // ----------------------------------------------------------------
  // 2) 智能派单 -> 写入 work_order（order_id 关联 service_order）
  // ----------------------------------------------------------------
  async createWorkOrder(work = {}) {
    const names = await this.resolveEntityNames([work.org_id, work.elder_id, work.staff_id]);
    const payload = {
      work_id: str(work.work_id) || `WO${Date.now()}`,
      order_id: str(work.order_id),
      org_id: str(work.org_id),
      elder_id: str(work.elder_id),
      staff_id: str(work.staff_id),
      staff_type: str(work.staff_type, 32) || 'WORKER',
      work_type: str(work.work_type, 32),
      priority: str(work.priority, 16) || '中',
      work_status: str(work.work_status, 32) || '待派单',
      dispatch_time: ts(work.dispatch_time) || new Date(),
      accept_time: ts(work.accept_time),
      finish_time: ts(work.finish_time),
      content: str(work.content, 512),
      result: str(work.result, 512),
      remark: str(work.remark, 255),
      chief_complaint: str(work.chief_complaint, 255),
      work_order_no: str(work.work_order_no) || `GD${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(Math.random() * 1e6)}`,
      elder_name: str(work.elder_name) || (names[work.elder_id] && names[work.elder_id].entity_name),
      org_name: str(work.org_name) || (names[work.org_id] && names[work.org_id].entity_name),
      staff_name: str(work.staff_name) || (names[work.staff_id] && names[work.staff_id].entity_name),
      staff_role: str(work.staff_role, 32),
      rating: num(work.rating),
      service_summary: str(work.service_summary),
      service_suggestion: str(work.service_suggestion),
      service_log: str(work.service_log, 1000),
      exception_type: str(work.exception_type, 32),
    };
    const cols = Object.keys(payload);
    const params = cols.map((c) => payload[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const sql = `INSERT INTO work_order (${cols.join(',')}, create_time, update_time, deleted)
                 VALUES (${placeholders.join(',')}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)`;
    const res = await this.query(sql, params);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, work_id: payload.work_id, work_order_no: payload.work_order_no, data: payload };
  }

  // ----------------------------------------------------------------
  // 3) 服务质量评价 -> 评价字段写入 / 读取（订单表 + 工单表）
  // ----------------------------------------------------------------
  async saveOrderEvaluation(orderId, evalFields = {}) {
    if (!orderId) return { ok: false, error: 'orderId 必填' };
    const sets = [];
    const params = [];
    let i = 1;
    const add = (col, val) => { sets.push(`${col} = $${i}`); params.push(val); i += 1; };
    if (evalFields.rating !== undefined) add('rating', num(evalFields.rating));
    if (evalFields.evaluate_content !== undefined) add('evaluate_content', str(evalFields.evaluate_content, 1024));
    if (evalFields.evaluate_tags !== undefined) add('evaluate_tags', str(evalFields.evaluate_tags, 255));
    if (evalFields.comment_type !== undefined) add('comment_type', str(evalFields.comment_type, 64));
    if (evalFields.evaluate_time !== undefined) add('evaluate_time', ts(evalFields.evaluate_time));
    else if (evalFields.rating !== undefined) add('evaluate_time', new Date());
    if (evalFields.order_status) add('order_status', str(evalFields.order_status, 32));
    if (!sets.length) return { ok: false, error: '无可更新评价字段' };
    params.push(orderId);
    const sql = `UPDATE service_order SET ${sets.join(', ')}, update_time = CURRENT_TIMESTAMP WHERE order_id = $${i}`;
    const res = await this.query(sql, params);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, order_id: orderId };
  }

  async saveWorkOrderEvaluation(workId, evalFields = {}) {
    if (!workId) return { ok: false, error: 'work_id 必填' };
    const sets = [];
    const params = [];
    let i = 1;
    const add = (col, val) => { sets.push(`${col} = $${i}`); params.push(val); i += 1; };
    if (evalFields.rating !== undefined) add('rating', num(evalFields.rating));
    if (evalFields.service_summary !== undefined) add('service_summary', str(evalFields.service_summary));
    if (evalFields.service_suggestion !== undefined) add('service_suggestion', str(evalFields.service_suggestion));
    if (evalFields.service_log !== undefined) add('service_log', str(evalFields.service_log, 1000));
    if (evalFields.exception_type !== undefined) add('exception_type', str(evalFields.exception_type, 32));
    if (evalFields.work_status) add('work_status', str(evalFields.work_status, 32));
    if (!sets.length) return { ok: false, error: '无可更新评价字段' };
    params.push(workId);
    const sql = `UPDATE work_order SET ${sets.join(', ')}, update_time = CURRENT_TIMESTAMP WHERE work_id = $${i}`;
    const res = await this.query(sql, params);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, work_id: workId };
  }

  /**
   * 读取服务质量评价数据：从 service_order 关联其 work_order，
   * 取订单评价字段 + 工单服务质量字段（service_summary / rating / exception_type 等）。
   * filter: { orderId?, elderId?, orgId?, staffId?, limit? }
   */
  async getEvaluationRecords(filter = {}) {
    const where = ['o.deleted = 0'];
    const params = [];
    let i = 1;
    const add = (col, val) => { if (val !== undefined && val !== null && val !== '') { where.push(`o.${col} = $${i}`); params.push(val); i += 1; } };
    add('order_id', filter.orderId);
    add('elder_id', filter.elderId);
    add('org_id', filter.orgId);
    if (filter.staffId) {
      where.push(`(o.nurse_id = $${i} OR EXISTS (SELECT 1 FROM work_order w WHERE w.order_id = o.order_id AND w.staff_id = $${i}))`);
      params.push(filter.staffId); i += 1;
    }
    const limit = Math.min(Math.max(parseInt(filter.limit, 10) || 50, 1), 500);
    const sql = `
      SELECT
        o.order_id, o.order_no, o.service_item, o.service_type, o.service_item_name,
        o.order_amount, o.order_status, o.pay_status,
        o.start_time, o.end_time,
        o.elder_id, o.elder_name, o.org_id, o.org_name,
        o.nurse_id, o.nurse_name, o.service_provider_id, o.service_provider_name,
        o.rating AS order_rating, o.evaluate_content, o.evaluate_tags, o.comment_type, o.evaluate_time,
        w.work_id, w.work_order_no, w.staff_id, w.staff_name, w.staff_role, w.staff_type,
        w.work_type, w.work_status, w.rating AS work_rating,
        w.service_summary, w.service_suggestion, w.service_log, w.exception_type, w.chief_complaint,
        w.dispatch_time, w.finish_time
      FROM service_order o
      LEFT JOIN work_order w ON w.order_id = o.order_id AND w.deleted = 0
      WHERE ${where.join(' AND ')}
      ORDER BY o.create_time DESC
      LIMIT ${limit}`;
    const res = await this.query(sql, params);
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        rows: [],
        method: res.method,
        url: res.url,
        sql: res.sql,
      };
    }
    return {
      ok: true,
      rows: res.rows,
      rowCount: res.rowCount,
      method: res.method,
      url: res.url,
      sql: res.sql,
    };
  }

  /** 单订单评价汇总（订单评价 + 其工单评价列表）。 */
  async getServiceOrderEvaluation(orderId) {
    const res = await this.getEvaluationRecords({ orderId, limit: 200 });
    if (!res.ok) return res;
    const order = res.rows[0] || null;
    const works = res.rows.map((r) => ({
      work_id: r.work_id, work_order_no: r.work_order_no, staff_id: r.staff_id,
      staff_name: r.staff_name, staff_role: r.staff_role, work_type: r.work_type,
      work_status: r.work_status, work_rating: r.work_rating,
      service_summary: r.service_summary, service_suggestion: r.service_suggestion,
      service_log: r.service_log, exception_type: r.exception_type,
      dispatch_time: r.dispatch_time, finish_time: r.finish_time,
    })).filter((w) => w.work_id);
    return {
      ok: true,
      data: order ? {
        order_id: order.order_id, order_no: order.order_no, service_item: order.service_item,
        elder_name: order.elder_name, org_name: order.org_name, nurse_name: order.nurse_name,
        order_rating: order.order_rating, evaluate_content: order.evaluate_content,
        evaluate_tags: order.evaluate_tags, comment_type: order.comment_type,
        evaluate_time: order.evaluate_time, work_orders: works,
      } : null,
    };
  }

  // ----------------------------------------------------------------
  // 4) 投诉 / 建议 / 咨询 / 反馈 -> feedback 表服务质量指标计算
  // ----------------------------------------------------------------
  async getFeedbackMetrics(filter = {}) {
    const where = ['f.deleted = 0'];
    const params = [];
    let i = 1;
    const add = (col, val) => { if (val !== undefined && val !== null && val !== '') { where.push(`f.${col} = $${i}`); params.push(val); i += 1; } };
    add('org_id', filter.orgId);
    add('user_id', filter.userId);
    add('feedback_type', filter.feedbackType);
    add('status', filter.status);
    if (filter.handlerId) { where.push(`f.handler_id = $${i}`); params.push(filter.handlerId); i += 1; }
    if (filter.startDate) { where.push(`f.create_time >= $${i}`); params.push(filter.startDate); i += 1; }
    if (filter.endDate) { where.push(`f.create_time <= $${i}`); params.push(filter.endDate); i += 1; }

    const whereSql = where.join(' AND ');
    const base = `FROM feedback f WHERE ${whereSql}`;

    const metricsSql = `
      SELECT
        COUNT(*)::int                                             AS total,
        COUNT(f.rating)::int                                      AS rated_count,
        ROUND(AVG(f.rating) FILTER (WHERE f.rating IS NOT NULL), 2) AS avg_rating,
        COUNT(*) FILTER (WHERE f.status IN ('已处理','已关闭'))::int AS handled_count,
        ROUND(
          COUNT(*) FILTER (WHERE f.status IN ('已处理','已关闭'))::numeric /
          NULLIF(COUNT(*), 0), 3
        )                                                        AS handled_rate
      ${base}`;

    const byTypeSql = `
      SELECT f.feedback_type, COUNT(*)::int AS cnt,
             ROUND(AVG(f.rating) FILTER (WHERE f.rating IS NOT NULL), 2) AS avg_rating
      ${base} GROUP BY f.feedback_type ORDER BY cnt DESC`;

    const byStatusSql = `
      SELECT f.status, COUNT(*)::int AS cnt
      ${base} GROUP BY f.status ORDER BY cnt DESC`;

    const handlerSql = `
      SELECT f.handler_id, f.handle_by, COUNT(*)::int AS cnt,
             ROUND(AVG(f.rating) FILTER (WHERE f.rating IS NOT NULL), 2) AS avg_rating
      ${base} GROUP BY f.handler_id, f.handle_by ORDER BY cnt DESC LIMIT 10`;

    const [m, t, s, h] = await Promise.all([
      this.query(metricsSql, params),
      this.query(byTypeSql, params),
      this.query(byStatusSql, params),
      this.query(handlerSql, params),
    ]);
    if (!m.ok) {
      return {
        ok: false,
        error: m.error,
        method: m.method,
        url: m.url,
        sql: m.sql,
      };
    }
    return {
      ok: true,
      data: {
        total: (m.rows[0] && m.rows[0].total) || 0,
        rated_count: (m.rows[0] && m.rows[0].rated_count) || 0,
        avg_rating: (m.rows[0] && m.rows[0].avg_rating) || null,
        handled_count: (m.rows[0] && m.rows[0].handled_count) || 0,
        handled_rate: (m.rows[0] && m.rows[0].handled_rate) || 0,
        by_type: t.ok ? t.rows : [],
        by_status: s.ok ? s.rows : [],
        by_handler: h.ok ? h.rows : [],
      },
      method: m.method,
      url: m.url,
      sql: m.sql,
    };
  }

  /** 投诉建议咨询明细列表（含处理人/用户名称）。 */
  async listFeedback(filter = {}) {
    const where = ['f.deleted = 0'];
    const params = [];
    let i = 1;
    const add = (col, val) => { if (val !== undefined && val !== null && val !== '') { where.push(`f.${col} = $${i}`); params.push(val); i += 1; } };
    add('org_id', filter.orgId);
    add('feedback_type', filter.feedbackType);
    add('status', filter.status);
    const limit = Math.min(Math.max(parseInt(filter.limit, 10) || 100, 1), 1000);
    const sql = `
      SELECT f.feedback_id, f.feedback_type, f.title, f.content, f.contact,
             f.status, f.rating, f.org_name, f.user_name, f.handle_by,
             f.handle_result, f.reply_content, f.source, f.create_time, f.handle_time
      FROM feedback f
      WHERE ${where.join(' AND ')}
      ORDER BY f.create_time DESC
      LIMIT ${limit}`;
    const res = await this.query(sql, params);
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        rows: [],
        method: res.method,
        url: res.url,
        sql: res.sql,
      };
    }
    return {
      ok: true,
      rows: res.rows,
      rowCount: res.rowCount,
      method: res.method,
      url: res.url,
      sql: res.sql,
    };
  }

  async getServiceOrder(orderId) {
    return this.query('SELECT * FROM service_order WHERE order_id = $1 AND deleted = 0', [orderId]);
  }

  async getWorkOrder(workId) {
    return this.query('SELECT * FROM work_order WHERE work_id = $1 AND deleted = 0', [workId]);
  }

  /**
   * 读取 Tag-System 服务项目表 mobile_service_item，映射为 find_service 填槽字段。
   * filter: { orgId?, status?, limit? }
   */
  async listMobileServiceItems(filter = {}) {
    const where = ['COALESCE(deleted, 0) = 0'];
    const params = [];
    let i = 1;
    if (filter.orgId) {
      where.push(`org_id = $${i}`);
      params.push(filter.orgId);
      i += 1;
    }
    if (filter.status !== undefined && filter.status !== null && filter.status !== '') {
      where.push(`status = $${i}`);
      params.push(Number(filter.status));
      i += 1;
    } else {
      // 默认只要上架/启用；status 语义因源系统而异，非 0 且非禁用名视为可用
      where.push(`(status IS NULL OR status = 1 OR LOWER(COALESCE(status_name,'')) NOT IN ('停用','禁用','下架','deleted'))`);
    }
    const limit = Math.min(Math.max(parseInt(filter.limit, 10) || 200, 1), 1000);
    const sql = `
      SELECT service_item_id, item_code, item_name, service_type, service_type_name,
             org_id, org_name, org_type, org_type_name, price, unit, unit_name,
             duration, description, icon, category, category_name, sort, status,
             status_name, service_time, tag_list, sales_count, positive_review_rate
      FROM mobile_service_item
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(sort, 9999) ASC, COALESCE(sales_count, 0) DESC, item_name ASC
      LIMIT ${limit}`;
    const res = await this.query(sql, params);
    if (!res.ok) return { ok: false, error: res.error, rows: [], catalog: [], orgs: [] };

    const catalog = [];
    const orgMap = new Map();
    for (const r of res.rows) {
      const tags = Array.isArray(r.tag_list)
        ? r.tag_list.map((t) => (typeof t === 'string' ? t : t?.name || t?.label)).filter(Boolean)
        : [];
      // 分类优先 service_type_name（目录表主展示字段），其次 category_name
      const category = r.service_type_name || r.category_name || r.category || '其他';
      catalog.push({
        service_id: r.service_item_id,
        id: r.service_item_id,
        item_code: r.item_code || '',
        name: r.item_name || r.service_item_id,
        service_type: r.service_type || '',
        service_type_name: r.service_type_name || '',
        category,
        scene_tags: tags.length ? tags : [category].filter(Boolean),
        price_from: r.price != null ? Number(r.price) : 0,
        price: r.price != null ? Number(r.price) : 0,
        unit: r.unit_name || r.unit || '次',
        description: r.description || '',
        full_desc: r.description || '',
        summary: r.description || '',
        icon: r.icon || '🏠',
        time_range: r.service_time || '08:00-18:00',
        org_id: r.org_id || '',
        org_name: r.org_name || '',
        hotline: '',
        online_booking: true,
        rating: r.positive_review_rate != null ? Number(r.positive_review_rate) : undefined,
      });
      if (r.org_id && !orgMap.has(r.org_id)) {
        orgMap.set(r.org_id, {
          org_id: r.org_id,
          org_name: r.org_name || r.org_id,
          org_type: r.org_type_name || String(r.org_type || 'homecare'),
          address: '',
          service_scope: category,
          bed_count: 0,
          price_from: r.price != null ? Number(r.price) : 0,
          rating: r.positive_review_rate != null ? Number(r.positive_review_rate) : 4.5,
          certified: true,
        });
      }
    }
    return {
      ok: true,
      rows: res.rows,
      rowCount: res.rowCount,
      catalog,
      orgs: Array.from(orgMap.values()),
      source: 'tag_system.mobile_service_item',
    };
  }
}

// 单例：默认读环境变量配置；测试可传入 pgUrl 覆盖
let _singleton = null;
function getTagSystemBiz(pgUrl) {
  if (pgUrl) return new TagSystemBiz({ pgUrl });
  if (!_singleton) _singleton = new TagSystemBiz({});
  return _singleton;
}

export { TagSystemBiz, getTagSystemBiz };
