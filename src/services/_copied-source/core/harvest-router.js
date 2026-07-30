/**
 * 域 5: 对话收割 - 高置信命中路由
 *
 * 在四层路由中位于本地 SOS/急救判断之后、远端 Agent 92 调度之前：
 *   1. 先查 Memory/Redis 缓存
 *   2. 若 MySQL 可用，查 gxy_dialogue_harvest 表（LIKE 模糊召回 + JS 精算相似度）
 *   3. 高置信命中则直接返回，未命中则交给后续远端调度
 *
 * MySQL 未配置时退化为纯缓存模式（仅 Memory/Redis）。
 */
import {
  normalizeQuestion,
  calculateSimilarity,
  isHighConfidence,
} from "./harvest-matcher.js";

const CACHE_TTL_MATCH_MS = 300_000;
const CACHE_TTL_MISS_MS = 60_000;
const CANDIDATE_LIMIT = 50;

export class HarvestRouter {
  constructor({ stateStore, mysqlPool = null, logger = null, threshold = 0.85 } = {}) {
    if (!stateStore) throw new Error("HarvestRouter requires stateStore");
    this.stateStore = stateStore;
    this.mysqlPool = mysqlPool || null;
    this.logger = logger;
    this.threshold = Number(threshold || 0.85);
  }

