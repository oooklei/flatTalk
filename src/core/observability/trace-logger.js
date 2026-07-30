import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
export const TRACE_LOG = path.join(DATA_DIR, 'query-trace.log');

/**
 * 将时间格式化为北京时间字符串 yyyy-mm-dd hh24:mi:ss
 * 无论服务器时区如何，均按 UTC+8 输出。
 */
export function formatBeijingTime(date = new Date()) {
  const d = new Date(date.getTime() + date.getTimezoneOffset() * 60000 + 8 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

let writer = null;
function ensureWriter() {
  fs.mkdirSync(path.dirname(TRACE_LOG), { recursive: true });
  if (!writer) {
    writer = fs.createWriteStream(TRACE_LOG, { flags: 'a', encoding: 'utf8' });
  }
  return writer;
}

/**
 * 问题追踪日志：每个聊天/动作问题一条记录，内含全环节耗时与路由信息。
 * 记录为 JSON 行，读取时按时间倒序返回（最新在前）。
 */
export function getTraceLogger() {
  return {
    logPath: TRACE_LOG,
    write(entry) {
      const now = new Date();
      const rec = {
        ts: now.toISOString(),
        ts_ms: now.getTime(),
        ts_bj: formatBeijingTime(now),
        ...entry,
      };
      try {
        ensureWriter().write(JSON.stringify(rec) + '\n');
      } catch {
        /* 记录失败不应影响主流程 */
      }
    },
    list({ limit = 500 } = {}) {
      if (!fs.existsSync(TRACE_LOG)) return [];
      const lines = fs.readFileSync(TRACE_LOG, 'utf8').split('\n').filter(Boolean);
      const out = [];
      for (const ln of lines) {
        try { out.push(JSON.parse(ln)); } catch { /* 跳过损坏行 */ }
      }
      out.reverse(); // 倒序：最新在前
      return limit ? out.slice(0, limit) : out;
    },
    clear() {
      try { if (fs.existsSync(TRACE_LOG)) fs.writeFileSync(TRACE_LOG, ''); } catch { /* ignore */ }
    },
  };
}
