// src/services/gxy-platform/elder-service.js
/**
 * 老人服务：老人列表（PG user_center_user）+ 老人地址（GXY 平台 API）。
 * 移植自 AI对接包-v3/backend/app/services/elder_service.py
 */

import pg from 'pg';
import { createElderClient } from '../../third/gxy/elder-client.js';
import { ok, err } from './shared.js';

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:123456@localhost:5432/tag_system';

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  }
  return _pool;
}

/**
 * 查询老人列表。
 * @param {object} [opts] - { keyword, limit }
 * @returns {Promise<Array<{id,name,phone,account}>>}
 */
export async function listElders({ keyword, limit = 200 } = {}) {
  const pool = getPool();
  let sql = "SELECT user_id, user_name, user_phone, user_account FROM user_center_user WHERE entity_type = 'ELDER'";
  const params = [];
  if (keyword) {
    sql += ' AND (user_name ILIKE $1 OR user_account ILIKE $1 OR user_phone LIKE $1)';
    params.push(`%${keyword}%`);
  }
  sql += ' ORDER BY user_name LIMIT $' + (params.length + 1);
  params.push(limit);

  const { rows } = await pool.query(sql, params);
  return rows
    .map(r => ({
      id: String(r.user_id || '').trim(),
      name: String(r.user_name || '').trim() || String(r.user_id || '').trim(),
      phone: String(r.user_phone || '').trim(),
      account: String(r.user_account || '').trim(),
    }))
    .filter(e => e.id);
}

/**
 * 查询老人地址列表（含经纬度）。
 * @param {string} userId
 * @returns {Promise<{code,message,data}>}
 */
export async function listElderAddresses(userId) {
  if (!userId) {
    return err('FIELD_INVALID', '老人ID不能为空');
  }
  const client = createElderClient();
  const resp = await client.pageAddresses(userId);
  if (!resp.ok) {
    const data = resp.data;
    const message = (data && typeof data === 'object') ? (data.message || '调用桂小养平台失败') : '调用桂小养平台失败';
    return err('PLATFORM_ERROR', message);
  }
  const body = resp.data;
  const page = (body && typeof body === 'object') ? (body.result ?? body.data) : null;
  const records = (page && typeof page === 'object') ? (page.records || []) : [];
  return ok(records, '查询老人地址成功');
}
