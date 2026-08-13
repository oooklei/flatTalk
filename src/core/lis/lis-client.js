/**
 * Thin HTTP client for LIS-System (/v1/sort, /v1/boundary, /v1/clarify).
 *
 * 超时是必须的：LIS 门控在 identifyScene 之前同步执行，
 * 若 LIS 挂起不响应，chat 请求会一直阻塞（实测过，fetch 无默认超时）。
 * 超时后抛错，由 lis-gate-hook 的 catch 降级到 scene-router，用户无感。
 */

/** 默认超时（毫秒）。LIS 正常分拣在 10ms 级，2s 已极宽松。 */
const DEFAULT_TIMEOUT_MS = 2000;

export function createLisClient({ baseUrl, fetchImpl = fetch, timeoutMs } = {}) {
  const root = String(
    baseUrl
    || process.env.LIS_BASE_URL
    || process.env.FLATTALK_LIS_BASE_URL
    || 'http://127.0.0.1:8100',
  ).replace(/\/$/, '');

  const limit = Number(timeoutMs ?? process.env.LIS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  async function post(op, path, body) {
    // AbortController 保证请求不会无限挂起
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    let res;
    try {
      res = await fetchImpl(`${root}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(`LIS ${op} timeout after ${limit}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // 带上响应体，否则排障时看不到 LIS 返回的错误详情。
      // 注意消息前缀保持 `LIS <op> <status>`，已有测试依赖该格式。
      let detail = '';
      try {
        detail = typeof res.text === 'function' ? (await res.text()).slice(0, 300) : '';
      } catch {
        // 读 body 失败不应掩盖原始状态码
      }
      throw new Error(`LIS ${op} ${res.status}${detail ? ` ${detail}` : ''}`);
    }
    return res.json();
  }

  return {
    async sort(body) {
      return post('sort', '/v1/sort', body);
    },
    async boundary(body) {
      return post('boundary', '/v1/boundary', body);
    },
    async clarify(body) {
      return post('clarify', '/v1/clarify', body);
    },
    /**
     * 探测 LIS 是否可达（GET /health）。
     *
     * 用途：部署/排障时确认「LIS 到底起没起、用的哪个打分器」，
     * 而不必先发一条聊天消息再猜。不参与聊天主流程，故不计入熔断。
     *
     * @returns {Promise<{reachable: boolean, latency_ms: number, error?: string,
     *                    scorer?: string, encoder?: string, lis_version?: string}>}
     */
    async probe() {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limit);
      try {
        const res = await fetchImpl(`${root}/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!res.ok) {
          return {
            reachable: false,
            latency_ms: Date.now() - started,
            error: `HTTP ${res.status}`,
          };
        }
        const body = await res.json();
        return {
          reachable: true,
          latency_ms: Date.now() - started,
          scorer: body?.scorer,
          encoder: body?.encoder,
          lis_version: body?.version,
        };
      } catch (err) {
        const aborted = err?.name === 'AbortError';
        return {
          reachable: false,
          latency_ms: Date.now() - started,
          error: aborted ? `timeout after ${limit}ms` : String(err?.message || err),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
