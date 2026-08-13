/**
 * 异步写入队列 — 知识库持久化解耦层
 *
 * 目标：把"写入本地知识库 JSON 文件"从主请求链路中剥离，
 * 前端立即响应，写入在后台异步执行。
 *
 * 特性：
 *  - 内存队列 + 串行消费（避免并发写同一文件冲突）
 *  - 失败自动重试（最多 3 次，间隔 2s/4s/8s 指数退避）
 *  - 内容指纹去重（相同内容不重复写盘）
 *  - 进程退出时 flush 剩余任务（best-effort）
 */
import crypto from 'node:crypto';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000];

class WriteQueue {
  constructor() {
    this._queue = [];
    this._processing = false;
    this._fingerprints = new Map(); // key -> contentHash，避免重复入队
  }

  /**
   * 推入写入任务（非阻塞，立即返回）
   * @param {Function} task - async () => { ... } 实际写入逻辑
   * @param {string} dedupKey - 去重键（如 "travel_route/jintiaodong"）
   * @param {string} hash - 内容指纹，相同则跳过
   */
  enqueue(task, dedupKey = '', hash = '') {
    // 内容指纹去重：队列中已有相同指纹的任务则跳过
    if (dedupKey && hash) {
      const existing = this._fingerprints.get(dedupKey);
      if (existing === hash) {
        return; // 内容无变化，跳过
      }
      this._fingerprints.set(dedupKey, hash);
    }

    this._queue.push({ task, dedupKey, hash, retries: 0 });
    this._process();
  }

  async _process() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const item = this._queue.shift();
      try {
        await item.task();
        // 写入成功，清除指纹记录
        if (item.dedupKey) this._fingerprints.delete(item.dedupKey);
      } catch (err) {
        if (item.retries < MAX_RETRIES) {
          const delay = RETRY_DELAYS[item.retries] || 8000;
          item.retries++;
          console.warn(
            `[WRITE-QUEUE] 写入失败(${item.retries}/${MAX_RETRIES})，${delay}ms 后重试: ${err.message}`
          );
          // 延迟后重新入队
          setTimeout(() => {
            this._queue.unshift(item);
            this._process();
          }, delay);
          this._processing = false;
          return; // 等待重试，暂停处理
        } else {
          console.error(
            `[WRITE-QUEUE] 写入彻底失败(已重试${MAX_RETRIES}次)，放弃: ${err.message}`
          );
          if (item.dedupKey) this._fingerprints.delete(item.dedupKey);
        }
      }
    }
    this._processing = false;
  }

  /** 等待队列清空（用于测试） */
  async drain(timeoutMs = 5000) {
    const start = Date.now();
    while (this._queue.length > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  get pending() {
    return this._queue.length;
  }
}

// 单例
export const writeQueue = new WriteQueue();

/**
 * 计算记录数组的内容指纹（排除元数据字段）
 */
export function contentHash(records) {
  if (!Array.isArray(records) || records.length === 0) return '';
  const cleaned = records.map((r) => {
    const { _captured_at, _source, ...payload } = r || {};
    return payload;
  });
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(cleaned))
    .digest('hex')
    .slice(0, 16);
}

// 进程退出时尽力 flush（防止数据丢失）
let flushing = false;
async function flushOnExit() {
  if (flushing) return;
  flushing = true;
  await writeQueue.drain(3000);
}
process.on('beforeExit', flushOnExit);
process.on('SIGINT', async () => {
  await flushOnExit();
  process.exit(0);
});
