/**
 * LIS 调用可观测性与熔断。
 *
 * 解决两个真实缺口：
 *
 * 1. **失败静默**：原先三处 `catch {}` 完全无日志，LIS 宕机时
 *    只表现为"意图识别忽然不准了"，排障时看不到任何线索。
 *
 * 2. **无熔断**：LIS 挂掉后每个 chat 请求仍会去连一次，
 *    即使有 2s 超时，也等于给每个请求凭空加 2s 延迟。
 *    熔断后直接跳过调用，立即降级 scene-router。
 *
 * 设计取舍：熔断是**进程内**的，不跨实例共享。
 * 多实例部署时各自独立探测，这是刻意的——避免为此引入 Redis 依赖，
 * 且各实例到 LIS 的网络状况本就可能不同。
 */

import { recordDegrade } from '../observability/degradation-monitor.js';

/** 连续失败多少次后开启熔断 */
const FAILURE_THRESHOLD = 3;

/** 熔断持续时间（毫秒），之后允许一次试探请求 */
const COOLDOWN_MS = 30_000;

/**
 * 创建熔断器。
 *
 * 状态机：closed → (连续失败达阈值) → open → (冷却结束) → half-open
 *         half-open 成功 → closed；half-open 失败 → open（重新冷却）
 *
 * @param {{ threshold?: number, cooldownMs?: number, now?: () => number,
 *           logger?: { warn: Function, info: Function } }} [options]
 */
export function createLisBreaker({
  threshold = FAILURE_THRESHOLD,
  cooldownMs = COOLDOWN_MS,
  now = () => Date.now(),
  logger = console,
} = {}) {
  let consecutiveFailures = 0;
  let openedAt = 0;
  let halfOpen = false;
  let suppressedCount = 0;

  /** 当前是否应跳过调用（熔断中且未到冷却时间） */
  function shouldSkip() {
    if (openedAt === 0) return false;
    const elapsed = now() - openedAt;
    if (elapsed >= cooldownMs) {
      // 冷却结束，放一个试探请求过去
      halfOpen = true;
      return false;
    }
    suppressedCount += 1;
    return true;
  }

  function recordSuccess() {
    if (openedAt !== 0 || consecutiveFailures > 0) {
      logger.info?.('[LIS-GATE] recovered', {
        after_failures: consecutiveFailures,
        suppressed_calls: suppressedCount,
      });
    }
    consecutiveFailures = 0;
    openedAt = 0;
    halfOpen = false;
    suppressedCount = 0;
  }

  /**
   * 记录一次失败。
   * @param {string} op   操作名（sort/boundary/clarify）
   * @param {unknown} err 原始异常
   */
  function recordFailure(op, err) {
    const message = err instanceof Error ? err.message : String(err);

    if (halfOpen) {
      // 试探失败 → 重新熔断，冷却时间重新计时
      halfOpen = false;
      openedAt = now();
      recordDegrade('lis_breaker_open', { detail: message, op, probe: true });
      logger.warn?.('[LIS-GATE] probe failed, reopening breaker', { op, error: message });
      return;
    }

    consecutiveFailures += 1;
    logger.warn?.('[LIS-GATE] call failed', {
      op,
      error: message,
      consecutive_failures: consecutiveFailures,
    });

    if (consecutiveFailures >= threshold && openedAt === 0) {
      openedAt = now();
      recordDegrade('lis_breaker_open', { detail: message, op, failures: consecutiveFailures });
      logger.warn?.('[LIS-GATE] breaker opened — skipping LIS until cooldown elapses', {
        threshold,
        cooldown_ms: cooldownMs,
      });
    }
  }

  /** 供 /health 或调试用的状态快照 */
  function state() {
    const open = openedAt !== 0 && now() - openedAt < cooldownMs;
    return {
      open,
      half_open: halfOpen,
      consecutive_failures: consecutiveFailures,
      suppressed_calls: suppressedCount,
      cooldown_remaining_ms: open ? Math.max(0, cooldownMs - (now() - openedAt)) : 0,
    };
  }

  function reset() {
    consecutiveFailures = 0;
    openedAt = 0;
    halfOpen = false;
    suppressedCount = 0;
  }

  return { shouldSkip, recordSuccess, recordFailure, state, reset };
}

/** 进程级共享熔断器（三个端点共用一个——LIS 挂了是整体不可用） */
export const lisBreaker = createLisBreaker();