  /**
   * 匹配收割库。
   * @param {string} question 用户原始问题
   * @returns {Promise<{matched: boolean, confidence: number, harvest: object|null}>}
   */
  async match(question = "") {
    const normalized = normalizeQuestion(question);
    if (!normalized) return { matched: false, confidence: 0, harvest: null };

    const cacheKey = `harvest:match:${normalized}`;
    const cached = await this.#readCache(cacheKey);
    if (cached) {
      this.#log("debug", "harvest_match_cache_hit", { question });
      return cached;
    }

    if (!this.mysqlPool) {
      const empty = { matched: false, confidence: 0, harvest: null };
      await this.#writeCache(cacheKey, empty, CACHE_TTL_MISS_MS);
      return empty;
    }

    let candidates = [];
    try {
      candidates = await this.#queryCandidates(normalized);
    } catch (err) {
      this.#log("error", "harvest_query_failed", { error: err.message });
      return { matched: false, confidence: 0, harvest: null };
    }

    let bestRow = null;
    let bestSim = 0;
    for (const row of candidates) {
      const sim = calculateSimilarity(normalized, normalizeQuestion(row.question || ""));
      if (sim > bestSim) {
        bestSim = sim;
        bestRow = row;
      }
    }

    const matched = isHighConfidence(bestSim, this.threshold);
    const result = {
      matched,
      confidence: Number(bestSim.toFixed(4)),
      harvest: matched && bestRow ? this.#formatHarvest(bestRow, bestSim) : null,
    };

    await this.#writeCache(cacheKey, result, matched ? CACHE_TTL_MATCH_MS : CACHE_TTL_MISS_MS);
    this.#log(matched ? "info" : "debug", "harvest_match_result", {
      question,
      matched,
      confidence: result.confidence,
      candidate_count: candidates.length,
    });
    return result;
  }

  /**
   * 缓存一条收割结果到 Memory/Redis，供后续命中加速。
   * @param {object} harvest { question, answer, skill_key, ... }
   */
  async cache(harvest = {}) {
    if (!harvest?.question) return false;
    const normalized = normalizeQuestion(harvest.question);
    if (!normalized) return false;
    const cacheKey = `harvest:match:${normalized}`;
    const entry = {
      matched: true,
      confidence: Number(harvest.confidence || this.threshold),
      harvest: this.#formatHarvest(harvest, harvest.confidence || this.threshold),
    };
    await this.#writeCache(cacheKey, entry, CACHE_TTL_MATCH_MS);
    return true;
  }

  /**
   * 记录新的收割候选（写入 stateStore 列表，并在 MySQL 可用时持久化）。
   * @param {string} question
   * @param {string} answer
   * @param {number} confidence
   * @param {object} meta 可选的 skill_key / intent / template_id / route_summary
   */
  async record(question = "", answer = "", confidence = 0, meta = {}) {
    if (!question || !answer) return null;
    const candidate = {
      candidate_id: `harvest_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      question,
      answer,
      confidence: Number(confidence || 0),
      skill_key: meta.skill_key || "",
      intent: meta.intent || "",
      template_id: meta.template_id || "",
      route_summary: meta.route_summary || {},
      status: "auto_pending_admin_review",
      created_at: new Date().toISOString(),
    };

    try {
      await this.stateStore.pushList("dialogue-harvest-candidates", candidate, 1000);
    } catch (err) {
      this.#log("warn", "harvest_record_state_failed", { error: err.message });
    }

    if (this.mysqlPool) {
      try {
        await this.mysqlPool.execute(
          `INSERT INTO gxy_dialogue_harvest
             (question, answer, confidence, skill_key, intent, template_id, route_summary, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            candidate.question,
            candidate.answer,
            candidate.confidence,
            candidate.skill_key,
            candidate.intent,
            candidate.template_id,
            JSON.stringify(candidate.route_summary),
            candidate.status,
            candidate.created_at,
          ]
        );
      } catch (err) {
        this.#log("warn", "harvest_record_mysql_failed", { error: err.message });
      }
    }

    return candidate;
  }

  async #readCache(cacheKey) {
    try {
      const cached = await this.stateStore.get(cacheKey);
      if (cached && typeof cached === "object" && "matched" in cached) return cached;
    } catch (err) {
      this.#log("warn", "harvest_cache_read_failed", { error: err.message });
    }
    return null;
  }

  async #writeCache(cacheKey, value, ttlMs) {
    try {
      await this.stateStore.set(cacheKey, value, ttlMs);
    } catch (err) {
      this.#log("warn", "harvest_cache_write_failed", { error: err.message });
    }
  }

  async #queryCandidates(normalized) {
    const keywords = this.#extractKeywords(normalized);
    if (!keywords.length) return [];
    const conditions = keywords.map(() => "question LIKE ?").join(" OR ");
    const params = keywords.map((k) => `%${k}%`);
    const sql = `SELECT question, answer, skill_key, intent, template_id, route_summary, created_at
                 FROM gxy_dialogue_harvest
                 WHERE status = 'approved' AND (${conditions})
                 LIMIT ${CANDIDATE_LIMIT}`;
    const [rows] = await this.mysqlPool.query(sql, params);
    return rows || [];
  }

  /**
   * 从归一化问题中抽取关键词，用于 LIKE 召回。
   * 含空格的文本按词切分；CJK 文本则采样 2-gram bigram。
   */
  #extractKeywords(text = "") {
    if (!text) return [];
    const tokens = text.split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length >= 2) {
      return [...new Set(tokens)].slice(0, 5);
    }
    const bigrams = [];
    const step = Math.max(1, Math.floor(text.length / 4));
    for (let i = 0; i < text.length - 1; i += step) {
      bigrams.push(text.slice(i, i + 2));
    }
    return [...new Set(bigrams)].slice(0, 4);
  }

  #formatHarvest(row, confidence = 0) {
    let routeSummary = row.route_summary;
    if (typeof routeSummary === "string") {
      try {
        routeSummary = JSON.parse(routeSummary);
      } catch {
        routeSummary = {};
      }
    }
    return {
      question: row.question || "",
      answer: row.answer || "",
      skill_key: row.skill_key || "guixiaoyang_dispatch",
      intent: row.intent || "HARVEST_HIT",
      template_id: row.template_id || "common.answer.v1",
      route_summary: routeSummary || { source: "harvest_router" },
      confidence: Number(confidence || 0),
      created_at: row.created_at || "",
    };
  }

  #log(level, event, payload = {}) {
    if (!this.logger) return;
    if (typeof this.logger.write === "function") {
      this.logger.write(event, { level, ...payload });
    } else if (typeof this.logger[level] === "function") {
      this.logger[level](event, payload);
    }
  }
}

export default HarvestRouter;
