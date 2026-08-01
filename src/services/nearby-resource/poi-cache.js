/**
 * POI Cache — 腾讯地图周边 POI 查询的内存缓存层
 *
 * 用于减少 nearby-augmentor 对腾讯地图 API 的重复调用。
 * 缓存粒度：坐标(4位小数) + 分类 + 半径。
 *
 * TTL 默认 30 分钟，可通过环境变量 FLATTALK_POI_CACHE_TTL（秒）配置；
 * 设为 0 可禁用缓存。
 *
 * 缓存为模块级（同一进程内跨请求共享）。
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 分钟

// 从环境变量解析 TTL（秒）；0 表示禁用，非法值回退默认值
function resolveTtlMs() {
  const raw = process.env.FLATTALK_POI_CACHE_TTL;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TTL_MS;
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < 0) return DEFAULT_TTL_MS;
  return sec * 1000;
}

const TTL_MS = resolveTtlMs();

// 模块级共享缓存：key → { data, ts }
const _store = new Map();

/**
 * 缓存是否被禁用（TTL=0）
 */
export function isDisabled() {
  return TTL_MS <= 0;
}

/**
 * 构造缓存 key
 * @param {number} lat
 * @param {number} lng
 * @param {string} category
 * @param {number} radius
 * @returns {string}
 */
export function makeKey(lat, lng, category, radius) {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}:${category}:${radius}`;
}

/**
 * 清理过期条目（在每次 get 时调用）
 */
export function cleanup() {
  if (TTL_MS <= 0) return;
  const now = Date.now();
  for (const [key, entry] of _store) {
    if (now - entry.ts >= TTL_MS) {
      _store.delete(key);
    }
  }
}

/**
 * 读取缓存
 * @param {string} key
 * @returns {*} 命中返回缓存数据，未命中/禁用返回 null
 */
export function get(key) {
  if (TTL_MS <= 0) return null;
  cleanup();
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts >= TTL_MS) {
    _store.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * 写入缓存
 * @param {string} key
 * @param {*} data
 */
export function set(key, data) {
  if (TTL_MS <= 0) return;
  _store.set(key, { data, ts: Date.now() });
}

/**
 * 清空全部缓存
 */
export function clear() {
  _store.clear();
}

/**
 * 当前缓存条目数（调试用）
 */
export function size() {
  return _store.size;
}

export default { isDisabled, makeKey, get, set, clear, cleanup, size };
